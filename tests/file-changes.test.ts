import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileChanges } from "../src/file-changes";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("writeFileChanges", () => {
  it("should reject a stale shared-file edit before writing any transaction artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-file-changes-stale-"));
    roots.push(root);
    const shared = path.join(root, "shared.ts");
    const created = path.join(root, "created.ts");
    await fs.writeFile(shared, "changed by another process\n");

    await expect(
      writeFileChanges([
        { filePath: created, content: "orphan\n" },
        {
          filePath: shared,
          content: "planned replacement\n",
          expectedContent: "original at plan time\n",
        },
      ]),
    ).rejects.toThrow("File changed before writing");

    expect(await fs.readFile(shared, "utf8")).toBe("changed by another process\n");
    await expect(fs.stat(created)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should restore replaced files and remove created files after a replacement failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-file-changes-"));
    roots.push(root);
    const existing = path.join(root, "a-existing.ts");
    const created = path.join(root, "b-created.ts");
    await fs.writeFile(existing, "original\n");
    let replacements = 0;

    await expect(
      writeFileChanges(
        [
          { filePath: existing, content: "replacement\n" },
          { filePath: created, content: "created\n" },
        ],
        {
          async replace(temporaryPath, filePath) {
            replacements += 1;
            if (replacements === 2) throw new Error("injected failure");
            await fs.rename(temporaryPath, filePath);
          },
        },
      ),
    ).rejects.toThrow("completed changes were rolled back");

    expect(await fs.readFile(existing, "utf8")).toBe("original\n");
    await expect(fs.stat(created)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
