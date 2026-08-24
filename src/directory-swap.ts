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

export async function publishStagedDirectory(stage: string, target: string): Promise<void> {
  return withDirectoryTargetLock(target, async () => {
    const resolvedTarget = path.resolve(target);
    const backup = path.join(
      path.dirname(resolvedTarget),
      `.${path.basename(resolvedTarget)}.askr-backup-${randomUUID()}`,
    );
    const hadTarget = await exists(resolvedTarget);
    let movedTarget = false;

    try {
      if (hadTarget) {
        await fs.rename(resolvedTarget, backup);
        movedTarget = true;
      }
      await fs.rename(stage, resolvedTarget);
    } catch (error) {
      if (movedTarget && !(await exists(resolvedTarget)) && (await exists(backup))) {
        await fs.rename(backup, resolvedTarget);
      }
      throw error;
    }

    if (movedTarget) await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
  });
}
