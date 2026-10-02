import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyTargetIntoStage,
  createSiblingStage,
  publishStagedDirectory,
  withDirectoryTargetLock,
} from "../src/directory-swap";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("directory publication", () => {
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
