#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runCreateCli } from "./create.js";
import { runSkillsCli } from "./skills.js";
import { runSsgCli } from "./ssg.js";

function printHelp(io = console) {
  io.log("askr - Unified CLI for the Askr platform");
  io.log("");
  io.log("Usage:");
  io.log("  askr <command> [args]");
  io.log("");
  io.log("Commands:");
  io.log("  create     Create a new Askr app (startkit, spa, ssr, ssg)");
  io.log("  skills     Install or sync Askr agent skills");
  io.log("  ssg        Run static-site generation");
  io.log("");
  io.log("Aliases:");
  io.log("  c          Alias for create");
  io.log("");
  io.log("Examples:");
  io.log("  askr create startkit my-app");
  io.log("  askr skills install");
  io.log("  askr ssg --config ./ssg.config.ts --output ./dist/static");
}

export async function runCli(args = process.argv.slice(2), io = console) {
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp(io);
    return 0;
  }

  if (command === "create" || command === "c") {
    return runCreateCli(args.slice(1), io);
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

async function main() {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && thisPath === invokedPath) {
  void main();
}
