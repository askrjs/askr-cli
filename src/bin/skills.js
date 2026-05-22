#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_PREFIX = "askr-";

function helpText() {
  return [
    "askr skills - Install Askr agent skills",
    "",
    "Usage:",
    "  askr skills list",
    "  askr skills install [--cwd <dir>] [--force]",
    "  askr skills sync [--cwd <dir>] [--force]",
    "",
    "Commands:",
    "  list      Print bundled Askr skill names",
    "  install   Copy bundled skills into .skills; refuses non-empty targets unless --force",
    "  sync      Update bundled skills in .skills and remove obsolete askr-* skill folders",
    "",
    "Options:",
    "  --cwd <dir>   Project directory to receive .skills (default: current directory)",
    "  --force       Allow install to write into an existing non-empty .skills directory",
    "  --help        Show this help message",
    "",
    "Examples:",
    "  askr skills install",
    "  askr skills sync --cwd ./my-app",
  ].join("\n");
}

function parseArgs(args) {
  const positional = [];
  const parsed = {
    cwd: process.cwd(),
    force: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--cwd" && i + 1 < args.length) {
      parsed.cwd = args[i + 1];
      i += 1;
    } else {
      positional.push(arg);
    }
  }

  return {
    ...parsed,
    command: positional[0] || "",
  };
}

function cliDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function findBundledSkillsDir() {
  const base = cliDir();
  const candidates = [
    path.resolve(base, "..", "..", "skills"),
    path.resolve(base, "..", "skills"),
    path.resolve(base, "skills"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function pathExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function listBundledSkills() {
  const source = await findBundledSkillsDir();
  const entries = await fs.readdir(source, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function copyDir(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
      continue;
    }

    await fs.copyFile(srcPath, destPath);
  }
}

async function removeManagedSkillArtifacts(targetSkillsDir, bundledNames) {
  const entries = await fs.readdir(targetSkillsDir, { withFileTypes: true }).catch(() => []);
  const bundled = new Set(bundledNames);

  for (const entry of entries) {
    if (!entry.name.startsWith(MANAGED_PREFIX)) {
      continue;
    }

    const isBundledDirectory = entry.isDirectory() && bundled.has(entry.name);
    if (!isBundledDirectory) {
      await fs.rm(path.join(targetSkillsDir, entry.name), { recursive: true, force: true });
    }
  }
}

async function copyBundledSkills(targetSkillsDir, bundledNames) {
  const source = await findBundledSkillsDir();
  await fs.mkdir(targetSkillsDir, { recursive: true });

  for (const name of bundledNames) {
    const src = path.join(source, name);
    const dest = path.join(targetSkillsDir, name);
    await fs.rm(dest, { recursive: true, force: true });
    await copyDir(src, dest);
  }
}

async function installSkills({ cwd, force }, io) {
  const targetRoot = path.resolve(cwd);
  const targetSkillsDir = path.join(targetRoot, ".skills");
  const bundledNames = await listBundledSkills();
  const existingEntries = await fs.readdir(targetSkillsDir).catch(() => []);

  if (existingEntries.length > 0 && !force) {
    io.error(`Refusing to install into non-empty ${targetSkillsDir}.`);
    io.error("Run `askr skills sync` to update Askr skills, or pass --force.");
    return 1;
  }

  if (force) {
    await fs.mkdir(targetSkillsDir, { recursive: true });
    await removeManagedSkillArtifacts(targetSkillsDir, bundledNames);
  }
  await copyBundledSkills(targetSkillsDir, bundledNames);
  io.log(`Installed ${bundledNames.length} Askr skills to ${targetSkillsDir}`);
  return 0;
}

async function syncSkills({ cwd }, io) {
  const targetRoot = path.resolve(cwd);
  const targetSkillsDir = path.join(targetRoot, ".skills");
  const bundledNames = await listBundledSkills();

  await fs.mkdir(targetSkillsDir, { recursive: true });
  await removeManagedSkillArtifacts(targetSkillsDir, bundledNames);
  await copyBundledSkills(targetSkillsDir, bundledNames);

  io.log(`Synced ${bundledNames.length} Askr skills to ${targetSkillsDir}`);
  return 0;
}

export async function runSkillsCli(args = process.argv.slice(2), io = console) {
  const parsed = parseArgs(args);

  if (!parsed.command || parsed.help) {
    io.log(helpText());
    return 0;
  }

  const source = await findBundledSkillsDir();
  if (!(await pathExists(source))) {
    io.error(`Bundled skills directory not found: ${source}`);
    return 1;
  }

  if (parsed.command === "list") {
    const names = await listBundledSkills();
    for (const name of names) {
      io.log(name);
    }
    return 0;
  }

  if (parsed.command === "install") {
    return installSkills(parsed, io);
  }

  if (parsed.command === "sync") {
    return syncSkills(parsed, io);
  }

  io.error(`Unknown skills command: ${parsed.command}`);
  io.error("Run `askr skills --help` to see available commands.");
  return 1;
}

async function main() {
  const code = await runSkillsCli(process.argv.slice(2));
  process.exit(code);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && thisPath === invokedPath) {
  void main();
}
