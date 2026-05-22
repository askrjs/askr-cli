#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillReviewReport, listSkillReviewPrompts, runSkillReview } from "./skill-review";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedArgs {
  cwd: string;
  force: boolean;
  help: boolean;
  json: boolean;
  command: string;
  positionals: string[];
  reviewPrompt: string;
}

const MANAGED_PREFIX = "askr-";

function helpText(): string {
  return [
    "askr skills - Install Askr agent skills",
    "",
    "Usage:",
    "  askr skills list",
    "  askr skills review list",
    "  askr skills review <prompt-id> [--cwd <dir>] [--json]",
    "  askr skills install [--cwd <dir>] [--force]",
    "  askr skills sync [--cwd <dir>] [--force]",
    "",
    "Commands:",
    "  list      Print bundled Askr skill names",
    "  review    Evaluate generated output against deterministic Askr prompt rubrics",
    "  install   Copy bundled skills into .skills; refuses non-empty targets unless --force",
    "  sync      Update bundled skills in .skills and remove obsolete askr-* skill folders",
    "",
    "Options:",
    "  --cwd <dir>   Project directory to receive .skills (default: current directory)",
    "  --force       Allow install to write into an existing non-empty .skills directory",
    "  --json        Print review results as JSON",
    "  --help        Show this help message",
    "",
    "Examples:",
    "  askr skills install",
    "  askr skills review foundation --cwd ./candidate-app",
    "  askr skills sync --cwd ./my-app",
  ].join("\n");
}

function reviewHelpText(): string {
  return [
    "askr skills review - Evaluate generated output against deterministic prompt rubrics",
    "",
    "Usage:",
    "  askr skills review list",
    "  askr skills review <prompt-id> [--cwd <dir>] [--json]",
    "",
    "Options:",
    "  --cwd <dir>   File or directory to review (default: current directory)",
    "  --json        Print machine-readable JSON output",
    "  --help        Show this help message",
    "",
    "Examples:",
    "  askr skills review foundation --cwd ./candidate-app",
    "  askr skills review reject-react-query --cwd ./scratch-output",
  ].join("\n");
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const parsed = {
    cwd: process.cwd(),
    force: false,
    help: false,
    json: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
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
    positionals: positional,
    reviewPrompt: positional[1] || "",
  };
}

function cliDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function findBundledSkillsDir(): Promise<string> {
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

async function pathExists(filePath: string): Promise<boolean> {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function listBundledSkills(): Promise<string[]> {
  const source = await findBundledSkillsDir();
  const entries = await fs.readdir(source, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function copyDir(src: string, dest: string): Promise<void> {
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

async function removeManagedSkillArtifacts(
  targetSkillsDir: string,
  bundledNames: string[],
): Promise<void> {
  const entries = await fs
    .readdir(targetSkillsDir, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);
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

async function copyBundledSkills(targetSkillsDir: string, bundledNames: string[]): Promise<void> {
  const source = await findBundledSkillsDir();
  await fs.mkdir(targetSkillsDir, { recursive: true });

  for (const name of bundledNames) {
    const src = path.join(source, name);
    const dest = path.join(targetSkillsDir, name);
    await fs.rm(dest, { recursive: true, force: true });
    await copyDir(src, dest);
  }
}

export async function installBundledSkills(
  options: { cwd?: string; force?: boolean } = {},
): Promise<{ bundledNames: string[]; targetSkillsDir: string }> {
  const targetRoot = path.resolve(options.cwd ?? process.cwd());
  const targetSkillsDir = path.join(targetRoot, ".skills");
  const bundledNames = await listBundledSkills();
  const existingEntries = await fs.readdir(targetSkillsDir).catch(() => [] as string[]);

  if (existingEntries.length > 0 && !options.force) {
    throw new Error(`Refusing to install into non-empty ${targetSkillsDir}.`);
  }

  if (options.force) {
    await fs.mkdir(targetSkillsDir, { recursive: true });
    await removeManagedSkillArtifacts(targetSkillsDir, bundledNames);
  }

  await copyBundledSkills(targetSkillsDir, bundledNames);

  return {
    bundledNames,
    targetSkillsDir,
  };
}

export async function syncBundledSkills(
  options: { cwd?: string } = {},
): Promise<{ bundledNames: string[]; targetSkillsDir: string }> {
  const targetRoot = path.resolve(options.cwd ?? process.cwd());
  const targetSkillsDir = path.join(targetRoot, ".skills");
  const bundledNames = await listBundledSkills();

  await fs.mkdir(targetSkillsDir, { recursive: true });
  await removeManagedSkillArtifacts(targetSkillsDir, bundledNames);
  await copyBundledSkills(targetSkillsDir, bundledNames);

  return {
    bundledNames,
    targetSkillsDir,
  };
}

async function installSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  try {
    const { bundledNames, targetSkillsDir } = await installBundledSkills({
      cwd: parsed.cwd,
      force: parsed.force,
    });
    io.log(`Installed ${bundledNames.length} Askr skills to ${targetSkillsDir}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(message);
    io.error("Run `askr skills sync` to update Askr skills, or pass --force.");
    return 1;
  }
}

async function syncSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const { bundledNames, targetSkillsDir } = await syncBundledSkills({ cwd: parsed.cwd });
  io.log(`Synced ${bundledNames.length} Askr skills to ${targetSkillsDir}`);
  return 0;
}

async function reviewSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (parsed.help && parsed.command === "review") {
    io.log(reviewHelpText());
    return 0;
  }

  if (!parsed.reviewPrompt) {
    io.log(reviewHelpText());
    return 0;
  }

  if (parsed.reviewPrompt === "list") {
    const prompts = listSkillReviewPrompts();
    for (const prompt of prompts) {
      io.log(`${prompt.id}\t${prompt.title}`);
    }
    return 0;
  }

  try {
    const result = await runSkillReview(parsed.reviewPrompt, { cwd: parsed.cwd });
    io.log(parsed.json ? JSON.stringify(result, null, 2) : formatSkillReviewReport(result));
    return result.status === "pass" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(message);
    const errorCode =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (errorCode === "UNKNOWN_REVIEW_PROMPT") {
      io.error("Run `askr skills review list` to see available prompt ids.");
    }
    return 1;
  }
}

export async function runSkillsCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.command === "review" && parsed.help) {
    io.log(reviewHelpText());
    return 0;
  }

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

  if (parsed.command === "review") {
    return reviewSkills(parsed, io);
  }

  io.error(`Unknown skills command: ${parsed.command}`);
  io.error("Run `askr skills --help` to see available commands.");
  return 1;
}

async function main(): Promise<void> {
  const code = await runSkillsCli(process.argv.slice(2));
  process.exit(code);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && thisPath === invokedPath) {
  void main();
}
