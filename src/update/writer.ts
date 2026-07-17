import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

interface JsonNode {
  end: number;
  kind: "array" | "object" | "other" | "string";
  properties?: Map<string, JsonNode>;
  start: number;
  value?: string;
}

class JsonTreeParser {
  private index = 0;

  constructor(private readonly source: string) {
    if (source.charCodeAt(0) === 0xfeff) this.index = 1;
  }

  parse(): JsonNode {
    const node = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error("Unexpected content after JSON value");
    return node;
  }

  private skipWhitespace(): void {
    while (/[ \t\r\n]/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  private parseValue(): JsonNode {
    this.skipWhitespace();
    const token = this.source[this.index];
    if (token === "{") return this.parseObject();
    if (token === "[") return this.parseArray();
    if (token === '"') return this.parseString();
    return this.parsePrimitive();
  }

  private parseString(): JsonNode {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const token = this.source[this.index];
      if (token === "\\") {
        this.index += 2;
        continue;
      }
      this.index += 1;
      if (token === '"') {
        const raw = this.source.slice(start, this.index);
        const value = JSON.parse(raw) as unknown;
        if (typeof value !== "string") throw new Error("Invalid JSON string");
        return { end: this.index, kind: "string", start, value };
      }
    }
    throw new Error("Unterminated JSON string");
  }

  private parseObject(): JsonNode {
    const start = this.index;
    const properties = new Map<string, JsonNode>();
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return { end: this.index, kind: "object", properties, start };
    }

    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') throw new Error("Expected a JSON object key");
      const key = this.parseString().value!;
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new Error("Expected ':' after JSON object key");
      this.index += 1;
      properties.set(key, this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return { end: this.index, kind: "object", properties, start };
      }
      if (this.source[this.index] !== ",") throw new Error("Expected ',' in JSON object");
      this.index += 1;
    }
    throw new Error("Unterminated JSON object");
  }

  private parseArray(): JsonNode {
    const start = this.index;
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return { end: this.index, kind: "array", start };
    }

    while (this.index < this.source.length) {
      this.parseValue();
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return { end: this.index, kind: "array", start };
      }
      if (this.source[this.index] !== ",") throw new Error("Expected ',' in JSON array");
      this.index += 1;
    }
    throw new Error("Unterminated JSON array");
  }

  private parsePrimitive(): JsonNode {
    const start = this.index;
    while (this.index < this.source.length && !/[ \t\r\n,\]}]/.test(this.source[this.index])) {
      this.index += 1;
    }
    if (start === this.index) throw new Error("Expected a JSON value");
    JSON.parse(this.source.slice(start, this.index));
    return { end: this.index, kind: "other", start };
  }
}

function renderReplacement(source: string, edits: ManifestValueEdit[]): string {
  let manifest: JsonNode;
  try {
    manifest = new JsonTreeParser(source).parse();
  } catch {
    throw new Error("Manifest changed to invalid JSON before writing.");
  }
  if (manifest.kind !== "object")
    throw new Error("Manifest changed to invalid JSON before writing.");

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const seen = new Set<string>();
  for (const edit of edits) {
    const key = `${edit.section}\u0000${edit.package}`;
    if (seen.has(key)) throw new Error(`Duplicate manifest edit: ${edit.manifestPath}`);
    seen.add(key);
    const dependencies = manifest.properties?.get(edit.section);
    const current = dependencies?.properties?.get(edit.package);
    if (current?.kind !== "string" || current.value !== edit.currentSpecification) {
      throw new Error(`Manifest changed before writing: ${edit.manifestPath}`);
    }
    replacements.push({
      start: current.start,
      end: current.end,
      value: JSON.stringify(edit.proposedSpecification),
    });
  }

  let result = source;
  replacements.sort((left, right) => right.start - left.start);
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
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
