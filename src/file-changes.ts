import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface FileChange {
  readonly filePath: string;
  readonly content: string;
  /** Content observed while planning a shared-file edit; `null` means the file was absent. */
  readonly expectedContent?: string | null;
}

interface StagedChange extends FileChange {
  readonly original: Buffer | null;
  readonly mode: number;
  readonly temporaryPath: string;
}

export interface FileChangeWriterOptions {
  readonly replace?: (temporaryPath: string, filePath: string) => Promise<void>;
}

interface FileLock {
  readonly lockPath: string;
}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const ORPHANED_LOCK_AGE_MS = 30_000;

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ownerIsAlive(lockPath: string): Promise<boolean | undefined> {
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")) as {
      pid?: unknown;
    };
    if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) return undefined;
    try {
      process.kill(owner.pid as number, 0);
      return true;
    } catch (error) {
      if (isNodeError(error, "ESRCH")) return false;
      return true;
    }
  } catch {
    return undefined;
  }
}

async function removeOrphanedLock(lockPath: string): Promise<boolean> {
  const ownerAlive = await ownerIsAlive(lockPath);
  if (ownerAlive === true) return false;
  if (ownerAlive === undefined) {
    const stat = await fs.stat(lockPath).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < ORPHANED_LOCK_AGE_MS) return false;
  }
  await fs.rm(lockPath, { recursive: true, force: true });
  return true;
}

async function acquireFileLock(filePath: string): Promise<FileLock> {
  const lockPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.askr-lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid })}\n`,
        { flag: "wx" },
      );
      return { lockPath };
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      if (await removeOrphanedLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for file transaction lock: ${filePath}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

async function releaseFileLocks(locks: readonly FileLock[]): Promise<void> {
  await Promise.all(
    [...locks].reverse().map((lock) => fs.rm(lock.lockPath, { recursive: true, force: true })),
  );
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
