import fs from "node:fs/promises";
import { writeManifestEdits } from "../../src/update/writer";

let replacements = 0;
await writeManifestEdits(
  process.argv.slice(2).map((manifestPath) => ({
    manifestPath,
    section: "dependencies" as const,
    package: "foo",
    currentSpecification: "1.0.0",
    proposedSpecification: "1.1.0",
  })),
  {
    async replace(from, to) {
      await fs.rename(from, to);
      if (++replacements === 1) {
        if (!process.send) throw new Error("Crash worker requires IPC.");
        process.send("first-replacement");
        await new Promise<void>((resolve) => process.once("message", () => resolve()));
      }
    },
  },
);
