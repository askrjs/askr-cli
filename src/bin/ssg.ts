#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedSsgArgs {
  configPath: string;
  outputDir: string;
  workers: number | "auto";
  incremental: boolean;
  changedKeys: string[];
  changedRoutes: string[];
  forceFull: boolean;
  help: boolean;
}

interface LoadedConfig {
  routes?: unknown[];
  registry?: unknown;
  seed?: unknown;
  dataOverrides?: unknown;
  concurrency?: number;
  document?: unknown;
  assets?: unknown[];
}

interface RouteResult {
  path: string;
  status: string;
  error?: string;
}

interface GenerateResult {
  mode: string;
  successful: number;
  totalRoutes: number;
  failed: number;
  rebuilt: number;
  skipped: number;
  removed: number;
  cacheHits: number;
  routes: RouteResult[];
}

interface StaticGen {
  generate(options: ReturnType<typeof toGenerateOptions>): Promise<GenerateResult>;
}

interface SsgDeps {
  cwd?: () => string;
  now?: () => number;
  existsSync?: typeof existsSync;
  importConfig?: (filePath: string) => Promise<unknown>;
  createStaticGen?: (options: {
    routes?: unknown[];
    registry?: unknown;
    outputDir: string;
    seed?: unknown;
    dataOverrides?: unknown;
    concurrency?: number;
    parallelism: number | "auto";
    document?: unknown;
    assets?: unknown[];
  }) => StaticGen;
}

const helpText = `
askr ssg - Static Site Generation for Askr

Usage:
  askr ssg --config <path> --output <dir> [--incremental]

Options:
  --config <path>         Path to SSG config file (TypeScript module)
  --output <dir>          Output directory for generated HTML
  --workers <n|auto>      Preferred render worker count for SSG throughput
  --incremental           Use incremental generation if a manifest exists
  --changed-key <key>     Mark an invalidation key as changed (repeatable)
  --changed-route <path>  Mark a concrete route path as changed (repeatable)
  --force-full            Force a full rebuild even with incremental flags
  --help                  Show this help message

Examples:
  askr ssg --config ./ssg.config.ts --output ./dist/static
  askr ssg --config ./ssg.config.ts --output ./dist/static --incremental
`;

const defaultDeps: Required<Pick<SsgDeps, "cwd" | "existsSync" | "now">> = {
  cwd: () => process.cwd(),
  now: () => Date.now(),
  existsSync,
};

async function importProjectConfig(filePath: string): Promise<{
  module: unknown;
  unregister: () => Promise<void>;
}> {
  const tsconfig = resolve(dirname(filePath), "tsconfig.json");
  const unregister = register(existsSync(tsconfig) ? { tsconfig } : undefined);

  try {
    return {
      module: await import(pathToFileURL(filePath).href),
      unregister,
    };
  } catch (error) {
    await unregister();
    throw error;
  }
}

async function loadCreateStaticGen(): Promise<NonNullable<SsgDeps["createStaticGen"]>> {
  const mod = (await import("@askrjs/askr/ssg")) as {
    createStaticGen?: SsgDeps["createStaticGen"];
  };
  if (typeof mod.createStaticGen !== "function") {
    throw new Error("Failed to load createStaticGen from @askrjs/askr/ssg");
  }
  return mod.createStaticGen;
}

export function parseCliArgs(args: string[]): ParsedSsgArgs {
  const parsed: ParsedSsgArgs = {
    configPath: "",
    outputDir: "",
    workers: 1,
    incremental: false,
    changedKeys: [],
    changedRoutes: [],
    forceFull: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--config" && i + 1 < args.length) {
      parsed.configPath = args[i + 1];
      i += 1;
    } else if (args[i] === "--output" && i + 1 < args.length) {
      parsed.outputDir = args[i + 1];
      i += 1;
    } else if (args[i] === "--workers" && i + 1 < args.length) {
      parsed.workers = args[i + 1] === "auto" ? "auto" : Number(args[i + 1]);
      i += 1;
    } else if (args[i] === "--changed-key" && i + 1 < args.length) {
      parsed.changedKeys.push(args[i + 1]);
      i += 1;
    } else if (args[i] === "--changed-route" && i + 1 < args.length) {
      parsed.changedRoutes.push(args[i + 1]);
      i += 1;
    } else if (args[i] === "--incremental") {
      parsed.incremental = true;
    } else if (args[i] === "--force-full") {
      parsed.forceFull = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      parsed.help = true;
    }
  }

  return parsed;
}

