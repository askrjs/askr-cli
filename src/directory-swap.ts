import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function exists(target: string): Promise<boolean> {
  return Boolean(await fs.stat(target).catch(() => null));
}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const ORPHANED_LOCK_AGE_MS = 30_000;

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function removeOrphanedLock(lock: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")) as {
      pid?: unknown;
    };
    if (Number.isInteger(owner.pid) && (owner.pid as number) > 0) {
      try {
        process.kill(owner.pid as number, 0);
        return false;
      } catch (error) {
        if (!isNodeError(error, "ESRCH") && !isNodeError(error, "EINVAL")) return false;
      }
    } else {
      return false;
    }
  } catch {
    const stat = await fs.stat(lock).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < ORPHANED_LOCK_AGE_MS) return false;
  }
  await fs.rm(lock, { recursive: true, force: true });
  return true;
}

export async function withDirectoryTargetLock<T>(
  target: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = `${path.resolve(target)}.askr-lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(
        path.join(lock, "owner.json"),
        `${JSON.stringify({ pid: process.pid })}\n`,
        {
          flag: "wx",
        },
      );
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      if (await removeOrphanedLock(lock)) continue;
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for directory lock: ${target}`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

export async function createSiblingStage(target: string, label: string): Promise<string> {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, `.${path.basename(resolved)}.${label}-`));
}

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 640];

/**
 * Renames `from` to `to`, retrying briefly when Windows reports that another
 * handle (antivirus, indexer, a concurrent reader) is still open beneath the
 * directory. Non-transient errors and exhausted retries are rethrown unchanged.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!TRANSIENT_RENAME_CODES.has(code) || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Swaps a complete stage into `target`. The caller must already hold
 * `withDirectoryTargetLock(target)`; use `publishStagedDirectory` otherwise.
 */
export async function swapStagedDirectoryLocked(stage: string, target: string): Promise<void> {
  const resolvedTarget = path.resolve(target);
  const backup = path.join(
    path.dirname(resolvedTarget),
    `.${path.basename(resolvedTarget)}.askr-backup-${randomUUID()}`,
  );
  const hadTarget = await exists(resolvedTarget);
  let movedTarget = false;

  try {
    if (hadTarget) {
      await renameWithRetry(resolvedTarget, backup);
      movedTarget = true;
    }
    await renameWithRetry(stage, resolvedTarget);
  } catch (error) {
    if (movedTarget && !(await exists(resolvedTarget)) && (await exists(backup))) {
      await renameWithRetry(backup, resolvedTarget);
    }
    throw error;
  }

  if (movedTarget) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

export async function publishStagedDirectory(stage: string, target: string): Promise<void> {
  return withDirectoryTargetLock(target, () => swapStagedDirectoryLocked(stage, target));
}
