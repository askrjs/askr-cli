import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { startOwnedCommand, runOwnedCommand } from "./helpers/owned-command";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { writeFile: vi.fn(async () => undefined) } }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
function child(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
function close(
  value: ReturnType<typeof child>,
  code: number | null,
  signal: NodeJS.Signals | null = null,
) {
  value.exitCode = code;
  value.signalCode = signal;
  value.emit("exit", code, signal);
  value.emit("close", code, signal);
}
function setup(os: "win32" | "linux" = "linux") {
  Object.defineProperty(process, "platform", { ...platform, value: os });
  const main = child(12345),
    killer = child(23456);
  vi.mocked(spawn)
    .mockReturnValueOnce(main as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(killer as unknown as ReturnType<typeof spawn>);
  let alive = true;
  vi.spyOn(process, "kill").mockImplementation(() => {
    if (!alive) throw Object.assign(new Error("absent group"), { code: "ESRCH" });
    return true;
  });
  const options = {
    command: "owned-node",
    args: ["literal argument"],
    cwd: path.resolve("owned"),
    evidence: path.resolve("evidence"),
    label: "control",
    timeoutMs: 100,
  };
  return {
    main,
    killer,
    options,
    absent: () => {
      alive = false;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(spawn).mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(process, "platform", platform);
});

test("owned command retains literal argv, stdout, stderr and normal exit", async () => {
  const f = setup(),
    running = startOwnedCommand(f.options);
  f.main.stdout.write("owned stdout");
  f.main.stderr.write("owned stderr");
  f.absent();
  close(f.main, 0);
  const receipt = await running.closed;
  expect(receipt.failure).toBeUndefined();
  expect(receipt.code).toBe(0);
  expect(receipt.childClosed).toBe(true);
  expect(receipt.stdout).toBe("owned stdout");
  expect(receipt.stderr).toBe("owned stderr");
  expect(vi.mocked(spawn).mock.calls[0]).toEqual([
    "owned-node",
    ["literal argument"],
    expect.objectContaining({ detached: true, stdio: ["ignore", "pipe", "pipe"] }),
  ]);
  expect(fs.writeFile).toHaveBeenCalledTimes(3);
});
test("absolute timeout kills and observes the Unix group but remains a failure", async () => {
  const f = setup(),
    running = startOwnedCommand(f.options);
  await vi.advanceTimersByTimeAsync(100);
  expect(process.kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  f.absent();
  close(f.main, null, "SIGKILL");
  const receipt = await running.closed;
  expect(receipt.failure).toContain("absolute spawn deadline");
  expect(receipt.cleanup.treeReaped).toBe(true);
});
test("preview stop must observe the group within the unchanged five-second bound", async () => {
  const f = setup(),
    running = startOwnedCommand(f.options);
  void running.stop();
  expect(process.kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5000);
  expect(process.kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  f.absent();
  close(f.main, null, "SIGKILL");
  expect((await running.closed).failure).toContain("did not reap within 5000ms");
});
test("Windows timeout taskkills the still-live owned wrapper and awaits both closes", async () => {
  const f = setup("win32"),
    running = startOwnedCommand(f.options);
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.mocked(spawn).mock.calls[1]).toEqual([
    "taskkill.exe",
    ["/PID", "12345", "/T", "/F"],
    { stdio: "ignore" },
  ]);
  close(f.main, 1);
  close(f.killer, 0);
  const receipt = await running.closed;
  expect(receipt.failure).toContain("absolute spawn deadline");
  expect(receipt.cleanup).toMatchObject({
    treeReaped: true,
    terminatorClosed: true,
    terminatorCode: 0,
  });
});
test("an exited Windows wrapper cannot be reused as tree-cleanup authority", async () => {
  const f = setup("win32"),
    running = startOwnedCommand(f.options);
  close(f.main, 1);
  const receipt = await running.closed;
  expect(receipt.cleanup.treeReaped).toBe(false);
  expect(receipt.failure).toContain("wrapper exited before owned tree termination");
  expect(spawn).toHaveBeenCalledTimes(1);
});
test("case cancellation owns cleanup independently of the test runner timeout", async () => {
  const f = setup(),
    controller = new AbortController();
  const running = startOwnedCommand({ ...f.options, signal: controller.signal });
  controller.abort();
  expect(process.kill).toHaveBeenCalledWith(-12345, "SIGKILL");
  f.absent();
  close(f.main, null, "SIGKILL");
  expect((await running.closed).failure).toContain("case deadline/cancellation");
});
test("missing final close is a bounded failed receipt, never inferred cleanup", async () => {
  const f = setup("win32"),
    running = startOwnedCommand(f.options);
  f.main.exitCode = 1;
  f.main.emit("exit", 1, null);
  await vi.advanceTimersByTimeAsync(6100);
  const receipt = await running.closed;
  expect(receipt.childClosed).toBe(false);
  expect(receipt.cleanup.treeReaped).toBe(false);
  expect(receipt.failure).toContain("final reap not observed");
  expect(spawn).toHaveBeenCalledTimes(1);
});
test("run rejects a nonzero command after awaited cleanup with its raw receipt", async () => {
  const f = setup();
  const result = runOwnedCommand(f.options).catch((error: Error) => error);
  f.absent();
  close(f.main, 7);
  const error = await result;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).cause).toMatchObject({
    code: 7,
    childClosed: true,
    cleanup: { treeReaped: true },
  });
});

test("raw command logs preserve invalid UTF-8 bytes while JSON retains a decoded summary", async () => {
  const f = setup(),
    running = startOwnedCommand(f.options);
  const bytes = Buffer.from([0xff, 0xc3, 0x28]);
  f.main.stdout.write(bytes);
  f.main.stderr.write(bytes);
  f.absent();
  close(f.main, 0);
  const receipt = await running.closed;
  expect(receipt.failure).toBeUndefined();
  expect(receipt.observedBytes).toEqual({ stdout: 3, stderr: 3 });
  expect(vi.mocked(fs.writeFile).mock.calls[0]![1]).toEqual(bytes);
  expect(vi.mocked(fs.writeFile).mock.calls[1]![1]).toEqual(bytes);
  expect(receipt.stdout).toBe(bytes.toString("utf8"));
});
