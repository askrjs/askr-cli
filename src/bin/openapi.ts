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
  json: boolean;
}

interface DocumentExporter {
  toOpenApiDocument(): unknown | Promise<unknown>;
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
  --json           Print machine-readable command results
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
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--entry" || value === "--output") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) throw new Error(`${value} requires a path`);
      if (value === "--entry") parsed.entry = next;
      else parsed.output = next;
      index += 1;
    } else if (value === "--check") parsed.check = true;
    else if (value === "--json") parsed.json = true;
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

export function validateOpenApiDocument(
  document: unknown,
): asserts document is Record<string, unknown> {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("toOpenApiDocument() must return an OpenAPI document object");
  }
  const candidate = document as Record<string, unknown>;
  if (
    typeof candidate.openapi !== "string" ||
    !/^3\.(?:0|1)\.\d+(?:[-+].+)?$/.test(candidate.openapi)
  ) {
    throw new Error("OpenAPI document must declare a supported openapi 3.0.x or 3.1.x version");
  }
  if (!candidate.info || typeof candidate.info !== "object" || Array.isArray(candidate.info)) {
    throw new Error("OpenAPI document must contain an info object");
  }
  const info = candidate.info as Record<string, unknown>;
  if (
    typeof info.title !== "string" ||
    !info.title.trim() ||
    typeof info.version !== "string" ||
    !info.version.trim()
  ) {
    throw new Error("OpenAPI info must contain non-empty title and version strings");
  }
  if (!candidate.paths || typeof candidate.paths !== "object" || Array.isArray(candidate.paths)) {
    throw new Error("OpenAPI document must contain a paths object");
  }
}

async function generate(entry: string, deps: OpenApiDeps): Promise<string> {
  const moduleValue = await deps.importModule(entry);
  const document = await exporterFrom(moduleValue).toOpenApiDocument();
  validateOpenApiDocument(document);
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
  const wantsJson = args.includes("--json");
  try {
    const parsed = parseOpenApiArgs(args);
    if (parsed.help) {
      io.log(helpText.trimEnd());
      return 0;
    }
    const entry = path.resolve(deps.cwd(), parsed.entry);
    const output = path.resolve(deps.cwd(), parsed.output);
    if (entry === output) throw new Error("OpenAPI output must not overwrite its source entry");
    const expected = await generate(entry, deps);
    if (parsed.check) {
      let actual: string;
      try {
        actual = await deps.readFile(output);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          io.error(
            parsed.json
              ? JSON.stringify({ status: "error", reason: "missing", output })
              : `OpenAPI artifact is missing: ${output}`,
          );
          return 1;
        }
        throw error;
      }
      if (actual !== expected) {
        io.error(
          parsed.json
            ? JSON.stringify({ status: "error", reason: "stale", output })
            : `OpenAPI artifact is stale: ${output}`,
        );
        return 1;
      }
      io.log(
        parsed.json
          ? JSON.stringify({ status: "ok", action: "checked", output })
          : `OpenAPI artifact is current: ${output}`,
      );
      return 0;
    }
    await atomicWrite(output, expected, deps);
    io.log(
      parsed.json
        ? JSON.stringify({ status: "ok", action: "generated", output })
        : `Generated OpenAPI artifact: ${output}`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(wantsJson ? JSON.stringify({ status: "error", error: message }) : message);
    return 1;
  }
}

async function main(): Promise<void> {
  process.exit(await runOpenApiCli(process.argv.slice(2)));
}

if (isDirectExecution(import.meta.url)) void main();
