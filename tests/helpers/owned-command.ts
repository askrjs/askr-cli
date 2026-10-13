import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface OwnedOptions {
  command: string;
  args: string[];
  requested?: { command: string; args: string[] };
  cwd: string;
  evidence: string;
  label: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
export interface OwnedReceipt {
  command: string;
  args: string[];
  requested?: { command: string; args: string[] };
  cwd: string;
  pid?: number;
  startedAt: string;
  elapsedMs: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  failure?: string;
  childClosed: boolean;
  cleanup: {
    required: boolean;
    treeReaped: boolean;
    unprovenReason?: string;
    method?: string;
    terminatorCode?: number | null;
    terminatorClosed?: boolean;
  };
  observedBytes: { stdout: number; stderr: number };
  stdout: string;
  stderr: string;
}

// Packaging commands own their child process trees. Unix descendants share a detached
// process group. Windows taskkill must target the still-live owned wrapper;
// an earlier wrapper exit cannot prove tree cleanup and is a failed receipt.
export function startOwnedCommand(options: OwnedOptions) {
  if (!path.isAbsolute(options.cwd) || !path.isAbsolute(options.evidence))
    throw new Error("Owned command paths must be absolute");
  if (!/^[a-z0-9-]+$/.test(options.label)) throw new Error("Invalid owned command label");
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 600000
  )
    throw new Error("Invalid owned command deadline");
  if (options.signal?.aborted) throw new Error("Owned command case already aborted");
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  const reasons: string[] = [];
  const cleanup: OwnedReceipt["cleanup"] = { required: false, treeReaped: false };
  let childClosed = false;
  let wrapperExited = false;
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let settled = false;
  let stopping = false;
  let killer: ChildProcess | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupUntil: number | undefined;
  let resolveClosed!: (receipt: OwnedReceipt) => void;
  const closed = new Promise<OwnedReceipt>((resolve) => {
    resolveClosed = resolve;
  });
  const fail = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const transcript = (stream: "stdout" | "stderr") =>
    Buffer.concat(chunks[stream]).toString("utf8");
  const groupGone = () => {
    if (!child.pid) return true;
    try {
      process.kill(-child.pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      fail(`Owned group observation failed: ${String(error)}`);
      return false;
    }
  };
  const aborted = () => {
    void stop("Owned packaging case deadline/cancellation");
  };
  const finish = async () => {
    if (settled) return;
    settled = true;
    for (const timer of [deadline, cleanupTimer, finalTimer, reapTimer])
      if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (killer && !cleanup.terminatorClosed) {
      killer.kill("SIGKILL");
      cleanup.unprovenReason ??= "Owned taskkill child close was not observed";
      fail(cleanup.unprovenReason);
    }
    const receipt: OwnedReceipt = {
      command: options.command,
      args: options.args,
      requested: options.requested,
      cwd: options.cwd,
      pid: child.pid,
      startedAt,
      elapsedMs: performance.now() - started,
      code,
      signal,
      failure: reasons.length ? reasons.join("; ") : undefined,
      childClosed,
      cleanup: { ...cleanup },
      observedBytes: { ...sizes },
      stdout: transcript("stdout"),
      stderr: transcript("stderr"),
    };
    try {
      await fs.writeFile(
        path.join(options.evidence, `${options.label}.stdout.log`),
        Buffer.concat(chunks.stdout),
        { flag: "wx" },
      );
      await fs.writeFile(
        path.join(options.evidence, `${options.label}.stderr.log`),
        Buffer.concat(chunks.stderr),
        { flag: "wx" },
      );
      await fs.writeFile(
        path.join(options.evidence, `${options.label}.json`),
        `${JSON.stringify(receipt, null, 2)}\n`,
        { flag: "wx" },
      );
    } catch (error) {
      receipt.failure = `${receipt.failure ?? ""}; Owned transcript persistence failed: ${String(error)}`;
    }
    resolveClosed(receipt);
  };
  const observeReap = () => {
    if (settled || !childClosed || (killer && !cleanup.terminatorClosed)) return;
    if (cleanupUntil !== undefined && performance.now() > cleanupUntil)
      fail("Owned cleanup observation exceeded its absolute 5000ms deadline");
    if (process.platform !== "win32") cleanup.treeReaped = groupGone();
    else if (cleanup.required)
      cleanup.treeReaped =
        cleanup.terminatorClosed === true &&
        cleanup.terminatorCode === 0 &&
        !cleanup.unprovenReason;
    // A normal Windows command close is recorded, not relabelled as an observed
    // descendant-tree termination. Error/timeout/preview-stop requires taskkill.
    if (!cleanup.required || cleanup.treeReaped || cleanup.unprovenReason) void finish();
    else reapTimer = setTimeout(observeReap, 10);
  };
  const terminateTree = () => {
    if (!child.pid) {
      cleanup.treeReaped = childClosed;
      observeReap();
      return;
    }
    if (process.platform === "win32") {
      if (killer) return;
      if (wrapperExited || child.exitCode !== null || child.signalCode !== null || childClosed) {
        cleanup.unprovenReason = "Windows wrapper exited before owned tree termination";
        fail(cleanup.unprovenReason);
        observeReap();
        return;
      }
      cleanup.method = "taskkill.exe /PID <owned-wrapper> /T /F";
      killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", (error) => {
        fail(`Owned tree termination failed: ${error.message}`);
      });
      killer.once("close", (status) => {
        cleanup.terminatorClosed = true;
        cleanup.terminatorCode = status;
        if (status !== 0) {
          cleanup.unprovenReason = "Owned Windows tree termination failed";
          fail(cleanup.unprovenReason);
        }
        observeReap();
      });
    } else {
      cleanup.method = "SIGKILL owned detached process group";
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") fail(String(error));
      }
      observeReap();
    }
  };
  const stop = (reason?: string) => {
    if (reason) fail(reason);
    if (settled || stopping) return closed;
    stopping = true;
    cleanup.required = true;
    cleanupUntil = performance.now() + 5000;
    if (deadline) clearTimeout(deadline);
    cleanupTimer = setTimeout(() => {
      fail("Owned command did not reap within 5000ms");
      terminateTree();
      finalTimer = setTimeout(() => {
        fail("Owned command final reap not observed");
        cleanup.unprovenReason ??= "Owned command final reap not observed";
        fail(cleanup.unprovenReason);
        void finish();
      }, 1000);
    }, 5000);
    if (reason || process.platform === "win32") terminateTree();
    else if (child.pid) {
      cleanup.method = "SIGTERM owned detached process group";
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") fail(String(error));
      }
    }
    observeReap();
    return closed;
  };
  for (const stream of ["stdout", "stderr"] as const) {
    child[stream]!.on("data", (chunk: Buffer) => {
      const remaining = 20 * 1024 * 1024 - sizes[stream];
      sizes[stream] += chunk.length;
      if (remaining > 0) chunks[stream].push(Buffer.from(chunk.subarray(0, remaining)));
      if (sizes[stream] > 20 * 1024 * 1024)
        void stop(`Owned ${stream} exceeded 20MiB capture bound`);
    });
    child[stream]!.once("error", (error) => {
      void stop(`Owned ${stream} failed: ${error.message}`);
    });
  }
  child.once("error", (error) => {
    fail(error.message);
    if (!child.pid) {
      childClosed = true;
      void finish();
    } else void stop(error.message);
  });
  child.once("exit", () => {
    wrapperExited = true;
  });
  child.once("close", (status, exitSignal) => {
    childClosed = true;
    code = status;
    signal = exitSignal;
    if (!stopping && performance.now() - started > options.timeoutMs)
      void stop("Owned command close exceeded its absolute spawn deadline");
    if (!stopping && status !== 0) void stop(`Owned command exited ${status ?? exitSignal}`);
    if (!stopping && status === 0) {
      if (process.platform === "win32" || groupGone()) void finish();
      else void stop("Owned command left descendants after normal exit");
    } else observeReap();
  });
  deadline = setTimeout(
    () => {
      void stop("Owned command exceeded its absolute spawn deadline");
    },
    Math.max(1, options.timeoutMs - (performance.now() - started)),
  );
  options.signal?.addEventListener("abort", aborted, { once: true });
  if (options.signal?.aborted) aborted();
  return {
    child,
    closed,
    stop,
    stdout: () => transcript("stdout"),
    stderr: () => transcript("stderr"),
  };
}

export async function runOwnedCommand(options: OwnedOptions): Promise<string> {
  const receipt = await startOwnedCommand(options).closed;
  if (
    receipt.failure ||
    receipt.code !== 0 ||
    receipt.signal ||
    !receipt.childClosed ||
    (receipt.cleanup.required && !receipt.cleanup.treeReaped)
  )
    throw new Error(
      `Owned command failed: ${options.label}; ${receipt.failure ?? receipt.signal ?? receipt.code}. See ${options.evidence}`,
      { cause: receipt },
    );
  return receipt.stdout;
}