function toGenerateOptions(args: ParsedSsgArgs) {
  return {
    mode: args.incremental ? "incremental" : "full",
    changedKeys: args.changedKeys,
    changedRoutes: args.changedRoutes,
    forceFull: args.forceFull,
  };
}

function printSummary(
  io: CliIo,
  outputDir: string,
  durationSeconds: string,
  result: GenerateResult,
): void {
  io.log("");
  io.log(`Generation complete in ${durationSeconds}s`);
  io.log(`   Mode:      ${result.mode}`);
  io.log(`   Generated: ${result.successful}/${result.totalRoutes} routes`);
  io.log(`   Failed:    ${result.failed} routes`);
  io.log(`   Rebuilt:   ${result.rebuilt} routes`);
  io.log(`   Skipped:   ${result.skipped} routes`);
  io.log(`   Removed:   ${result.removed} routes`);
  io.log(`   CacheHit:  ${result.cacheHits} routes`);
  io.log(`   Output:    ${outputDir}`);
  io.log(`   Metadata:  ${outputDir}/metadata.json`);
  io.log("");
}

export async function runSsgCli(
  args: string[] = process.argv.slice(2),
  deps: SsgDeps = {},
  io: CliIo = console,
): Promise<number> {
  const parsed = parseCliArgs(args);
  if (parsed.help) {
    io.log(helpText);
    return 0;
  }

  if (!parsed.configPath) {
    io.error("Error: --config argument is required");
    return 1;
  }

  if (!parsed.configPath.endsWith(".ts")) {
    io.error("Error: --config must point to a TypeScript file (.ts)");
    return 1;
  }

  if (!parsed.outputDir) {
    io.error("Error: --output argument is required");
    return 1;
  }

  const resolvedDeps = { ...defaultDeps, ...deps };
  const resolvedConfigPath = resolve(resolvedDeps.cwd(), parsed.configPath);
  const resolvedOutputDir = resolve(resolvedDeps.cwd(), parsed.outputDir);

  if (!resolvedDeps.existsSync(resolvedConfigPath)) {
    io.error(`Error: Config file not found: ${resolvedConfigPath}`);
    return 1;
  }

  let unregisterProjectLoader: (() => Promise<void>) | undefined;
  try {
    io.log(`Loading config: ${resolvedConfigPath}`);

    let imported: unknown;
    if (deps.importConfig) {
      imported = await deps.importConfig(resolvedConfigPath);
    } else {
      const loaded = await importProjectConfig(resolvedConfigPath);
      imported = loaded.module;
      unregisterProjectLoader = loaded.unregister;
    }
    const configModule = imported as {
      default?: LoadedConfig;
      staticConfig?: LoadedConfig;
      routes?: unknown[];
      registry?: unknown;
      seed?: unknown;
      dataOverrides?: unknown;
      concurrency?: number;
      document?: unknown;
      assets?: unknown[];
    };
    const candidate = configModule.default ?? configModule.staticConfig ?? configModule;
    const hasRoutes = Array.isArray(candidate.routes);
    const hasRegistry = candidate.registry !== undefined;

    if (hasRoutes === hasRegistry) {
      io.error("Error: Config must provide exactly one route source: routes or registry");
      return 1;
    }
    const config = candidate as LoadedConfig;

    io.log(
      hasRoutes
        ? `Generating ${config.routes?.length ?? 0} routes...`
        : "Generating registered routes...",
    );

    const createStaticGen =
      typeof resolvedDeps.createStaticGen === "function"
        ? resolvedDeps.createStaticGen
        : await loadCreateStaticGen();

    const ssg = createStaticGen({
      ...(hasRoutes ? { routes: config.routes } : { registry: config.registry }),
      outputDir: resolvedOutputDir,
      seed: config.seed,
      dataOverrides: config.dataOverrides,
      concurrency: config.concurrency,
      parallelism: parsed.workers,
      document: config.document,
      assets: config.assets,
    });

    const startTime = resolvedDeps.now();
    const result = await ssg.generate(toGenerateOptions(parsed));
    const duration = ((resolvedDeps.now() - startTime) / 1000).toFixed(2);

    printSummary(io, resolvedOutputDir, duration, result);

    if (result.failed > 0) {
      io.log("Errors encountered:");
      for (const route of result.routes) {
        if (route.status === "error") {
          io.log(`   ${route.path}: ${route.error}`);
        }
      }
      io.log("");
      return 1;
    }

    return 0;
  } catch (error) {
    io.error("Generation failed:");
    io.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      io.error(error.stack);
    }
    return 1;
  } finally {
    await unregisterProjectLoader?.();
  }
}

async function main(): Promise<void> {
  const code = await runSsgCli(process.argv.slice(2));
  process.exit(code);
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
