import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(filePath: string): string {
  const resolvedPath = resolve(filePath);

  try {
    return typeof realpathSync.native === "function"
      ? realpathSync.native(resolvedPath)
      : realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function isDirectExecution(
  moduleUrl: string,
  argvPath: string | undefined = process.argv[1],
): boolean {
  if (!argvPath) {
    return false;
  }

  return normalizePath(argvPath) === normalizePath(fileURLToPath(moduleUrl));
}
