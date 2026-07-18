import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function exists(target: string): Promise<boolean> {
  return Boolean(await fs.stat(target).catch(() => null));
}

export async function createSiblingStage(target: string, label: string): Promise<string> {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, `.${path.basename(resolved)}.${label}-`));
}

export async function publishStagedDirectory(stage: string, target: string): Promise<void> {
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
}
