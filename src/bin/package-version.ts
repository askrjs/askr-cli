import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

export function getCliVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
        version?: string;
      };

      if (parsed.name === "@askrjs/cli" && typeof parsed.version === "string") {
        cachedVersion = parsed.version;
        return cachedVersion;
      }
    } catch {
      // Keep walking upward until we find the package root.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error("Could not determine @askrjs/cli package version.");
}
