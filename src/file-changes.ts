import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireFilesystemLock } from "./filesystem-lock";

export interface FileChange {
  readonly filePath: string;
  readonly content: string;
  /** Content observed while planning a shared-file edit; `null` means the file was absent. */
  readonly expectedContent?: string | null;
}

interface StagedChange extends FileChange {
  readonly backupPath: string | null;
  readonly temporaryPath: string;
}

export interface FileChangeWriterOptions {
  readonly replace?: (temporaryPath: string, filePath: string) => Promise<void>;
}

interface FileLock {
  readonly release: () => Promise<void>;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function acquireFileLock(filePath: string): Promise<FileLock> {
  const lockPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.askr-lock`);
  return {
    release: await acquireFilesystemLock(
      lockPath,
      `file transaction lock for ${JSON.stringify(filePath)}`,
    ),
  };
}

async function releaseFileLocks(locks: readonly FileLock[]): Promise<void> {
  await Promise.all([...locks].reverse().map((lock) => lock.release()));
}

async function readCurrentContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

function hasExpectedContent(
  change: FileChange,
): change is FileChange & { readonly expectedContent: string | null } {
  return Object.prototype.hasOwnProperty.call(change, "expectedContent");
}

async function remove(paths: readonly string[]): Promise<void> {
  await Promise.all(
    paths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)),
  );
}

interface RestoreFailure {
  readonly filePath: string;
  readonly backupPath: string | null;
}

async function restore(changes: readonly StagedChange[]): Promise<RestoreFailure[]> {
  const failures: RestoreFailure[] = [];
  for (const change of [...changes].reverse()) {
    try {
      if (change.backupPath === null) {
        await fs.rm(change.filePath, { force: true });
        continue;
      }
      await fs.rename(change.backupPath, change.filePath);
    } catch {
      failures.push({ filePath: change.filePath, backupPath: change.backupPath });
    }
  }
  return failures;
}

async function writeOwnedFile(
  filePath: string,
  content: string | Buffer,
  mode: number | undefined,
  owned: string[],
): Promise<void> {
  const handle = await fs.open(filePath, "wx", mode ?? 0o644);
  owned.push(filePath);
  try {
    await handle.writeFile(content);
    if (mode !== undefined) await handle.chmod(mode);
  } finally {
    await handle.close();
  }
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
  const guarded = ordered.filter(hasExpectedContent);
  const locks: FileLock[] = [];
  try {
    for (const change of guarded) {
      await fs.mkdir(path.dirname(change.filePath), { recursive: true });
      locks.push(await acquireFileLock(change.filePath));
    }
    for (const change of guarded) {
      if ((await readCurrentContent(change.filePath)) !== change.expectedContent) {
        throw new Error(`File changed before writing: ${change.filePath}`);
      }
    }
    await writeStagedChanges(ordered, replace);
  } finally {
    await releaseFileLocks(locks);
  }
}

async function writeStagedChanges(
  ordered: readonly FileChange[],
  replace: (temporaryPath: string, filePath: string) => Promise<void>,
): Promise<void> {
  const staged: StagedChange[] = [];
  const owned: string[] = [];
  try {
    for (const change of ordered) {
      await fs.mkdir(path.dirname(change.filePath), { recursive: true });
      const stat = await fs.stat(change.filePath).catch((error: unknown) => {
        if (isNodeError(error, "ENOENT")) return null;
        throw error;
      });
      const original = stat ? await fs.readFile(change.filePath) : null;
      const backupPath = stat
        ? path.join(
            path.dirname(change.filePath),
            `.${path.basename(change.filePath)}.askr-rollback-${randomUUID()}`,
          )
        : null;
      const temporaryPath = path.join(
        path.dirname(change.filePath),
        `.${path.basename(change.filePath)}.askr-change-${randomUUID()}`,
      );
      const mode = stat?.mode;
      if (backupPath && original !== null) await writeOwnedFile(backupPath, original, mode, owned);
      await writeOwnedFile(temporaryPath, change.content, mode, owned);
      staged.push({ ...change, backupPath, temporaryPath });
    }
  } catch (error) {
    await remove(owned);
    throw error;
  }

  const replaced: StagedChange[] = [];
  try {
    for (const change of staged) {
      await replace(change.temporaryPath, change.filePath);
      replaced.push(change);
    }
  } catch (error) {
    const failures = await restore(replaced);
    const preserved = new Set(failures.map((failure) => failure.backupPath));
    await remove(owned.filter((filePath) => !preserved.has(filePath)));
    const recovery = failures.map(({ filePath, backupPath }) =>
      backupPath
        ? `Restore ${JSON.stringify(filePath)} from ${JSON.stringify(backupPath)}.`
        : `Remove the newly created file ${JSON.stringify(filePath)}.`,
    );
    throw new Error(
      failures.length === 0
        ? "File replacement failed; completed changes were rolled back."
        : `File replacement failed and rollback was incomplete. ${recovery.join(" ")}`,
      { cause: error },
    );
  }
  await remove(owned);
}
