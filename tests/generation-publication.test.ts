import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyTargetIntoStage,
  createSiblingStage,
  withDirectoryTargetLock,
} from "../src/directory-swap";
import { runCreateCli } from "../src/bin/create";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-generation-publication-"));
  roots.push(root);
  const target = path.join(root, "generated");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, ".askr-generated.json"), "old manifest");
  await fs.writeFile(path.join(target, "schemas.ts"), "old schema");
  return { root, target };
}
async function worker(
  target: string,
  fault: string,
  kill = false,
): Promise<{
  error?: { message: string; code?: string; causes?: string[] };
  backup: string;
  stage: string;
  injected: boolean;
  logs?: string[];
  commandCode?: number;
}> {
  const child = fork(
    fileURLToPath(new URL("./fixtures/generation-publication-worker.ts", import.meta.url)),
    [target, fault],
    { silent: true, execArgv: ["--import", "tsx"] },
  );
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    const [result] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(5_000) }),
      exited.then(() => {
        throw new Error(`Generation worker exited before its result: ${stderr}`);
      }),
    ]);
    if (kill) expect(child.kill("SIGKILL")).toBe(true);
    await exited;
    return result;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("actual installer process outcomes", () => {
  it.each(["failure", "missing", "terminated-installer", "terminated-cli", "success"])(
    "preserves project ownership after %s with a real local installer process",
    async (behavior) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-real-installer-"));
      roots.push(root);
      const target = path.join(root, "project");
      const bin = path.join(root, "bin");
      await fs.mkdir(bin);
      await fs.writeFile(path.join(root, "unrelated.txt"), "unrelated\r\n");
      const markerPath = path.join(root, "started.json");
      const shim = path.join(bin, "installer.cjs");
      const source = `const fs = require("node:fs");
fs.writeFileSync("package-lock.json", "partial owned install");
fs.writeFileSync(${JSON.stringify(`${markerPath}.tmp`)}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
fs.renameSync(${JSON.stringify(`${markerPath}.tmp`)}, ${JSON.stringify(markerPath)});
${behavior === "success" ? "process.exit(0);" : behavior === "failure" ? "process.exit(23);" : "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);"}
`;
      if (behavior !== "missing") {
        await fs.writeFile(shim, source);
        if (process.platform === "win32") {
          await fs.writeFile(
            path.join(bin, "npm.cmd"),
            `@echo off\r\n"${process.execPath}" "${shim}"\r\n`,
          );
        } else {
          const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
          await fs.writeFile(
            path.join(bin, "npm"),
            `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(shim)}\n`,
          );
          await fs.chmod(path.join(bin, "npm"), 0o755);
        }
      }
      type Installer = { pid: number; cwd: string };
      let ready!: (installer: Installer) => void;
      const started = new Promise<Installer>((resolve) => {
        ready = resolve;
      });
      const watcher = watch(root, async (_event, filename) => {
        if (filename === null || String(filename) === "started.json") {
          try {
            ready(JSON.parse(await fs.readFile(markerPath, "utf8")) as Installer);
          } catch {}
        }
      });
      const child = fork(
        fileURLToPath(new URL("./fixtures/create-process-worker.ts", import.meta.url)),
        [target],
        {
          silent: true,
          execArgv: ["--import", "tsx"],
          env: {
            ...process.env,
            PATH: behavior === "missing" ? bin : `${bin}${path.delimiter}${process.env.PATH}`,
            npm_config_user_agent: "npm/12.0.2",
          },
        },
      );
      const exited = once(child, "exit");
      const closed = once(child, "close");
      let stdout = "",
        stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      let installer: Installer | undefined;
      let installerWasTerminated = false;
      let startTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (behavior !== "missing") {
          installer = await Promise.race([
            started,
            exited.then(async () => {
              try {
                return JSON.parse(await fs.readFile(markerPath, "utf8")) as Installer;
              } catch {
                throw new Error(`CLI exited before the installer marker: ${stdout}\n${stderr}`);
              }
            }),
            new Promise<never>((_resolve, reject) => {
              startTimer = setTimeout(
                () => reject(new Error(`Installer did not start: ${stderr}`)),
                10_000,
              );
              startTimer.unref();
            }),
          ]);
          expect(await fs.realpath(path.dirname(installer.cwd))).toBe(await fs.realpath(root));
          if (behavior === "terminated-installer") {
            process.kill(installer.pid, "SIGKILL");
            installerWasTerminated = true;
          }
          if (behavior === "terminated-cli") expect(child.kill("SIGKILL")).toBe(true);
        }
        const [code, signal] = await exited;
        expect(await fs.readFile(path.join(root, "unrelated.txt"), "utf8")).toBe("unrelated\r\n");
        if (behavior === "success") {
          expect(code).toBe(0);
          expect(signal).toBeNull();
          expect(stdout).toContain("Success! Created test-app");
          expect(
            JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf8")).name,
          ).toBe("test-app");
          expect(await fs.readFile(path.join(target, "package-lock.json"), "utf8")).toBe(
            "partial owned install",
          );
          await expect(fs.access(installer!.cwd)).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          expect(stdout).not.toContain("Success! Created");
          await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
          if (behavior === "terminated-cli") {
            expect([code, signal]).not.toEqual([0, null]);
            expect(await fs.readFile(path.join(installer!.cwd, "package-lock.json"), "utf8")).toBe(
              "partial owned install",
            );
          } else {
            expect(code).toBe(1);
            expect(stderr).toContain("no project files were published");
          }
        }
        if (behavior !== "terminated-cli") {
          expect(
            (await fs.readdir(root)).some((entry) => entry.startsWith(".project.askr-create-")),
          ).toBe(false);
        }
      } finally {
        watcher.close();
        if (startTimer) clearTimeout(startTimer);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
        if (!installer && (behavior === "terminated-cli" || behavior === "terminated-installer")) {
          try {
            installer = JSON.parse(await fs.readFile(markerPath, "utf8")) as Installer;
          } catch {}
        }
        if (
          installer &&
          !installerWasTerminated &&
          (behavior === "terminated-cli" || behavior === "terminated-installer")
        ) {
          try {
            process.kill(installer.pid, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        // The installer (and Windows command shell) inherit these pipes. Wait
        // for their handles to close before removing the retained fixture cwd.
        await closed;
      }
    },
    20_000,
  );
});

describe("generated directory ownership and recovery", () => {
  it.each([
    "create-publish-failure",
    "create-install-failure",
    "create-install-missing",
    "create-install-timeout",
  ])("cleans a failed project and reports no success after %s", async (fault) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-create-failure-"));
    roots.push(root);
    const target = path.join(root, "project");
    const result = await worker(target, fault);
    expect(result.injected).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.commandCode).toBe(1);
    expect(result.logs?.join("\n")).not.toContain("Success! Created");
    expect(result.logs?.join("\n")).toContain(
      fault === "create-publish-failure"
        ? "Failed to publish generated project"
        : "no project files were published",
    );
    expect(await fs.readdir(root)).toEqual([]);
  });

  it.each(["prepared", "backed-up", "published"])(
    "recovers generation killed at the %s checkpoint",
    async (phase) => {
      const { target } = await fixture();
      const result = await worker(target, phase, true);
      const expected = phase === "published" ? "new schema" : "old schema";
      await withDirectoryTargetLock(target, async () => {
        expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe(expected);
      });
      await expect(fs.access(result.backup)).rejects.toMatchObject({ code: "ENOENT" });
      if (phase !== "published")
        expect(await fs.readFile(path.join(result.stage, "schemas.ts"), "utf8")).toBe("new schema");
    },
    10_000,
  );

  it("cleans a partial stage without changing the original output", async () => {
    const { root, target } = await fixture();
    const result = await worker(target, "partial-stage-write");
    expect(result.injected).toBe(true);
    expect(result.error?.code).toBe("ENOSPC");
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
    expect(await fs.readdir(root)).toEqual(["generated"]);
  });

  it("preserves complete published output if deleting its backup fails partway through", async () => {
    const { root, target } = await fixture();
    const result = await worker(target, "partial-backup-cleanup");
    expect(result.injected).toBe(true);
    expect(result.error).toBeUndefined();
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("new schema");
    expect(await fs.readFile(path.join(target, ".askr-generated.json"), "utf8")).toBe(
      "new manifest",
    );
    await withDirectoryTargetLock(target, async () => {});
    expect(await fs.readdir(root)).toEqual(["generated"]);
  });

  it("reports a retained stage when cleaning a failed stage also fails", async () => {
    const { target } = await fixture();
    const result = await worker(target, "stage-cleanup-failure");
    expect(result.error?.message).toContain(JSON.stringify(result.stage));
    expect(result.error?.causes).toEqual(
      expect.arrayContaining(["injected stage-cleanup-failure"]),
    );
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
    expect(await fs.readFile(path.join(result.stage, "schemas.ts"), "utf8")).toBe("partial");
  });

  it("retains an original after failed rollback and recovers it before the next copy", async () => {
    const { target } = await fixture();
    const result = await worker(target, "rollback-failure");
    expect(result.injected).toBe(true);
    expect(result.error?.message).toContain(JSON.stringify(result.backup));
    expect(await fs.readFile(path.join(result.backup, "schemas.ts"), "utf8")).toBe("old schema");
    const stage = await createSiblingStage(target, "copy");
    expect(await copyTargetIntoStage(target, stage)).toBe(true);
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
    expect(await fs.readFile(path.join(stage, "schemas.ts"), "utf8")).toBe("old schema");
  });

  it("keeps the original and removes its stage when moving the original fails", async () => {
    const { root, target } = await fixture();
    const result = await worker(target, "original-rename-failure");
    expect(result.injected).toBe(true);
    expect(result.error?.code).toBe("EIO");
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
    expect(await fs.readdir(root)).toEqual(["generated"]);
  });

  it("recovers an interrupted generation before refusing to create a project over its owned output", async () => {
    const { root, target } = await fixture();
    const result = await worker(target, "backed-up", true);
    const errors: string[] = [];
    expect(
      await runCreateCli(["spa", "replacement", "--dir", target, "--no-install", "--no-skills"], {
        log() {},
        error: (message) => {
          errors.push(message);
        },
      }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("not empty");
    expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
    expect(await fs.readFile(path.join(result.stage, "schemas.ts"), "utf8")).toBe("new schema");
    expect((await fs.readdir(root)).sort()).toEqual(
      [path.basename(result.stage), "generated"].sort(),
    );
  }, 10_000);

  it.each(["target-read-denied", "target-stat-denied"])(
    "preserves a %s error and the original output",
    async (fault) => {
      const { root, target } = await fixture();
      const result = await worker(target, fault);
      expect(result.injected).toBe(true);
      expect(result.error?.code).toBe("EACCES");
      expect(await fs.readFile(path.join(target, "schemas.ts"), "utf8")).toBe("old schema");
      expect(await fs.readdir(root)).toEqual(["generated"]);
    },
  );

  it("rejects a junction output without replacing the link or modifying its destination", async () => {
    const { root, target } = await fixture();
    const outside = path.join(root, "unrelated");
    await fs.rename(target, outside);
    await fs.symlink(outside, target, "junction");
    const result = await worker(target, "no-fault");
    expect(result.error?.message).toContain(JSON.stringify(target));
    expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outside, "schemas.ts"), "utf8")).toBe("old schema");
    expect((await fs.readdir(root)).sort()).toEqual(["generated", "unrelated"]);
  });

  it("admits only one concurrent project creation and preserves the winner's unrelated files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-create-ownership-"));
    roots.push(root);
    const target = path.join(root, "shared");
    const mkdtemp = fs.mkdtemp.bind(fs);
    const rename = fs.rename.bind(fs);
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fs, "mkdtemp").mockImplementation(async (...args) => {
      const stage = await mkdtemp(...args);
      if (String(args[0]).startsWith(path.join(root, ".shared.askr-create-"))) {
        if (++arrivals === 2) release();
        await gate;
      }
      return stage;
    });
    let publications = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (
        String(to) === target &&
        String(from).startsWith(path.join(root, ".shared.askr-create-")) &&
        ++publications === 1
      ) {
        await fs.writeFile(path.join(target, "unrelated.txt"), "unrelated");
      }
    });
    const errors: string[] = [];
    const results = await Promise.all(
      ["first-app", "second-app"].map((name) =>
        runCreateCli(["spa", name, "--dir", target, "--no-install", "--no-skills"], {
          log() {},
          error: (message) => {
            errors.push(message);
          },
        }),
      ),
    );
    expect(arrivals).toBe(2);
    expect([...results].sort()).toEqual([0, 1]);
    expect(publications).toBe(1);
    expect(errors.join("\n")).toContain("not empty");
    expect(await fs.readFile(path.join(target, "unrelated.txt"), "utf8")).toBe("unrelated");
    expect(await fs.readdir(root)).toEqual(["shared"]);
  });
});
