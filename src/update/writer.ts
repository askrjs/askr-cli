import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { ManifestValueEdit } from "./types";

interface StagedManifest {
  manifestPath: string;
  original: Buffer;
  replacement: string;
  temporaryPath: string;
  mode: number;
}

interface WriterOptions {
  replace?: (temporaryPath: string, manifestPath: string) => Promise<void>;
}

function groupEdits(edits: ManifestValueEdit[]): Map<string, ManifestValueEdit[]> {
  const grouped = new Map<string, ManifestValueEdit[]>();
  for (const edit of edits) {
    const entries = grouped.get(edit.manifestPath) ?? [];
    entries.push(edit);
    grouped.set(edit.manifestPath, entries);
  }
  for (const entries of grouped.values()) {
    entries.sort(
      (left, right) =>
        left.section.localeCompare(right.section) || left.package.localeCompare(right.package),
    );
  }
  return new Map([...grouped].sort(([left], [right]) => left.localeCompare(right)));
}

function renderReplacement(source: string, edits: ManifestValueEdit[]): string {
  const errors: ParseError[] = [];
  const manifest = parse(source, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length > 0 || !manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Manifest changed to invalid JSON before writing.");
  }

  let result = source;
  for (const edit of edits) {
    const dependencies = (manifest as Record<string, unknown>)[edit.section];
    const current =
      dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)
        ? (dependencies as Record<string, unknown>)[edit.package]
        : undefined;
    if (current !== edit.currentSpecification) {
      throw new Error(`Manifest changed before writing: ${edit.manifestPath}`);
    }
    result = applyEdits(
      result,
      modify(result, [edit.section, edit.package], edit.proposedSpecification, {}),
    );
  }
  return result;
}

async function cleanup(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)),
  );
}

async function rollback(replaced: StagedManifest[]): Promise<boolean> {
  let complete = true;
  for (const staged of [...replaced].reverse()) {
    const rollbackPath = path.join(
      path.dirname(staged.manifestPath),
      `.${path.basename(staged.manifestPath)}.askr-rollback-${randomUUID()}`,
    );
    try {
      await fs.writeFile(rollbackPath, staged.original, { flag: "wx", mode: staged.mode });
      await fs.rename(rollbackPath, staged.manifestPath);
    } catch {
      complete = false;
      await fs.rm(rollbackPath, { force: true }).catch(() => undefined);
    }
  }
  return complete;
}

export async function writeManifestEdits(
  edits: ManifestValueEdit[],
  options: WriterOptions = {},
): Promise<number> {
  if (edits.length === 0) return 0;
  const staged: StagedManifest[] = [];
  const replace = options.replace ?? fs.rename;

  try {
    for (const [manifestPath, manifestEdits] of groupEdits(edits)) {
      const [original, stat] = await Promise.all([
        fs.readFile(manifestPath),
        fs.stat(manifestPath),
      ]);
      const replacement = renderReplacement(original.toString("utf8"), manifestEdits);
      const temporaryPath = path.join(
        path.dirname(manifestPath),
        `.${path.basename(manifestPath)}.askr-update-${randomUUID()}`,
      );
      await fs.writeFile(temporaryPath, replacement, { flag: "wx", mode: stat.mode });
      staged.push({ manifestPath, original, replacement, temporaryPath, mode: stat.mode });
    }
  } catch (error) {
    await cleanup(staged.map((entry) => entry.temporaryPath));
    throw error;
  }

  const replaced: StagedManifest[] = [];
  try {
    for (const manifest of staged) {
      await replace(manifest.temporaryPath, manifest.manifestPath);
      replaced.push(manifest);
    }
  } catch {
    const rollbackComplete = await rollback(replaced);
    await cleanup(staged.map((entry) => entry.temporaryPath));
    throw new Error(
      rollbackComplete
        ? "Manifest replacement failed; completed replacements were rolled back."
        : "Manifest replacement failed and rollback was incomplete.",
    );
  }

  return edits.length;
}
