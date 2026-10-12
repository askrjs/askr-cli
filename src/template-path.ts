import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function findTemplateDir(template: string): Promise<string> {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(base, "..", "templates", template),
    path.resolve(base, "..", "..", "templates", template),
    path.resolve(base, "templates", template),
  ];
  for (const candidate of candidates) {
    if (await fs.stat(candidate).catch(() => null)) return candidate;
  }
  return candidates[0];
}
