import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const ORPHANED_LOCK_AGE_MS = 30_000;
const OWNER_FILE = /^owner-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.json$/i;
const RENAME_CONTENTION_CODES = new Set(["EEXIST", "ENOTEMPTY", "EPERM", "EBUSY", "EACCES"]);
const LOCK_READ_SYSCALLS = new Set(["lstat", "scandir", "open", "read"]);

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function statIfPresent(target: string) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

function ambiguousLock(lock: string): Error {
  return new Error(
    `Cannot recover filesystem lock ${JSON.stringify(lock)}: its contents do not identify one regular owner record. Inspect the lock and preserve unrelated files before retrying.`,
  );
}

async function removeEmptyLock(lock: string): Promise<boolean> {
  try {
    await fs.rmdir(lock);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return true;
    if (isNodeError(error, "ENOTEMPTY") || isNodeError(error, "EEXIST")) return false;
    throw error;
  }
}

async function removeOrphanedLock(lock: string): Promise<boolean> {
  const stat = await statIfPresent(lock);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw ambiguousLock(lock);
  let entries: string[];
  try {
    entries = await fs.readdir(lock);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  if (entries.length === 0) {
    if (Date.now() - stat.mtimeMs < ORPHANED_LOCK_AGE_MS) return false;
    return removeEmptyLock(lock);
  }
  if (entries.length !== 1 || (entries[0] !== "owner.json" && !OWNER_FILE.test(entries[0]))) {
    throw ambiguousLock(lock);
  }
  const ownerPath = path.join(lock, entries[0]);
  const ownerStat = await statIfPresent(ownerPath);
  if (!ownerStat) return false;
  if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) throw ambiguousLock(lock);
  let pid: unknown;
  try {
    const owner = JSON.parse(await fs.readFile(ownerPath, "utf8")) as { pid?: unknown } | null;
    pid = owner?.pid;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (Number.isInteger(pid) && (pid as number) > 0 && (pid as number) <= 2_147_483_647) {
    try {
      process.kill(pid as number, 0);
      return false;
    } catch (error) {
      if (!isNodeError(error, "ESRCH") && !isNodeError(error, "EINVAL")) return false;
    }
  } else if (Date.now() - stat.mtimeMs < ORPHANED_LOCK_AGE_MS) {
    return false;
  }
  // Only one reaper can unlink this observed token. A new acquisition publishes
  // a different token atomically, so a delayed reaper cannot remove its owner.
  try {
    await fs.unlink(ownerPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  return removeEmptyLock(lock);
}

/** Acquires a cooperative lock and returns a release operation for its unique owner. */
export async function acquireFilesystemLock(
  lock: string,
  description: string,
): Promise<() => Promise<void>> {
  const ownerName = `owner-${randomUUID()}.json`;
  const stage = `${lock}.stage-${randomUUID()}`;
  // Build a nonempty lock privately before publishing it. Never expose a newly
  // acquired empty directory that another reaper could mistake for an orphan.
  await fs.mkdir(stage);
  try {
    await fs.writeFile(path.join(stage, ownerName), `${JSON.stringify({ pid: process.pid })}\n`, {
      flag: "wx",
    });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let lastError: unknown;
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${description} at ${JSON.stringify(lock)}. Inspect its owner before retrying.`,
          { cause: lastError },
        );
      }
      try {
        const lockStat = await statIfPresent(lock);
        if (lockStat && (!lockStat.isDirectory() || lockStat.isSymbolicLink())) {
          throw ambiguousLock(lock);
        }
        await fs.rename(stage, lock);
        return async () => {
          await fs.unlink(path.join(lock, ownerName));
          // Another contender can already have replaced the empty old lock with
          // its nonempty lock. Never recursively remove a successor's contents.
          await removeEmptyLock(lock);
        };
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "";
        if (!RENAME_CONTENTION_CODES.has(code)) throw error;
        lastError = error;
        try {
          if (await removeOrphanedLock(lock)) continue;
        } catch (inspectionError) {
          // Windows can deny reads while another owner removes its lock record.
          // Retry within the same deadline; a permanent denial retains its cause.
          if (
            !isNodeError(inspectionError, "EPERM") ||
            !LOCK_READ_SYSCALLS.has(inspectionError.syscall ?? "")
          ) {
            throw inspectionError;
          }
          lastError = inspectionError;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  } catch (error) {
    try {
      await fs.rm(stage, { recursive: true, force: true });
    } catch (cleanupFailure) {
      throw new AggregateError(
        [error, cleanupFailure],
        `Filesystem lock preparation failed; retained private lock stage ${JSON.stringify(stage)}. Remove this stage after resolving the filesystem error and retry.`,
        { cause: error },
      );
    }
    throw error;
  }
}
