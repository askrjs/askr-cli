#!/usr/bin/env node

import fs from "node:fs/promises";
import { dump } from "js-yaml";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedArgs {
  entry: string;
  output: string;
  check: boolean;
  help: boolean;
}

interface DocumentExporter {
  toOpenApiDocument(): unknown;
}

interface OpenApiDeps {
  cwd(): string;
  importModule(filePath: string): Promise<unknown>;
  readFile(filePath: string): Promise<string>;
  mkdir(directory: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(filePath: string): Promise<void>;
  temporarySuffix(): string;
}

const helpText = `askr openapi - Generate an OpenAPI YAML artifact

Usage:
  askr openapi [--entry <path>] [--output <path>] [--check]

Options:
  --entry <path>   TypeScript API module (default: ./src/api.ts)
  --output <path>  YAML artifact (default: ./openapi.yml)
  --check          Fail when the artifact is missing or byte-stale; never write
  --help, -h       Show help
`;

const defaultDeps: OpenApiDeps = {
  cwd: () => process.cwd(),
  importModule: (filePath) => tsImport(pathToFileURL(filePath).href, import.meta.url),
  readFile: (filePath) => fs.readFile(filePath, "utf8"),
  mkdir: (directory) => fs.mkdir(directory, { recursive: true }).then(() => undefined),
  writeFile: (filePath, contents) => fs.writeFile(filePath, contents, "utf8"),
  rename: (from, to) => fs.rename(from, to),
  rm: (filePath) => fs.rm(filePath, { force: true }),
  temporarySuffix: () => `${process.pid}.${Date.now()}`,
};

export function parseOpenApiArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    entry: "./src/api.ts",
    output: "./openapi.yml",
    check: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--entry" || value === "--output") {
      const next = args[index + 1];
      if (!next) throw new Error(`${value} requires a path`);
      if (value === "--entry") parsed.entry = next;
      else parsed.output = next;
      index += 1;
    } else if (value === "--check") parsed.check = true;
    else if (value === "--help" || value === "-h") parsed.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  return parsed;
}

function exporterFrom(moduleValue: unknown): DocumentExporter {
  if (!moduleValue || typeof moduleValue !== "object") {
    throw new Error("API module must have a default export with toOpenApiDocument()");
  }
  let exported = (moduleValue as { default?: unknown }).default;
  for (
    let depth = 0;
    depth < 3 &&
    exported &&
    typeof exported === "object" &&
    typeof (exported as Partial<DocumentExporter>).toOpenApiDocument !== "function" &&
    "default" in exported;
    depth += 1
  ) {
    exported = (exported as { default?: unknown }).default;
  }
  if (
    !exported ||
    typeof exported !== "object" ||
    typeof (exported as Partial<DocumentExporter>).toOpenApiDocument !== "function"
  ) {
    throw new Error("API module must have a default export with toOpenApiDocument()");
  }
  return exported as DocumentExporter;
}

export function serializeOpenApi(document: unknown): string {
  const yaml = dump(document, { lineWidth: -1, noCompatMode: true, noRefs: true });
  return `${yaml.replace(/\n+$/, "")}\n`;
}

async function generate(entry: string, deps: OpenApiDeps): Promise<string> {
  const moduleValue = await deps.importModule(entry);
  const document = exporterFrom(moduleValue).toOpenApiDocument();
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("toOpenApiDocument() must return an OpenAPI document object");
  }
  return serializeOpenApi(document);
}

async function atomicWrite(output: string, contents: string, deps: OpenApiDeps): Promise<void> {
  await deps.mkdir(path.dirname(output));
  const temporary = `${output}.${deps.temporarySuffix()}.tmp`;
  try {
    await deps.writeFile(temporary, contents);
    await deps.rename(temporary, output);
  } catch (error) {
    await deps.rm(temporary);
    throw error;
  }
}

export async function runOpenApiCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
  overrides: Partial<OpenApiDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const parsed = parseOpenApiArgs(args);
    if (parsed.help) {
      io.log(helpText.trimEnd());
      return 0;
    }
    const entry = path.resolve(deps.cwd(), parsed.entry);
    const output = path.resolve(deps.cwd(), parsed.output);
    const expected = await generate(entry, deps);
    if (parsed.check) {
      let actual: string;
      try {
        actual = await deps.readFile(output);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          io.error(`OpenAPI artifact is missing: ${output}`);
          return 1;
        }
        throw error;
      }
      if (actual !== expected) {
        io.error(`OpenAPI artifact is stale: ${output}`);
        return 1;
      }
      io.log(`OpenAPI artifact is current: ${output}`);
      return 0;
    }
    await atomicWrite(output, expected, deps);
    io.log(`Generated OpenAPI artifact: ${output}`);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function main(): Promise<void> {
  process.exit(await runOpenApiCli(process.argv.slice(2)));
}

if (isDirectExecution(import.meta.url)) void main();
