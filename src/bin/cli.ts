#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAddCli } from "./add";
import { runCreateCli } from "./create";
import { runSkillsCli } from "./skills";
import { runSsgCli } from "./ssg";

type CliIo = Pick<Console, "error" | "log">;

function printHelp(io: CliIo = console): void {
  io.log("askr - Unified CLI for the Askr platform");
  io.log("");
  io.log("Usage:");
  io.log("  askr <command> [args]");
  io.log("");
  io.log("Commands:");
  io.log("  add        Generate pages into an existing Askr SPA project");
  io.log("  create     Create a new Askr app from a template or product prompt");
  io.log("  skills     Install or sync Askr agent skills");
  io.log("  ssg        Run static-site generation");
  io.log("");
  io.log("Aliases:");
  io.log("  c          Alias for create");
  io.log("");
  io.log("Examples:");
  io.log("  askr create startkit my-app");
  io.log('  askr create --prompt "Agent workflow console with approvals"');
  io.log("  askr add page audit-log");
  io.log("  askr skills install");
  io.log("  askr skills review foundation --cwd ./candidate-app");
  io.log("  askr ssg --config ./ssg.config.ts --output ./dist/static");
}

export async function runCli(args: string[] = process.argv.slice(2), io: CliIo = console): Promise<number> {
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp(io);
    return 0;
  }

  if (command === "create" || command === "c") {
    return runCreateCli(args.slice(1), io);
  }

  if (command === "add") {
    return runAddCli(args.slice(1), io);
  }

  if (command === "ssg") {
    return runSsgCli(args.slice(1), undefined, io);
  }

  if (command === "skills") {
    return runSkillsCli(args.slice(1), io);
  }

  io.error(`Unknown command: ${command}`);
  io.error("Run `askr --help` to see available commands.");
  return 1;
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && thisPath === invokedPath) {
  void main();
}
