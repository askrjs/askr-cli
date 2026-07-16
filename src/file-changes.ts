import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface FileChange {
  readonly filePath: string;
  readonly content: string;
}

interface StagedChange extends FileChange {
  readonly original: Buffer | null;
  readonly mode: number;
  readonly temporaryPath: string;
}

export interface FileChangeWriterOptions {
  readonly replace?: (temporaryPath: string, filePath: string) => Promise<void>;
}

async function remove(paths: readonly string[]): Promise<void> {
  await Promise.all(
    paths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)),
  );
}

async function restore(changes: readonly StagedChange[]): Promise<boolean> {
  let complete = true;
  for (const change of [...changes].reverse()) {
    try {
      if (change.original === null) {
        await fs.rm(change.filePath, { force: true });
        continue;
      }
      const rollbackPath = path.join(
        path.dirname(change.filePath),
        `.${path.basename(change.filePath)}.askr-rollback-${randomUUID()}`,
      );
      await fs.writeFile(rollbackPath, change.original, { flag: "wx", mode: change.mode });
      await fs.rename(rollbackPath, change.filePath);
    } catch {
      complete = false;
    }
  }
  return complete;
}

export async function writeFileChanges(
  changes: readonly FileChange[],
  options: FileChangeWriterOptions = {},
): Promise<void> {
  const ordered = [...changes].sort((left, right) => left.filePath.localeCompare(right.filePath));
  if (new Set(ordered.map((change) => change.filePath)).size !== ordered.length) {
    throw new Error("File changes contain duplicate target paths.");
  }
  const replace = options.replace ?? fs.rename;
  const staged: StagedChange[] = [];
  try {
    for (const change of ordered) {
      await fs.mkdir(path.dirname(change.filePath), { recursive: true });
      const stat = await fs.stat(change.filePath).catch(() => null);
      const original = stat ? await fs.readFile(change.filePath) : null;
      const temporaryPath = path.join(
        path.dirname(change.filePath),
        `.${path.basename(change.filePath)}.askr-change-${randomUUID()}`,
      );
      const mode = stat?.mode ?? 0o644;
      await fs.writeFile(temporaryPath, change.content, { flag: "wx", mode });
      staged.push({ ...change, original, mode, temporaryPath });
    }
  } catch (error) {
    await remove(staged.map((change) => change.temporaryPath));
    throw error;
  }

  const replaced: StagedChange[] = [];
  try {
    for (const change of staged) {
      await replace(change.temporaryPath, change.filePath);
      replaced.push(change);
    }
  } catch {
    const complete = await restore(replaced);
    await remove(staged.map((change) => change.temporaryPath));
    throw new Error(
      complete
        ? "File replacement failed; completed changes were rolled back."
        : "File replacement failed and rollback was incomplete.",
    );
  }
}
