import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyTargetIntoStage,
  createSiblingStage,
  publishStagedDirectory,
  withDirectoryTargetLock,
} from "../src/directory-swap";

const roots: string[] = [];

async function interruptedPublication(phase: string): Promise<{
  root: string;
  target: string;
  stage: string;
  backup: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-crash-"));
  roots.push(root);
  const target = path.join(root, "output");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "old.txt"), "old");
  const stage = await createSiblingStage(target, "test");
  await fs.writeFile(path.join(stage, "new.txt"), "new");
  const worker = fileURLToPath(
    new URL("./fixtures/directory-publication-crash-worker.ts", import.meta.url),
  );
  const child = fork(worker, [stage, target, phase], {
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    const [checkpoint] = (await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(5_000) }),
      exited.then(() => {
        throw new Error(`Crash worker exited before checkpoint: ${stderr}`);
      }),
    ])) as [{ phase: string; backup: string }];
    expect(checkpoint.phase).toBe(phase);
    expect(child.kill("SIGKILL")).toBe(true);
    await exited;
    return { root, target, stage, backup: checkpoint.backup };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("directory publication", () => {
  it.each(["prepared", "backed-up", "published"])(
    "recovers a publisher killed at the %s checkpoint before copying the live output",
    async (phase) => {
      const { root, target, stage, backup } = await interruptedPublication(phase);
      const copy = await createSiblingStage(target, "copy");
      expect(await copyTargetIntoStage(target, copy)).toBe(true);
      const file = phase === "published" ? "new.txt" : "old.txt";
      const contents = phase === "published" ? "new" : "old";
      expect(await fs.readFile(path.join(target, file), "utf8")).toBe(contents);
      expect(await fs.readFile(path.join(copy, file), "utf8")).toBe(contents);
      await expect(fs.access(backup)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(`${target}.askr-lock`)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await fs.readdir(root)).some((name) => name.endsWith(".askr-publication.json"))).toBe(
        false,
      );
      if (phase !== "published")
        expect(await fs.readFile(path.join(stage, "new.txt"), "utf8")).toBe("new");
    },
    10_000,
  );

  it("preserves the original backup when a different directory appears after an interrupted swap", async () => {
    const { target, backup } = await interruptedPublication("backed-up");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "unrelated.txt"), "unrelated");
    const copy = await createSiblingStage(target, "copy");
    await expect(copyTargetIntoStage(target, copy)).rejects.toThrow(JSON.stringify(backup));
    expect(await fs.readFile(path.join(target, "unrelated.txt"), "utf8")).toBe("unrelated");
    expect(await fs.readFile(path.join(backup, "old.txt"), "utf8")).toBe("old");
    expect(await fs.readdir(copy)).toEqual([]);
    await expect(fs.access(`${target}.askr-lock`)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);

  it.each([
    "invalid JSON",
    "unsupported version",
    "different target",
    "outside backup",
    "invalid backup name",
  ])(
    "preserves every directory and rejects a publication record with %s",
    async (fault) => {
      const { root, target, stage } = await interruptedPublication("prepared");
      const recordPath = path.join(root, ".output.askr-publication.json");
      const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
      const outside = path.join(root, "unrelated");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "untouched.txt"), "unrelated");
      if (fault === "unsupported version") record.version = 2;
      if (fault === "different target") record.target = outside;
      if (fault === "outside backup")
        record.backup = path.join(root, "..", path.basename(record.backup));
      if (fault === "invalid backup name") record.backup = outside;
      const contents = fault === "invalid JSON" ? "{" : JSON.stringify(record);
      await fs.writeFile(recordPath, contents);
      const copy = await createSiblingStage(target, "copy");
      await expect(copyTargetIntoStage(target, copy)).rejects.toThrow(JSON.stringify(recordPath));
      expect(await fs.readFile(recordPath, "utf8")).toBe(contents);
      expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
      expect(await fs.readFile(path.join(stage, "new.txt"), "utf8")).toBe("new");
      expect(await fs.readFile(path.join(outside, "untouched.txt"), "utf8")).toBe("unrelated");
      expect(await fs.readdir(copy)).toEqual([]);
    },
    10_000,
  );

  it.each(["record", "backup"])(
    "rejects a %s junction without following it during recovery",
    async (kind) => {
      const { root, target, backup } = await interruptedPublication("published");
      const recordPath = path.join(root, ".output.askr-publication.json");
      const outside = path.join(root, "unrelated");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "untouched.txt"), "unrelated");
      if (kind === "record") await fs.unlink(recordPath);
      else await fs.rename(backup, path.join(root, "saved-original"));
      const link = kind === "record" ? recordPath : backup;
      await fs.symlink(outside, link, "junction");
      const copy = await createSiblingStage(target, "copy");
      await expect(copyTargetIntoStage(target, copy)).rejects.toThrow(JSON.stringify(link));
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(path.join(target, "new.txt"), "utf8")).toBe("new");
      expect(await fs.readFile(path.join(outside, "untouched.txt"), "utf8")).toBe("unrelated");
      expect(
        await fs.readFile(
          path.join(kind === "record" ? backup : path.join(root, "saved-original"), "old.txt"),
          "utf8",
        ),
      ).toBe("old");
    },
    10_000,
  );

  it("stops recovery if both the recorded target and original backup are missing", async () => {
    const { root, target, backup } = await interruptedPublication("backed-up");
    const recordPath = path.join(root, ".output.askr-publication.json");
    await fs.rename(backup, path.join(root, "saved-original"));
    const stage = await createSiblingStage(target, "retry");
    await fs.writeFile(path.join(stage, "retry.txt"), "retry");
    await expect(publishStagedDirectory(stage, target)).rejects.toThrow("both target and backup");
    expect(await fs.readFile(path.join(root, "saved-original", "old.txt"), "utf8")).toBe("old");
    expect(await fs.readFile(path.join(stage, "retry.txt"), "utf8")).toBe("retry");
    await expect(fs.access(recordPath)).resolves.toBeUndefined();
    await expect(fs.access(target)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);

  it.each(["backup", "record"])(
    "finishes %s cleanup on the next operation after a successful publication",
    async (fault) => {
      const { root, target, stage } = await interruptedPublication("prepared");
      // Recovery of the prepared record leaves this caller-owned stage available.
      await withDirectoryTargetLock(target, async () => {});
      const recordPath = path.join(root, ".output.askr-publication.json");
      const rm = fs.rm.bind(fs);
      const denied = Object.assign(new Error("injected cleanup error"), { code: "EACCES" });
      const mock = vi.spyOn(fs, "rm").mockImplementation(async (...args) => {
        const name = String(args[0]);
        if (
          (fault === "record" && name === recordPath) ||
          (fault === "backup" && path.basename(name).startsWith(".output.askr-backup-"))
        )
          throw denied;
        return rm(...args);
      });
      try {
        await expect(publishStagedDirectory(stage, target)).resolves.toBeUndefined();
      } finally {
        mock.mockRestore();
      }
      const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
      expect(await fs.readFile(path.join(target, "new.txt"), "utf8")).toBe("new");
      if (fault === "backup")
        expect(await fs.readFile(path.join(record.backup, "old.txt"), "utf8")).toBe("old");
      const copy = await createSiblingStage(target, "copy");
      expect(await copyTargetIntoStage(target, copy)).toBe(true);
      expect(await fs.readFile(path.join(copy, "new.txt"), "utf8")).toBe("new");
      await expect(fs.access(record.backup)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
    10_000,
  );

  it("keeps the original backup when rollback fails and restores it on the next operation", async () => {
    const { root, target, stage } = await interruptedPublication("prepared");
    await withDirectoryTargetLock(target, async () => {});
    const rename = fs.rename.bind(fs);
    const failure = Object.assign(new Error("injected rename failure"), { code: "EIO" });
    const mock = vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      const source = String(args[0]);
      if (source === stage || path.basename(source).startsWith(".output.askr-backup-"))
        throw failure;
      return rename(...args);
    });
    let error: unknown;
    try {
      await publishStagedDirectory(stage, target);
    } catch (caught) {
      error = caught;
    } finally {
      mock.mockRestore();
    }
    const recordPath = path.join(root, ".output.askr-publication.json");
    const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain(JSON.stringify(record.backup));
    expect((error as AggregateError).errors[0]).toBe(failure);
    expect(await fs.readFile(path.join(record.backup, "old.txt"), "utf8")).toBe("old");
    expect(await fs.readFile(path.join(stage, "new.txt"), "utf8")).toBe("new");
    const copy = await createSiblingStage(target, "copy");
    expect(await copyTargetIntoStage(target, copy)).toBe(true);
    expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
    expect(await fs.readFile(path.join(copy, "old.txt"), "utf8")).toBe("old");
    await expect(fs.access(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);

  it.each(["file", "nested", "target itself"])(
    "rejects a %s stage before moving the original directory",
    async (kind) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-stage-"));
      roots.push(root);
      const target = path.join(root, "output");
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "old.txt"), "old");
      const stage =
        kind === "target itself"
          ? target
          : kind === "nested"
            ? path.join(target, "nested")
            : path.join(root, "stage-file");
      if (kind === "file") await fs.writeFile(stage, "stage");
      if (kind === "nested") await fs.mkdir(stage);
      await expect(publishStagedDirectory(stage, target)).rejects.toThrow(JSON.stringify(stage));
      expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
      if (kind === "file") expect(await fs.readFile(stage, "utf8")).toBe("stage");
      expect(
        (await fs.readdir(root)).some(
          (name) => name.endsWith(".askr-publication.json") || name.includes(".askr-backup-"),
        ),
      ).toBe(false);
    },
  );

  it("removes only its partial publication record if writing the record fails", async () => {
    const { root, target, stage } = await interruptedPublication("prepared");
    await withDirectoryTargetLock(target, async () => {});
    const recordPath = path.join(root, ".output.askr-publication.json");
    const open = fs.open.bind(fs);
    const failure = Object.assign(new Error("injected partial record write"), { code: "ENOSPC" });
    const mock = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]) === recordPath) {
        handle.writeFile = async () => {
          await handle.write("{");
          throw failure;
        };
      }
      return handle;
    });
    try {
      await expect(publishStagedDirectory(stage, target)).rejects.toBe(failure);
    } finally {
      mock.mockRestore();
    }
    expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
    expect(await fs.readFile(path.join(stage, "new.txt"), "utf8")).toBe("new");
    await expect(fs.access(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(publishStagedDirectory(stage, target)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(target, "new.txt"), "utf8")).toBe("new");
  }, 10_000);

  it("rejects an existing regular-file destination without changing it or the stage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-file-"));
    roots.push(root);
    const target = path.join(root, "output");
    await fs.writeFile(target, "unrelated");
    const stage = await createSiblingStage(target, "test");
    await fs.writeFile(path.join(stage, "new.txt"), "new");
    await expect(publishStagedDirectory(stage, target)).rejects.toThrow(JSON.stringify(target));
    expect(await fs.readFile(target, "utf8")).toBe("unrelated");
    expect(await fs.readFile(path.join(stage, "new.txt"), "utf8")).toBe("new");
  });

  it.each(["copy", "publish"])(
    "rejects a symbolic-link destination when attempting to %s",
    async (operation) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-link-"));
      roots.push(root);
      const outside = path.join(root, "outside");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "untouched.txt"), "unrelated");
      const target = path.join(root, "output");
      await fs.symlink(outside, target, "junction");
      const stage = await createSiblingStage(target, "test");
      await expect(
        operation === "copy"
          ? copyTargetIntoStage(target, stage)
          : publishStagedDirectory(stage, target),
      ).rejects.toThrow(JSON.stringify(target));
      expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(path.join(outside, "untouched.txt"), "utf8")).toBe("unrelated");
    },
  );

  it.each(["copy", "publish"])(
    "rejects a target permission error when attempting to %s",
    async (operation) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-denied-"));
      roots.push(root);
      const target = path.join(root, "output");
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "old.txt"), "old");
      const stage = await createSiblingStage(target, "test");
      const stat = fs.stat.bind(fs);
      const lstat = fs.lstat.bind(fs);
      const denied = Object.assign(new Error("injected permission error"), { code: "EACCES" });
      vi.spyOn(fs, "stat").mockImplementation(async (...args) => {
        if (String(args[0]) === target) throw denied;
        return stat(...args);
      });
      vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
        if (String(args[0]) === target) throw denied;
        return lstat(...args);
      });
      try {
        await expect(
          operation === "copy"
            ? copyTargetIntoStage(target, stage)
            : publishStagedDirectory(stage, target),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        vi.restoreAllMocks();
      }
      expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
      await expect(fs.access(`${target}.askr-lock`)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("should replace a directory only after its complete stage exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-swap-"));
    roots.push(root);
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "old.txt"), "old");
    const stage = await createSiblingStage(target, "test");
    await fs.writeFile(path.join(stage, "new.txt"), "new");

    await publishStagedDirectory(stage, target);

    expect(await fs.readFile(path.join(target, "new.txt"), "utf8")).toBe("new");
    await expect(fs.access(path.join(target, "old.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should restore the original directory when stage publication fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-rollback-"));
    roots.push(root);
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "old.txt"), "old");

    await expect(
      publishStagedDirectory(path.join(root, "missing-stage"), target),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
  });

  it("should restore the original directory when a Windows rename error persists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-eperm-"));
    roots.push(root);
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "old.txt"), "old");
    const stage = await createSiblingStage(target, "test");
    await fs.writeFile(path.join(stage, "new.txt"), "new");
    const originalRename = fs.rename.bind(fs);
    let stageAttempts = 0;
    const rename = vi.spyOn(fs, "rename").mockImplementation((async (
      ...args: Parameters<typeof fs.rename>
    ) => {
      if (path.resolve(String(args[0])) === stage) {
        stageAttempts += 1;
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return originalRename(...args);
    }) as typeof fs.rename);

    try {
      await expect(publishStagedDirectory(stage, target)).rejects.toMatchObject({ code: "EBUSY" });
    } finally {
      rename.mockRestore();
    }

    expect(stageAttempts).toBeGreaterThan(1);
    expect(await fs.readFile(path.join(target, "old.txt"), "utf8")).toBe("old");
    await expect(fs.access(`${target}.askr-lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should recover a lock left by an interrupted publisher", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-orphan-"));
    roots.push(root);
    const target = path.join(root, "output");
    const lock = `${target}.askr-lock`;
    const stage = await createSiblingStage(target, "test");
    await fs.writeFile(path.join(stage, "complete.txt"), "new");
    await fs.mkdir(lock);
    await fs.writeFile(path.join(lock, "owner.json"), '{"pid":2147483647}\n');

    await expect(publishStagedDirectory(stage, target)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(target, "complete.txt"), "utf8")).resolves.toBe("new");
    await expect(fs.access(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should not stage a copy while another build is swapping the target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-copy-race-"));
    roots.push(root);
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "old.txt"), "old");
    const stage = await createSiblingStage(target, "copy");

    let release!: () => void;
    const swapping = new Promise<void>((resolve) => (release = resolve));
    let swapStarted!: () => void;
    const started = new Promise<void>((resolve) => (swapStarted = resolve));
    // A concurrent build holds the lock and has the target half-swapped.
    const swap = withDirectoryTargetLock(target, async () => {
      await fs.rm(target, { recursive: true, force: true });
      swapStarted();
      await swapping;
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "new.txt"), "new");
    });
    await started;

    let copied = false;
    const copy = copyTargetIntoStage(target, stage).then((result) => {
      copied = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(copied).toBe(false);

    release();
    await swap;
    expect(await copy).toBe(true);
    expect(await fs.readdir(stage)).toEqual(["new.txt"]);
  });

  it("should report that nothing was staged when the target does not exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-directory-copy-missing-"));
    roots.push(root);
    const target = path.join(root, "target");
    const stage = await createSiblingStage(target, "copy");

    expect(await copyTargetIntoStage(target, stage)).toBe(false);
    expect(await fs.readdir(stage)).toEqual([]);
  });
});
