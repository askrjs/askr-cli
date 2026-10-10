import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDirectoryTargetLock } from "../src/directory-swap";
import { writeFileChanges } from "../src/file-changes";

const roots: string[] = [];
const context = new AsyncLocalStorage<string>();
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(kind: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-lock-ownership-"));
  roots.push(root);
  const target = path.join(root, kind === "directory" ? "output" : "manifest.json");
  if (kind === "file") await fs.writeFile(target, "old");
  const lock =
    kind === "directory" ? `${target}.askr-lock` : path.join(root, ".manifest.json.askr-lock");
  return { root, target, lock };
}
async function operate(kind: string, target: string, operation: () => Promise<void>) {
  if (kind === "directory") return withDirectoryTargetLock(target, operation);
  return writeFileChanges(
    [{ filePath: target, content: context.getStore() ?? "new", expectedContent: "old" }],
    {
      replace: async (temporary, file) => {
        await operation();
        await fs.rename(temporary, file);
      },
    },
  );
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const observationCases = ["directory", "file"].flatMap((kind) =>
  (["scandir", "open", "read", "lstat"] as const).map((syscall) => ({ kind, syscall })),
);
function denyLockObservation(
  syscall: "scandir" | "open" | "read" | "lstat",
  lock: string,
  fail: () => void,
) {
  if (syscall === "scandir") {
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) === lock) fail();
      return readdir(...args);
    }) as typeof fs.readdir);
  } else if (syscall === "open" || syscall === "read") {
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation((async (
      ...args: Parameters<typeof fs.readFile>
    ) => {
      if (String(args[0]) === path.join(lock, "owner.json")) fail();
      return readFile(...args);
    }) as typeof fs.readFile);
  } else {
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (String(args[0]) === lock) fail();
      return lstat(...args);
    }) as typeof fs.lstat);
  }
}

