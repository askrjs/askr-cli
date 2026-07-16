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
