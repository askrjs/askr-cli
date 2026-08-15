#!/usr/bin/env node

import { isDirectExecution } from "./is-direct-execution";
import { getCliVersion } from "./package-version";

type CliIo = Pick<Console, "error" | "log">;

function printHelp(io: CliIo = console): void {
  io.log("askr - Unified CLI for the Askr platform");
  io.log("");
  io.log("Usage:");
  io.log("  askr <command> [args]");
  io.log("");
  io.log("Commands:");
  io.log("  add        Generate pages or declared actions into an Askr project");
  io.log("  analyze    Analyze Askr correctness and performance");
  io.log("  check      Run the complete project validation path");
  io.log("  create     Create a new Askr app from a template or product prompt");
  io.log("  database   Generate, validate, and migrate project databases");
  io.log("  docs       Check or snapshot consumer-visible API documentation");
  io.log("  doctor     Diagnose environment and Askr project health");
  io.log("  generate   Generate an @askrjs/fetch client from OpenAPI");
  io.log("  openapi    Generate or check an OpenAPI YAML artifact");
  io.log("  skills     Install or sync Askr agent skills");
  io.log("  ssg        Run static-site generation");
  io.log("  outdated   List available dependency updates");
  io.log("  repair     Apply safe fixes and identify remaining semantic work");
  io.log("  update     Apply safe dependency updates");
  io.log("  upgrade    Apply latest peer-compatible dependency upgrades");
  io.log("");
  io.log("Options:");
  io.log("  --help, -h     Show help");
  io.log("  --version, -v  Print CLI version");
  io.log("");
  io.log("Examples:");
  io.log("  askr create startkit my-app");
  io.log('  askr create --prompt "Agent workflow console with approvals"');
  io.log("  askr add page audit-log");
  io.log("  askr add action approve-request --route /requests/{id}");
  io.log("  askr analyze --check");
  io.log("  askr doctor");
  io.log("  askr repair");
  io.log("  askr check");
  io.log("  askr database validate");
  io.log("  askr skills install");
  io.log("  askr openapi --check");
  io.log("  askr skills review foundation --cwd ./candidate-app");
  io.log("  askr ssg --config ./ssg.config.ts --output ./dist/static");
  io.log("  askr outdated");
  io.log("  askr update");
  io.log("  askr upgrade");
}

export async function runCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
): Promise<number> {
  const command = args[0];

  if (command === "--version" || command === "-v") {
    io.log(getCliVersion());
    return 0;
  }

  if (!command || command === "--help" || command === "-h") {
    printHelp(io);
    return 0;
  }

  if (command === "create") {
    const { runCreateCli } = await import("./create");
    return runCreateCli(args.slice(1), io);
  }

  if (command === "add") {
    const { runAddCli } = await import("./add");
    return runAddCli(args.slice(1), io);
  }

  if (command === "database") {
    const { runDatabaseCommand } = await import("./database");
    return runDatabaseCommand(args.slice(1), io);
  }

  if (command === "docs") {
    const { runDocsCli } = await import("./docs");
    return runDocsCli(args.slice(1), io);
  }

  if (command === "analyze") {
    const { runAnalyzeCli } = await import("./analyze");
    return runAnalyzeCli(args.slice(1), io);
  }

  if (command === "check" || command === "doctor" || command === "repair") {
    const { runGuardrailCli } = await import("./guardrails");
    return runGuardrailCli(command, args.slice(1), io);
  }

  if (command === "generate") {
    const { runGenerateCli } = await import("./generate");
    return runGenerateCli(args.slice(1), io);
  }

  if (command === "ssg") {
    const { runSsgCli } = await import("./ssg");
    return runSsgCli(args.slice(1), undefined, io);
  }

  if (command === "openapi") {
    const { runOpenApiCli } = await import("./openapi");
    return runOpenApiCli(args.slice(1), io);
  }

  if (command === "skills") {
    const { runSkillsCli } = await import("./skills");
    return runSkillsCli(args.slice(1), io);
  }

  if (command === "update") {
    const { runUpdateCli } = await import("./update");
    return runUpdateCli(args.slice(1), io);
  }

  if (command === "upgrade") {
    const { runUpgradeCli } = await import("./update");
    return runUpgradeCli(args.slice(1), io);
  }

  if (command === "outdated") {
    const { runOutdatedCli } = await import("./update");
    return runOutdatedCli(args.slice(1), io);
  }

  io.error(`Unknown command: ${command}`);
  io.error("Run `askr --help` to see available commands.");
  return 1;
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