describe("filesystem lock ownership", () => {
  it.each(["directory", "file"])(
    "propagates a one-shot %s lock preflight EACCES without misclassifying it as a rename collision",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      const owner = path.join(lock, "owner.json");
      await fs.writeFile(owner, '{"pid":2147483647}');
      const lstat = fs.lstat.bind(fs);
      const denied = Object.assign(new Error("injected preflight read denial"), {
        code: "EACCES",
        syscall: "lstat",
        path: lock,
      });
      let injected = false;
      vi.spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
        if (String(args[0]) === lock && !injected) {
          injected = true;
          throw denied;
        }
        return lstat(...args);
      }) as typeof fs.lstat);
      let entered = false;
      await expect(
        operate(kind, target, async () => {
          entered = true;
        }),
      ).rejects.toBe(denied);
      expect(injected).toBe(true);
      expect(entered).toBe(false);
      expect(await fs.readFile(owner, "utf8")).toBe('{"pid":2147483647}');
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("old");
      expect((await fs.readdir(root)).sort()).toEqual(
        kind === "directory"
          ? [path.basename(lock)]
          : [path.basename(lock), "manifest.json"].sort(),
      );
    },
  );

  it.each(observationCases)(
    "retries a transient Windows-style $syscall denial while the $kind lock is handed off",
    async ({ kind, syscall }) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "owner.json"), '{"pid":2147483647}');
      const denied = Object.assign(new Error("injected pending-deletion lock observation"), {
        code: "EPERM",
        syscall,
        path: syscall === "open" || syscall === "read" ? path.join(lock, "owner.json") : lock,
      });
      let failed = false;
      denyLockObservation(syscall, lock, () => {
        if (!failed) {
          failed = true;
          throw denied;
        }
      });
      let entered = 0;
      await expect(
        operate(kind, target, async () => {
          entered += 1;
        }),
      ).resolves.toBeUndefined();
      expect(failed).toBe(true);
      expect(entered).toBe(1);
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("new");
      expect(await fs.readdir(root)).toEqual(kind === "directory" ? [] : ["manifest.json"]);
    },
  );

  it.each(observationCases)(
    "bounds a permanent $kind lock $syscall denial and retains the native cause without deleting its owner",
    async ({ kind, syscall }) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      const owner = path.join(lock, "owner.json");
      await fs.writeFile(owner, '{"pid":2147483647}');
      const denied = Object.assign(new Error("injected permanent lock observation denial"), {
        code: "EPERM",
        syscall,
        path: syscall === "open" || syscall === "read" ? owner : lock,
      });
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now);
      denyLockObservation(syscall, lock, () => {
        now += 10_001;
        throw denied;
      });
      await expect(
        operate(kind, target, async () => {
          throw new Error("must not enter");
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Timed out waiting"),
        cause: denied,
      });
      vi.restoreAllMocks();
      expect(await fs.readFile(owner, "utf8")).toBe('{"pid":2147483647}');
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("old");
      expect((await fs.readdir(root)).sort()).toEqual(
        kind === "directory"
          ? [path.basename(lock)]
          : [path.basename(lock), "manifest.json"].sort(),
      );
    },
  );

  it.each(["unlink", "rmdir"] as const)(
    "propagates an EPERM %s failure instead of treating a deletion failure as observation contention",
    async (method) => {
      const { root, target, lock } = await fixture("file");
      await fs.mkdir(lock);
      const owner = path.join(lock, "owner.json");
      await fs.writeFile(owner, '{"pid":2147483647}');
      const failure = Object.assign(new Error("injected lock deletion denial"), {
        code: "EPERM",
        syscall: method,
        path: method === "unlink" ? owner : lock,
      });
      if (method === "unlink") {
        const unlink = fs.unlink.bind(fs);
        vi.spyOn(fs, "unlink").mockImplementation(async (...args) => {
          if (String(args[0]) === owner) throw failure;
          return unlink(...args);
        });
      } else {
        const rmdir = fs.rmdir.bind(fs);
        vi.spyOn(fs, "rmdir").mockImplementation(async (...args) => {
          if (String(args[0]) === lock) throw failure;
          return rmdir(...args);
        });
      }
      await expect(
        operate("file", target, async () => {
          throw new Error("must not enter");
        }),
      ).rejects.toBe(failure);
      vi.restoreAllMocks();
      expect(await fs.readFile(target, "utf8")).toBe("old");
      expect((await fs.readdir(root)).sort()).toEqual(
        [path.basename(lock), "manifest.json"].sort(),
      );
      if (method === "unlink") expect(await fs.readFile(owner, "utf8")).toBe('{"pid":2147483647}');
      else expect(await fs.readdir(lock)).toEqual([]);
    },
  );

  it.each(["directory", "file"])(
    "does not remove a successor's %s owner during release",
    async (kind) => {
      const { target, lock } = await fixture(kind);
      const rmdir = fs.rmdir.bind(fs);
      const successor = path.join(lock, "owner-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json");
      let handedOff = false;
      vi.spyOn(fs, "rmdir").mockImplementation(async (...args) => {
        if (String(args[0]) === lock && !handedOff) {
          handedOff = true;
          await rmdir(...args);
          await fs.mkdir(lock);
          await fs.writeFile(successor, JSON.stringify({ pid: process.pid }));
          // The successor published after our owner was unlinked but before the
          // releasing process's empty-directory removal reached the filesystem.
        }
        return rmdir(...args);
      });
      await expect(operate(kind, target, async () => {})).resolves.toBeUndefined();
      expect(handedOff).toBe(true);
      expect(JSON.parse(await fs.readFile(successor, "utf8"))).toEqual({ pid: process.pid });
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("new");
    },
  );

  it("preserves an owner whose process cannot be probed instead of treating permission denial as death", async () => {
    const { root, target, lock } = await fixture("file");
    await fs.mkdir(lock);
    const ownerPath = path.join(lock, "owner.json");
    await fs.writeFile(ownerPath, '{"pid":2147483647}');
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(process, "kill").mockImplementation(() => {
      now += 10_001;
      throw Object.assign(new Error("injected process probe denial"), { code: "EPERM" });
    });
    await expect(operate("file", target, async () => {})).rejects.toThrow("Timed out waiting");
    expect(await fs.readFile(ownerPath, "utf8")).toBe('{"pid":2147483647}');
    expect(await fs.readFile(target, "utf8")).toBe("old");
    expect((await fs.readdir(root)).sort()).toEqual([path.basename(lock), "manifest.json"].sort());
  });

  it.each(["stat", "readdir", "readFile", "unlink", "rmdir", "rename"] as const)(
    "preserves a filesystem %s failure while acquiring a lock",
    async (method) => {
      const { root, target, lock } = await fixture("file");
      await fs.mkdir(lock);
      const ownerPath = path.join(lock, "owner.json");
      await fs.writeFile(ownerPath, '{"pid":2147483647}');
      const failure = Object.assign(new Error(`injected ${method} failure`), {
        code: method === "rename" ? "EIO" : "EACCES",
      });
      if (method === "stat") {
        const lstat = fs.lstat.bind(fs);
        vi.spyOn(fs, "lstat").mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
          if (String(args[0]) === lock) throw failure;
          return lstat(...args);
        }) as typeof fs.lstat);
      } else if (method === "readdir") {
        const readdir = fs.readdir.bind(fs);
        vi.spyOn(fs, "readdir").mockImplementation((async (
          ...args: Parameters<typeof fs.readdir>
        ) => {
          if (String(args[0]) === lock) throw failure;
          return readdir(...args);
        }) as typeof fs.readdir);
      } else if (method === "readFile") {
        const readFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation((async (
          ...args: Parameters<typeof fs.readFile>
        ) => {
          if (String(args[0]) === ownerPath) throw failure;
          return readFile(...args);
        }) as typeof fs.readFile);
      } else if (method === "unlink") {
        const unlink = fs.unlink.bind(fs);
        vi.spyOn(fs, "unlink").mockImplementation(async (...args) => {
          if (String(args[0]) === ownerPath) throw failure;
          return unlink(...args);
        });
      } else if (method === "rmdir") {
        const rmdir = fs.rmdir.bind(fs);
        vi.spyOn(fs, "rmdir").mockImplementation(async (...args) => {
          if (String(args[0]) === lock) throw failure;
          return rmdir(...args);
        });
      } else {
        const rename = fs.rename.bind(fs);
        vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
          if (String(to) === lock) throw failure;
          return rename(from, to);
        });
      }
      await expect(operate("file", target, async () => {})).rejects.toBe(failure);
      vi.restoreAllMocks();
      expect(await fs.readFile(target, "utf8")).toBe("old");
      expect(
        (await fs.readdir(root)).some((entry) => entry.startsWith(`${path.basename(lock)}.stage-`)),
      ).toBe(false);
      if (method === "rmdir") expect(await fs.readdir(lock)).toEqual([]);
      else expect(await fs.readFile(ownerPath, "utf8")).toBe('{"pid":2147483647}');
    },
  );

  it.each(["directory", "file"])(
    "can retry after a process is killed before publishing its prepared %s lock",
    async (kind) => {
      const { target, lock } = await fixture(kind);
      const child = fork(
        fileURLToPath(new URL("./fixtures/filesystem-lock-crash-worker.ts", import.meta.url)),
        [kind, target],
        { silent: true, execArgv: ["--import", "tsx"] },
      );
      const exited = once(child, "exit");
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      let stage = "";
      try {
        const [checkpoint] = await Promise.race([
          once(child, "message", { signal: AbortSignal.timeout(5_000) }),
          exited.then(() => {
            throw new Error(`Lock worker exited before preparation: ${stderr}`);
          }),
        ]);
        stage = checkpoint.stage;
        expect(child.kill("SIGKILL")).toBe(true);
        await exited;
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      }
      await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("old");
      const entries = await fs.readdir(stage);
      expect(entries).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(path.join(stage, entries[0]), "utf8"))).toEqual({
        pid: child.pid,
      });
      let entered = false;
      await operate(kind, target, async () => {
        entered = true;
      });
      expect(entered).toBe(true);
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("new");
      // This abandoned preparation belongs to the killed process, not the retry.
      expect(await fs.readdir(stage)).toEqual(entries);
      await fs.rm(stage, { recursive: true });
    },
    10_000,
  );

  it.each(["directory", "file"])(
    "recovers an old empty %s lock without leaving private preparation directories",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lock, old, old);
      let entered = false;
      await operate(kind, target, async () => {
        entered = true;
      });
      expect(entered).toBe(true);
      expect(await fs.readdir(root)).toEqual(kind === "directory" ? [] : ["manifest.json"]);
    },
  );

  it.each(["directory", "file"])(
    "recovers an aged malformed legacy owner for a %s lock",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "owner.json"), "{");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lock, old, old);
      await expect(operate(kind, target, async () => {})).resolves.toBeUndefined();
      expect(await fs.readdir(root)).toEqual(kind === "directory" ? [] : ["manifest.json"]);
    },
  );

  it.each(["directory", "file"])(
    "times out without deleting a fresh malformed %s owner record",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      const ownerPath = path.join(lock, "owner.json");
      await fs.writeFile(ownerPath, "{");
      let now = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const readFile = fs.readFile.bind(fs);
      vi.spyOn(fs, "readFile").mockImplementation((async (
        ...args: Parameters<typeof fs.readFile>
      ) => {
        const contents = await readFile(...args);
        if (String(args[0]) === ownerPath) now += 10_001;
        return contents;
      }) as typeof fs.readFile);
      await expect(operate(kind, target, async () => {})).rejects.toThrow("Timed out waiting");
      expect(await fs.readFile(ownerPath, "utf8")).toBe("{");
      expect((await fs.readdir(root)).sort()).toEqual(
        kind === "directory"
          ? [path.basename(lock)]
          : [path.basename(lock), "manifest.json"].sort(),
      );
    },
  );

  it.each(["directory", "file"])(
    "cleans its partial owner record if preparing a %s lock fails",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      const writeFile = fs.writeFile.bind(fs);
      const failure = Object.assign(new Error("injected partial owner write"), { code: "ENOSPC" });
      let injected = false;
      vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
        if (path.dirname(String(args[0])).startsWith(`${lock}.stage-`)) {
          injected = true;
          await writeFile(args[0], "{");
          throw failure;
        }
        return writeFile(...args);
      });
      await expect(
        operate(kind, target, async () => {
          throw new Error("Operation must not run");
        }),
      ).rejects.toBe(failure);
      expect(injected).toBe(true);
      expect(await fs.readdir(root)).toEqual(kind === "directory" ? [] : ["manifest.json"]);
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("old");
    },
  );

  it("reports the private preparation directory when partial owner cleanup also fails", async () => {
    const { target, lock } = await fixture("directory");
    const writeFile = fs.writeFile.bind(fs);
    const rm = fs.rm.bind(fs);
    let stage = "";
    const writeFailure = Object.assign(new Error("injected partial owner write"), {
      code: "ENOSPC",
    });
    const cleanupFailure = Object.assign(new Error("injected preparation cleanup failure"), {
      code: "EACCES",
    });
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
      if (path.dirname(String(args[0])).startsWith(`${lock}.stage-`)) {
        stage = path.dirname(String(args[0]));
        await writeFile(args[0], "{");
        throw writeFailure;
      }
      return writeFile(...args);
    });
    vi.spyOn(fs, "rm").mockImplementation(async (...args) => {
      if (String(args[0]) === stage) throw cleanupFailure;
      return rm(...args);
    });
    let error: unknown;
    try {
      await withDirectoryTargetLock(target, async () => {});
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([writeFailure, cleanupFailure]);
    expect((error as Error).message).toContain(JSON.stringify(stage));
    const entries = await fs.readdir(stage);
    expect(entries).toHaveLength(1);
    expect(await fs.readFile(path.join(stage, entries[0]), "utf8")).toBe("{");
    await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an unrelated directory that collides with private lock preparation", async () => {
    const { target, lock } = await fixture("directory");
    const mkdir = fs.mkdir.bind(fs);
    let collision = "";
    vi.spyOn(fs, "mkdir").mockImplementation((async (...args: Parameters<typeof fs.mkdir>) => {
      if (String(args[0]).startsWith(`${lock}.stage-`)) {
        collision = String(args[0]);
        await mkdir(...args);
        await fs.writeFile(path.join(collision, "unrelated.txt"), "unrelated");
      }
      return mkdir(...args);
    }) as typeof fs.mkdir);
    await expect(withDirectoryTargetLock(target, async () => {})).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await fs.readFile(path.join(collision, "unrelated.txt"), "utf8")).toBe("unrelated");
    await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["directory", "file"])(
    "preserves a junction used as a %s lock owner record",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      const outside = path.join(root, "unrelated");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "untouched.txt"), "unrelated");
      const ownerPath = path.join(lock, "owner.json");
      await fs.symlink(outside, ownerPath, "junction");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lock, old, old);
      await expect(operate(kind, target, async () => {})).rejects.toThrow(JSON.stringify(lock));
      expect((await fs.lstat(ownerPath)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(path.join(outside, "untouched.txt"), "utf8")).toBe("unrelated");
    },
  );

  it.each(["directory", "file"])(
    "keeps %s operations exclusive when two stale-owner observations race",
    async (kind) => {
      const { target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "owner.json"), '{"pid":2147483647}');
      const readFile = fs.readFile.bind(fs);
      const rm = fs.rm.bind(fs);
      const unlink = fs.unlink.bind(fs);
      const snapshots = deferred();
      const firstEntered = deferred();
      const releaseFirst = deferred();
      let reads = 0;
      let delayedRemoval = false;
      let active = 0;
      let maximumActive = 0;
      vi.spyOn(fs, "readFile").mockImplementation((async (
        ...args: Parameters<typeof fs.readFile>
      ) => {
        const value = await readFile(...args);
        if (path.dirname(String(args[0])) === lock) {
          const owner = JSON.parse(value.toString());
          if (owner.pid === 2147483647 && reads < 2) {
            if (++reads === 2) snapshots.resolve();
            await snapshots.promise;
          } else if (owner.pid === process.pid && context.getStore() === "second" && active === 1) {
            // Correct recovery observes the first live owner before it can enter.
            releaseFirst.resolve();
          }
        }
        return value;
      }) as typeof fs.readFile);
      async function pauseStaleRemoval(name: string) {
        if (
          context.getStore() === "second" &&
          !delayedRemoval &&
          (name === lock || path.dirname(name) === lock)
        ) {
          delayedRemoval = true;
          await firstEntered.promise;
        }
      }
      vi.spyOn(fs, "rm").mockImplementation(async (...args) => {
        await pauseStaleRemoval(String(args[0]));
        return rm(...args);
      });
      vi.spyOn(fs, "unlink").mockImplementation(async (...args) => {
        await pauseStaleRemoval(String(args[0]));
        return unlink(...args);
      });
      const critical = async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (context.getStore() === "first") {
          firstEntered.resolve();
          await releaseFirst.promise;
        } else {
          // The pre-fix stale reaper deletes the new lock and enters concurrently.
          releaseFirst.resolve();
        }
        active -= 1;
      };
      const runs = ["first", "second"].map((label) =>
        context.run(label, () => operate(kind, target, critical)),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcomes = await Promise.race([
          Promise.allSettled(runs),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Stale-owner race checkpoint timed out")),
              3_000,
            );
          }),
        ]);
        expect(reads).toBe(2);
        expect(delayedRemoval).toBe(true);
        expect(maximumActive).toBe(1);
        if (kind === "directory")
          expect(outcomes.map((item) => item.status)).toEqual(["fulfilled", "fulfilled"]);
        else {
          expect(outcomes[0].status).toBe("fulfilled");
          expect(outcomes[1]).toMatchObject({
            status: "rejected",
            reason: { message: `File changed before writing: ${target}` },
          });
          expect(await fs.readFile(target, "utf8")).toBe("first");
        }
      } finally {
        if (timer) clearTimeout(timer);
        firstEntered.resolve();
        snapshots.resolve();
        releaseFirst.resolve();
        await Promise.allSettled(runs);
      }
      await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
    },
    15_000,
  );

  it.each(["directory", "file"])(
    "preserves unrelated contents of an ambiguous %s lock directory",
    async (kind) => {
      const { target, lock } = await fixture(kind);
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "unrelated.txt"), "unrelated");
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(lock, old, old);
      await expect(operate(kind, target, async () => {})).rejects.toThrow(JSON.stringify(lock));
      expect(await fs.readFile(path.join(lock, "unrelated.txt"), "utf8")).toBe("unrelated");
      if (kind === "file") expect(await fs.readFile(target, "utf8")).toBe("old");
    },
  );

  it.each(["directory", "file"])(
    "rejects a %s lock junction without deleting it or following its owner record",
    async (kind) => {
      const { root, target, lock } = await fixture(kind);
      const outside = path.join(root, "unrelated");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "owner.json"), '{"pid":2147483647}');
      await fs.writeFile(path.join(outside, "untouched.txt"), "unrelated");
      await fs.symlink(outside, lock, "junction");
      await expect(operate(kind, target, async () => {})).rejects.toThrow(JSON.stringify(lock));
      expect((await fs.lstat(lock)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(path.join(outside, "untouched.txt"), "utf8")).toBe("unrelated");
      expect(await fs.readFile(path.join(outside, "owner.json"), "utf8")).toBe(
        '{"pid":2147483647}',
      );
    },
  );
});
