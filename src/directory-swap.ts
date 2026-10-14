import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { acquireFilesystemLock } from "./filesystem-lock";

async function directoryStat(target: string): Promise<BigIntStats | null> {
  let stat: BigIntStats;
  try {
    stat = await fs.lstat(target, { bigint: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `Expected a directory at ${JSON.stringify(target)}; choose a directory destination without a symbolic link.`,
    );
  }
  return stat;
}

interface PublicationRecord {
  version: 1;
  target: string;
  backup: string;
  publishedIdentity: { device: string; inode: string };
}

function publicationPath(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.askr-publication.json`);
}

function recoveryError(recordPath: string, detail: string, cause?: unknown): Error {
  return new Error(
    `Cannot recover directory publication recorded at ${JSON.stringify(recordPath)}: ${detail}. Inspect the recorded target and backup before retrying.`,
    { cause },
  );
}

async function readPublicationRecord(target: string): Promise<PublicationRecord | null> {
  const recordPath = publicationPath(target);
  let text: string;
  try {
    const stat = await fs.lstat(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw recoveryError(recordPath, "the record is not a regular file");
    }
    text = await fs.readFile(recordPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
  let record: PublicationRecord;
  try {
    record = JSON.parse(text) as PublicationRecord;
  } catch (error) {
    throw recoveryError(recordPath, "the record is not valid JSON", error);
  }
  const prefix = `.${path.basename(target)}.askr-backup-`;
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const decimal = /^\d+$/;
  if (
    !record ||
    record.version !== 1 ||
    record.target !== target ||
    typeof record.backup !== "string" ||
    path.dirname(record.backup) !== path.dirname(target) ||
    !path.basename(record.backup).startsWith(prefix) ||
    !uuid.test(path.basename(record.backup).slice(prefix.length)) ||
    path.resolve(record.backup) !== record.backup ||
    typeof record.publishedIdentity?.device !== "string" ||
    typeof record.publishedIdentity?.inode !== "string" ||
    !decimal.test(record.publishedIdentity.device) ||
    !decimal.test(record.publishedIdentity.inode)
  ) {
    throw recoveryError(
      recordPath,
      "the record does not describe this target and its sibling backup",
    );
  }
  return record;
}

async function writePublicationRecord(record: PublicationRecord): Promise<void> {
  const recordPath = publicationPath(record.target);
  const handle = await fs.open(recordPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.rm(recordPath).catch(() => undefined);
    throw error;
  }
}

async function cleanPublication(record: PublicationRecord): Promise<void> {
  await fs.rm(record.backup, { recursive: true, force: true });
  await fs.rm(publicationPath(record.target));
}

async function recoverPublication(target: string): Promise<void> {
  const record = await readPublicationRecord(target);
  if (!record) return;
  const recordPath = publicationPath(target);
  const live = await directoryStat(target);
  const backup = await directoryStat(record.backup);
  if (!live && backup) {
    await renameWithRetry(record.backup, target);
    await fs.rm(recordPath);
  } else if (live && !backup) {
    // The old tree never moved, or cleanup already removed its backup.
    await fs.rm(recordPath);
  } else if (live && backup) {
    const identity = record.publishedIdentity;
    if (
      live.ino === 0n ||
      live.dev.toString() !== identity.device ||
      live.ino.toString() !== identity.inode
    ) {
      throw recoveryError(
        recordPath,
        `the live directory differs from the published stage; original backup retained at ${JSON.stringify(record.backup)}`,
      );
    }
    await cleanPublication(record);
  } else {
    throw recoveryError(
      recordPath,
      `both target and backup ${JSON.stringify(record.backup)} are missing`,
    );
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function withDirectoryTargetLock<T>(
  target: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = `${path.resolve(target)}.askr-lock`;
  const release = await acquireFilesystemLock(lock, `directory lock for ${JSON.stringify(target)}`);
  try {
    await recoverPublication(path.resolve(target));
    return await operation();
  } finally {
    await release();
  }
}

export async function createSiblingStage(target: string, label: string): Promise<string> {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, `.${path.basename(resolved)}.${label}-`));
}

/**
 * Copies the live `target` into `stage` while holding the target lock, so the
 * copy can never observe a folder another build is half-way through swapping.
 * The lock covers only the copy, not site generation. Resolves to `false` when
 * the target does not exist and nothing was copied.
 */
export async function copyTargetIntoStage(target: string, stage: string): Promise<boolean> {
  return withDirectoryTargetLock(target, async () => {
    const resolvedTarget = path.resolve(target);
    if (!(await directoryStat(resolvedTarget))) return false;
    await fs.cp(resolvedTarget, stage, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
    return true;
  });
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
  const resolvedStage = path.resolve(stage);
  if (
    resolvedStage === resolvedTarget ||
    path.dirname(resolvedStage) !== path.dirname(resolvedTarget)
  ) {
    throw new Error(
      `Stage ${JSON.stringify(resolvedStage)} must be a separate sibling directory of ${JSON.stringify(resolvedTarget)}; create a sibling stage before publishing.`,
    );
  }
  const stageStat = await directoryStat(resolvedStage);
  if (!stageStat)
    throw new Error(
      `Stage directory ${JSON.stringify(resolvedStage)} is missing; create the complete stage before publishing.`,
    );
  const hadTarget = await directoryStat(resolvedTarget);
  if (!hadTarget) {
    await renameWithRetry(resolvedStage, resolvedTarget);
    return;
  }
  const backup = path.join(
    path.dirname(resolvedTarget),
    `.${path.basename(resolvedTarget)}.askr-backup-${randomUUID()}`,
  );
  const record: PublicationRecord = {
    version: 1,
    target: resolvedTarget,
    backup,
    publishedIdentity: { device: stageStat.dev.toString(), inode: stageStat.ino.toString() },
  };
  if (await directoryStat(backup))
    throw new Error(
      `Backup destination ${JSON.stringify(backup)} already exists; retry with a new stage.`,
    );
  await writePublicationRecord(record);

  try {
    await renameWithRetry(resolvedTarget, backup);
    await renameWithRetry(resolvedStage, resolvedTarget);
  } catch (error) {
    try {
      await recoverPublication(resolvedTarget);
    } catch (recoveryFailure) {
      throw new AggregateError(
        [error, recoveryFailure],
        `Directory publication failed and could not restore ${JSON.stringify(resolvedTarget)}; original backup retained at ${JSON.stringify(backup)}. Inspect ${JSON.stringify(publicationPath(resolvedTarget))} and retry after resolving the filesystem error.`,
      );
    }
    throw error;
  }

  // Publication succeeded. Leave the record if cleanup fails so the next
  // locked operation can finish cleanup before copying or replacing the tree.
  await cleanPublication(record).catch(() => undefined);
}

export async function publishStagedDirectory(stage: string, target: string): Promise<void> {
  return withDirectoryTargetLock(target, () => swapStagedDirectoryLocked(stage, target));
}
