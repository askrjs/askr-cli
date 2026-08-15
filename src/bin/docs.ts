#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { inspectDocs } from "../docs";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

export async function runDocsCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
): Promise<number> {
  const command = args[0] ?? "check";
  const json = args.includes("--json");
  const rootIndex = args.findIndex((arg) => arg === "--root" || arg.startsWith("--root="));
  const rootArg =
    rootIndex >= 0
      ? args[rootIndex]!.includes("=")
        ? args[rootIndex]!.slice("--root=".length)
        : args[rootIndex + 1]
      : undefined;
  const root = path.resolve(rootArg ?? process.cwd());
  if (command === "--help" || command === "-h") {
    io.log("askr docs check|snapshot [--json] [--root <path>] [--output <path>]");
    return 0;
  }
  if (command !== "check" && command !== "snapshot") {
    io.error(`Unknown docs command: ${command}`);
    return 1;
  }
  try {
    const result = await inspectDocs(root);
    if (command === "snapshot") {
      const outputIndex = args.findIndex(
        (arg) => arg === "--output" || arg.startsWith("--output="),
      );
      const outputArg =
        outputIndex >= 0
          ? args[outputIndex]!.includes("=")
            ? args[outputIndex]!.slice("--output=".length)
            : args[outputIndex + 1]
          : undefined;
      const output = outputArg
        ? path.resolve(root, outputArg)
        : path.join(root, "docs", "api-snapshot.json");
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, `${JSON.stringify(result.snapshot, null, 2)}\n`, "utf8");
      if (json)
        io.log(
          JSON.stringify({
            output,
            symbols: result.snapshot.symbols.length,
            diagnostics: result.diagnostics.length,
          }),
        );
      else
        io.log(`Wrote ${path.relative(root, output)} (${result.snapshot.symbols.length} symbols)`);
      return result.diagnostics.length === 0 ? 0 : 1;
    }
    if (json) io.log(JSON.stringify(result.diagnostics));
    else if (result.diagnostics.length)
      for (const diagnostic of result.diagnostics)
        io.error(
          `${diagnostic.package} ${diagnostic.entrypoint} ${diagnostic.symbol} (${diagnostic.declaration}): missing ${diagnostic.missing}`,
        );
    else io.log(`Documentation check passed (${result.snapshot.symbols.length} symbols)`);
    return result.diagnostics.length === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) io.log(JSON.stringify({ error: message }));
    else io.error(`Documentation check failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution(import.meta.url)) void runDocsCli();
