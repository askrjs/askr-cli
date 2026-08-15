#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CliIo = Pick<Console, "error" | "log">;

export interface OrmTooling {
  runDatabaseCli(
    args: readonly string[],
    options: { readonly cwd: string; readonly io: CliIo },
  ): Promise<number>;
}

export async function loadOrmTooling(cwd: string): Promise<OrmTooling> {
  const require = createRequire(path.join(path.resolve(cwd), "package.json"));
  let entry: string;
  try {
    const manifestPath = require.resolve("@askrjs/orm/package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      exports?: {
        "./tooling"?: string | { readonly import?: string };
      };
    };
    const toolingExport = manifest.exports?.["./tooling"];
    const relative = typeof toolingExport === "string" ? toolingExport : toolingExport?.import;
    if (!relative) throw new Error("Missing import export for @askrjs/orm/tooling.");
    entry = path.resolve(path.dirname(manifestPath), relative);
  } catch (error) {
    throw new Error(
      "This project does not have @askrjs/orm installed. Run `npm install @askrjs/orm` before `askr database`.",
      { cause: error },
    );
  }
  const tooling = (await import(pathToFileURL(entry).href)) as Partial<OrmTooling>;
  if (typeof tooling.runDatabaseCli !== "function") {
    throw new Error(
      "The installed @askrjs/orm package does not expose compatible database tooling.",
    );
  }
  return tooling as OrmTooling;
}

export async function runDatabaseCommand(
  args: readonly string[],
  io: CliIo = console,
  cwd = process.cwd(),
  loader: (cwd: string) => Promise<OrmTooling> = loadOrmTooling,
): Promise<number> {
  try {
    const tooling = await loader(cwd);
    return tooling.runDatabaseCli(args, { cwd, io });
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function runDatabaseValidation(
  cwd: string,
  loader: (cwd: string) => Promise<OrmTooling> = loadOrmTooling,
): Promise<{
  readonly status: "passed" | "failed";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runDatabaseCommand(
    ["validate", "--cwd", cwd],
    {
      log: (...values: unknown[]) => stdout.push(values.join(" ")),
      error: (...values: unknown[]) => stderr.push(values.join(" ")),
    },
    cwd,
    loader,
  );
  return {
    status: code === 0 ? "passed" : "failed",
    exitCode: code,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}
