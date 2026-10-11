import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserServer } from "playwright";
import { bounded } from "./signed-starter-provider";
import { pinned, type FinalAdmission } from "./final-provider-graph";

type Identity = {
  pid: number;
  parent: number;
  started: string;
  command: string;
  executable: string;
  state: string;
};
async function snapshot(): Promise<Identity[]> {
  const rows: Identity[] = [];
  for (const pid of await fs.readdir("/proc")) {
    if (!/^\d+$/u.test(pid)) continue;
    try {
      if ((await fs.stat(`/proc/${pid}`)).uid !== process.getuid!()) continue;
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8"),
        end = stat.lastIndexOf(")"),
        fields = stat.slice(end + 2).split(" ");
      let executable = "";
      try {
        executable = await fs.readlink(`/proc/${pid}/exe`);
      } catch (error) {
        if (!["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
      rows.push({
        pid: Number(pid),
        parent: Number(fields[1]),
        started: fields[19]!,
        state: fields[0]!,
        command: (await fs.readFile(`/proc/${pid}/cmdline`))
          .toString()
          .replaceAll("\0", " ")
          .trim(),
        executable,
      });
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return rows;
}
const key = (row: Identity) => `${row.pid}:${row.started}`;
export function ownershipRows(rows: Identity[], root: Identity) {
  if (!rows.some((row) => key(row) === key(root))) return [];
  const owned = new Set([root.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
  }
  return rows.filter((row) => owned.has(row.pid));
}
export function remainingRows(observed: Identity[], current: Identity[]) {
  return observed.map((row) => ({
    identity: row,
    current: current.find((now) => key(now) === key(row)),
    reused: current.some((now) => now.pid === row.pid && key(now) !== key(row)),
  }));
}
// Linux-only native browser phase. BrowserServer ownership is independent of the Node compiler/npm process group.
export async function withOwnedBrowser<T>(
  name: "chromium" | "firefox" | "webkit",
  admission: FinalAdmission,
  evidence: string,
  env: Record<string, string>,
  operation: (browser: Browser) => Promise<T>,
): Promise<T> {
  assert.equal(
    process.platform,
    "linux",
    "Browser qualification is explicitly Linux three-engine; no Windows cleanup claim",
  );
  const binary = admission.tools.playwright.browsers.find((row) => row.name === name)!;
  await pinned(binary.executable);
  await pinned(binary.rootExecutable);
  const browserType = { chromium, firefox, webkit }[name];
  let server: BrowserServer | undefined, browser: Browser | undefined, root: Identity | undefined;
  let poll: ReturnType<typeof setInterval> | undefined,
    polling: Promise<void> = Promise.resolve(),
    collecting = false;
  const identities = new Map<string, Identity>(),
    history: { at: number; rows: Identity[] }[] = [];
  const failures: string[] = [];
  const collect = async () => {
    const rows = await snapshot(),
      owned = root ? ownershipRows(rows, root) : [];
    history.push({ at: Date.now(), rows: owned });
    for (const row of owned) if (!identities.has(key(row))) identities.set(key(row), row);
  };
  let result: T | undefined, operationError: unknown;
  try {
    server = await browserType.launchServer({
      executablePath: binary.executable.file,
      headless: true,
      timeout: 30000,
      env,
    });
    const processOwner = server.process();
    assert(processOwner.pid);
    root = (await snapshot()).find((row) => row.pid === processOwner.pid);
    assert(root && root.started && root.command, "Actual browser root identity must be observed");
    assert.equal(
      root.executable,
      await fs.realpath(binary.rootExecutable.file),
      "BrowserServer must own the separately admitted runtime executable (including a launcher script's exec target)",
    );
    await collect();
    assert(identities.has(key(root)), "Nonvacuous browser observation");
    poll = setInterval(() => {
      if (collecting) return;
      collecting = true;
      polling = collect()
        .catch((error) => {
          failures.push(String(error));
        })
        .finally(() => {
          collecting = false;
        });
    }, 50);
    browser = await browserType.connect(server.wsEndpoint(), { timeout: 10000 });
    result = await bounded(operation(browser), `${name} signed browser journey`, 60000);
  } catch (error) {
    operationError = error;
  } finally {
    if (poll) clearInterval(poll);
    await polling;
    if (root) await collect().catch((error) => failures.push(String(error)));
    const started = performance.now(),
      deadline = started + 5000;
    const cleanup: { elapsed: number; states: ReturnType<typeof remainingRows> }[] = [];
    let browserClosed = false,
      serverClosed = false;
    await Promise.all([
      browser
        ? bounded(
            browser.close().then(() => {
              browserClosed = true;
            }),
            "browser client close",
            5000,
          ).catch((error) => failures.push(String(error)))
        : Promise.resolve(),
      server
        ? bounded(
            server.close().then(() => {
              serverClosed = true;
            }),
            "BrowserServer close",
            5000,
          ).catch((error) => failures.push(String(error)))
        : Promise.resolve(),
    ]);
    let drained = !server;
    if (!server && operationError)
      failures.push(
        "Browser launch rejected before an owned root was captured; allocation/cleanup is unproven",
      );
    while (root && performance.now() <= deadline) {
      let current: Identity[];
      try {
        current = await snapshot();
      } catch (error) {
        failures.push(String(error));
        break;
      }
      const states = remainingRows([...identities.values()], current);
      const elapsed = performance.now() - started;
      cleanup.push({ elapsed, states });
      // Zombies are retained explicitly as inactive; absent and PID reuse are distinct.
      if (
        performance.now() <= deadline &&
        states.every((row) => !row.current || row.current.state === "Z")
      ) {
        drained = true;
        break;
      }
      if (performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (server && (!root || identities.size === 0 || !browserClosed || !serverClosed || !drained))
      failures.push("Owned browser closure/identity drain unproven within shared 5000ms");
    let emergency: string | undefined;
    if (server && !drained) {
      try {
        await bounded(
          server.kill(),
          "failed BrowserServer emergency kill (never acceptance)",
          1000,
        );
        emergency = "Owned API kill completed after failed normal drain";
      } catch (error) {
        emergency = String(error);
      }
    }
    await fs.writeFile(
      path.join(evidence, `browser-${name}-ownership.json`),
      JSON.stringify(
        {
          root,
          observed: [...identities.values()],
          history,
          cleanup,
          browserClosed,
          serverClosed,
          drained,
          failures,
          emergency,
          scope: "All observed PID/start identities; no detached-PGID inference",
          operationError: operationError ? String(operationError) : undefined,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
  }
  if (operationError || failures.length)
    throw new AggregateError(
      [
        ...(operationError ? [operationError] : []),
        ...failures.map((message) => new Error(message)),
      ],
      "Owned browser phase failed",
    );
  return result as T;
}
