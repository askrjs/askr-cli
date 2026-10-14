import fs from "node:fs/promises";
import path from "node:path";
import { withDirectoryTargetLock } from "../../src/directory-swap";
import { writeFileChanges } from "../../src/file-changes";

const [kind, target] = process.argv.slice(2);
const writeFile = fs.writeFile.bind(fs);
fs.writeFile = async (name, ...args) => {
  await writeFile(name, ...args);
  if (
    path.basename(String(name)).startsWith("owner-") &&
    path.dirname(String(name)).includes(".askr-lock.stage-")
  ) {
    process.send!({ stage: path.dirname(String(name)) });
    await new Promise<void>((resolve) => process.once("message", () => resolve()));
  }
};
if (kind === "directory") await withDirectoryTargetLock(target, async () => {});
else await writeFileChanges([{ filePath: target, content: "new", expectedContent: "old" }]);
