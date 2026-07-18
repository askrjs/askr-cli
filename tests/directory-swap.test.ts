import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSiblingStage, publishStagedDirectory } from "../src/directory-swap";

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
});
