import fs from "node:fs/promises";
import { publishStagedDirectory } from "../../src/directory-swap";

const [stage, target, phase] = process.argv.slice(2);
const rename = fs.rename.bind(fs);
let backup = "";
async function checkpoint(at: string): Promise<void> {
  if (phase !== at) return;
  if (!process.send) throw new Error("Crash worker requires IPC.");
  process.send({ phase, backup });
  await new Promise<void>((resolve) => process.once("message", () => resolve()));
}

fs.rename = async (from, to) => {
  if (String(from) === target) {
    backup = String(to);
    await checkpoint("prepared");
  }
  await rename(from, to);
  if (String(from) === target) await checkpoint("backed-up");
  if (String(from) === stage) await checkpoint("published");
};
await publishStagedDirectory(stage, target);
