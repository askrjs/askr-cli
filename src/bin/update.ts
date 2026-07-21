#!/usr/bin/env node

import path from "node:path";
import { isDirectExecution } from "./is-direct-execution";
import type { PackumentResults, RegistryRequirements } from "../update/registry";
import type {
  ManifestValueEdit,
  PackageDecision,
  PlannedOccurrence,
  UpdateSummary,
  WorkspaceManifest,
} from "../update/types";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedArgs {
  cwd: string;
  help: boolean;
  json: boolean;
  force: boolean;
  packagePatterns: string[];
  tag?: string;
  workspacePatterns: string[];
  errors: string[];
}

interface UpdateRuntime {
  registry?: (
    root: string,
    packageNames: string[],
    requirements?: RegistryRequirements,
  ) => Promise<PackumentResults>;
  writer?: typeof import("../update/writer").writeManifestEdits;
}

type DependencyCommand = "outdated" | "update" | "upgrade";

function helpText(command: DependencyCommand): string {
  const description =
    command === "outdated"
      ? "List available dependency updates"
      : command === "update"
        ? "Apply safe dependency updates"
        : "Apply latest peer-compatible dependency upgrades";
  return [
    `askr ${command} - ${description}`,
    "",
    "Usage:",
    `  askr ${command} [packages...] [options]`,
    "",
    "Options:",
    "  --cwd <dir>             Resolve a project from another directory",
    "  --workspace <glob>      Select workspace names (repeatable)",
    "  --tag <tag>             Use one registry dist-tag for selected packages",
    "  --json                  Emit one deterministic JSON object on stdout",
    ...(command === "upgrade"
      ? ["  --force, -f             Use tag targets without peer compatibility checks"]
      : []),
    "  --help, -h              Show this help message",
    "",
    "Notes:",
    "  Package arguments are minimatch patterns and override persistent ignores.",
    command === "outdated"
      ? "  This command reports only and never writes files."
      : "  The command changes package.json files only.",
    "  Lockfiles, installs, and lifecycle scripts are never touched.",
  ].join("\n");
}

function optionValue(
  args: string[],
  index: number,
  option: string,
  errors: string[],
): string | null {
  if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
    errors.push(`Missing value for ${option}`);
    return null;
  }
  return args[index + 1];
}

function parseArgs(command: DependencyCommand, args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    cwd: process.cwd(),
    help: false,
    json: false,
    force: false,
    packagePatterns: [],
    workspacePatterns: [],
    errors: [],
  };
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (positionalOnly) {
      parsed.packagePatterns.push(argument);
    } else if (argument === "--") {
      positionalOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      parsed.help = true;
    } else if (argument === "--json") {
      parsed.json = true;
    } else if (argument === "--force" || argument === "-f") {
      if (command === "upgrade") parsed.force = true;
      else parsed.errors.push(`${argument} is only supported by askr upgrade`);
    } else if (argument === "--cwd") {
      const value = optionValue(args, index, "--cwd", parsed.errors);
      if (value !== null) {
        parsed.cwd = path.resolve(value);
        index += 1;
      }
    } else if (argument.startsWith("--cwd=")) {
      parsed.cwd = path.resolve(argument.slice("--cwd=".length));
    } else if (argument === "--workspace") {
      const value = optionValue(args, index, "--workspace", parsed.errors);
      if (value !== null) {
        parsed.workspacePatterns.push(value);
        index += 1;
      }
    } else if (argument.startsWith("--workspace=")) {
      parsed.workspacePatterns.push(argument.slice("--workspace=".length));
    } else if (argument === "--tag") {
      const value = optionValue(args, index, "--tag", parsed.errors);
      if (value !== null) {
        parsed.tag = value;
        index += 1;
      }
    } else if (argument.startsWith("--tag=")) {
      parsed.tag = argument.slice("--tag=".length);
    } else if (argument.startsWith("-")) {
      parsed.errors.push(`Unknown option: ${argument}`);
    } else {
      parsed.packagePatterns.push(argument);
    }
  }

  if (parsed.tag !== undefined && (!parsed.tag || /\s/.test(parsed.tag))) {
    parsed.errors.push("--tag must be a non-empty dist-tag without whitespace");
  }
  if (parsed.workspacePatterns.some((pattern) => !pattern)) {
    parsed.errors.push("--workspace patterns must not be empty");
  }
  if (parsed.packagePatterns.some((pattern) => !pattern)) {
    parsed.errors.push("Package patterns must not be empty");
  }
  return parsed;
}

function emptySummary(): UpdateSummary {
  return {
    packages: 0,
    occurrences: 0,
    changedOccurrences: 0,
    current: 0,
    safe: 0,
    breaking: 0,
    local: 0,
    manual: 0,
    error: 0,
  };
}

function serializableDecision(decision: PackageDecision): Record<string, unknown> {
  return {
    package: decision.package,
    selectedTag: decision.selectedTag,
    targetVersion: decision.targetVersion,
    status: decision.status,
    reason: decision.reason,
    occurrences: decision.occurrences.map((occurrence) => ({
      workspace: occurrence.workspace,
      manifest: occurrence.relativeManifestPath,
      section: occurrence.section,
      currentSpecification: occurrence.currentSpecification,
      proposedSpecification: occurrence.proposedSpecification,
      allowedVersion: occurrence.allowedVersion,
      selectedVersion: occurrence.selectedVersion,
      status: occurrence.status,
      reason: occurrence.reason,
    })),
  };
}

function selectedWorkspaceJson(
  root: string,
  workspaces: WorkspaceManifest[],
): Array<Record<string, unknown>> {
  return workspaces.map((workspace) => ({
    name: workspace.name,
    path: path.relative(root, workspace.directory).split(path.sep).join("/") || ".",
    manifest: workspace.relativeManifestPath,
  }));
}

function emitJson(
  io: CliIo,
  options: {
    root: string | null;
    workspaces: Array<Record<string, unknown>>;
    summary: UpdateSummary;
    decisions: PackageDecision[];
    applied: number;
    errors: string[];
  },
): void {
  io.log(
    JSON.stringify(
      {
        root: options.root,
        workspaces: options.workspaces,
        summary: options.summary,
        decisions: options.decisions.map(serializableDecision),
        applied: { occurrences: options.applied },
        errors: options.errors,
      },
      null,
      2,
    ),
  );
}

function rangeText(occurrence: PlannedOccurrence, command: DependencyCommand): string {
  if (occurrence.proposedSpecification) {
    return `${occurrence.currentSpecification} → ${occurrence.proposedSpecification}`;
  }
  if (occurrence.status === "breaking") {
    return command === "upgrade"
      ? `${occurrence.currentSpecification} (${occurrence.reason})`
      : `${occurrence.currentSpecification} (available via askr upgrade)`;
  }
  return `${occurrence.currentSpecification} (${occurrence.reason})`;
}

function renderTable(rows: string[][]): string[] {
  const headings = ["Package", "Allowed", "Chosen", "Latest", "Status", "Range"];
  const widths = headings.map((heading, column) =>
    Math.max(heading.length, ...rows.map((row) => row[column].length)),
  );
  return [headings, ...rows].map((row) =>
    row
      .map((value, column) => (column === row.length - 1 ? value : value.padEnd(widths[column])))
      .join("  "),
  );
}

function emitHuman(
  io: CliIo,
  decisions: PackageDecision[],
  summary: UpdateSummary,
  applied: number,
  command: DependencyCommand,
): void {
  const byWorkspace = new Map<string, string[][]>();
  for (const decision of decisions) {
    for (const occurrence of decision.occurrences) {
      if (occurrence.status === "current") continue;
      const rows = byWorkspace.get(occurrence.workspace) ?? [];
      const row = [
        decision.package,
        occurrence.allowedVersion ?? "-",
        occurrence.selectedVersion ?? "-",
        decision.targetVersion ?? "-",
        occurrence.status,
        rangeText(occurrence, command),
      ];
      if (!rows.some((existing) => existing.every((value, index) => value === row[index]))) {
        rows.push(row);
      }
      byWorkspace.set(occurrence.workspace, rows);
    }
  }

  if (byWorkspace.size === 0) {
    io.log("All selected dependencies are current.");
  } else {
    let first = true;
    for (const [workspace, rows] of byWorkspace) {
      if (!first) io.log("");
      first = false;
      io.log(workspace);
      for (const line of renderTable(rows)) io.log(line);
    }
  }

  const counts = (["safe", "breaking", "current", "manual", "local", "error"] as const)
    .filter((status) => summary[status] > 0)
    .map((status) => `${summary[status]} ${status}`)
    .join(", ");
  io.log("");
  io.log(
    `Scanned ${summary.packages} package${summary.packages === 1 ? "" : "s"}${counts ? `: ${counts}` : "."}`,
  );
  if (command !== "outdated") {
    io.log(`Updated ${applied} manifest occurrence${applied === 1 ? "" : "s"}.`);
  }
}

function collectEdits(decisions: PackageDecision[]): ManifestValueEdit[] {
  return decisions.flatMap((decision) =>
    decision.occurrences.flatMap((occurrence) =>
      occurrence.proposedSpecification
        ? [
            {
              manifestPath: occurrence.manifestPath,
              section: occurrence.section,
              package: decision.package,
              currentSpecification: occurrence.currentSpecification,
              proposedSpecification: occurrence.proposedSpecification,
            },
          ]
        : [],
    ),
  );
}

async function defaultRegistry(
  root: string,
  packageNames: string[],
  requirements?: RegistryRequirements,
): Promise<PackumentResults> {
  const { fetchPackuments, loadNpmConfiguration } = await import("../update/registry");
  const configuration = await loadNpmConfiguration(root);
  return fetchPackuments(packageNames, configuration, { requirements });
}

async function runDependencyCli(
  command: DependencyCommand,
  args: string[],
  io: CliIo = console,
  runtime: UpdateRuntime = {},
): Promise<number> {
  const parsed = parseArgs(command, args);
  if (parsed.help && parsed.errors.length === 0) {
    io.log(helpText(command));
    return 0;
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) io.error(`askr ${command}: ${error}`);
    if (parsed.json) {
      emitJson(io, {
        root: null,
        workspaces: [],
        summary: emptySummary(),
        decisions: [],
        applied: 0,
        errors: parsed.errors,
      });
    }
    return 1;
  }

  let root: string | null = null;
  let selectedWorkspaces: WorkspaceManifest[] = [];
  try {
    const [{ discoverProject }, { planUpdates }] = await Promise.all([
      import("../update/discovery"),
      import("../update/planner"),
    ]);
    const project = await discoverProject({
      cwd: parsed.cwd,
      packagePatterns: parsed.packagePatterns,
      workspacePatterns: parsed.workspacePatterns,
    });
    root = project.root;
    selectedWorkspaces = project.selectedWorkspaces;

    const hasRegistryCandidate = project.occurrences.some(
      (occurrence) => occurrence.kind === "fetch",
    );
    const lookupNames = hasRegistryCandidate
      ? project.contextOccurrences
          .filter((occurrence) => occurrence.registryManaged)
          .map((occurrence) => occurrence.package)
      : [];
    const registry = runtime.registry ?? defaultRegistry;
    const specifications = new Map<string, string[]>();
    for (const occurrence of project.contextOccurrences) {
      const entries = specifications.get(occurrence.package) ?? [];
      if (!entries.includes(occurrence.currentSpecification)) {
        entries.push(occurrence.currentSpecification);
      }
      specifications.set(occurrence.package, entries);
    }
    const results =
      lookupNames.length > 0
        ? await registry(project.root, lookupNames, { specifications })
        : { packuments: new Map(), failures: new Map() };
    const plan = planUpdates({
      occurrences: project.occurrences,
      contextOccurrences: project.contextOccurrences,
      packuments: results.packuments,
      failures: results.failures,
      tags: project.policy.tags,
      cliTag: parsed.tag,
      mode: command === "upgrade" ? (parsed.force ? "force" : "upgrade") : "update",
      localVersions: project.localVersions,
    });

    let applied = 0;
    const errors: string[] = [];
    if (!plan.hasErrors && command !== "outdated") {
      try {
        const writer = runtime.writer ?? (await import("../update/writer")).writeManifestEdits;
        applied = await writer(collectEdits(plan.decisions));
      } catch {
        errors.push(
          "Unable to replace package manifests; completed replacements were rolled back when possible.",
        );
      }
    }
    if (plan.hasErrors) errors.push("One or more registry lookups or package plans failed.");

    if (parsed.json) {
      emitJson(io, {
        root: project.root,
        workspaces: selectedWorkspaceJson(project.root, project.selectedWorkspaces),
        summary: plan.summary,
        decisions: plan.decisions,
        applied,
        errors,
      });
    } else {
      emitHuman(io, plan.decisions, plan.summary, applied, command);
    }
    for (const error of errors) io.error(`askr ${command}: ${error}`);
    return errors.length > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    io.error(`askr ${command}: ${message}`);
    if (parsed.json) {
      emitJson(io, {
        root,
        workspaces: root ? selectedWorkspaceJson(root, selectedWorkspaces) : [],
        summary: emptySummary(),
        decisions: [],
        applied: 0,
        errors: [message],
      });
    }
    return 1;
  }
}

export const runUpdateCli = (args: string[], io: CliIo = console, runtime: UpdateRuntime = {}) =>
  runDependencyCli("update", args, io, runtime);
export const runUpgradeCli = (args: string[], io: CliIo = console, runtime: UpdateRuntime = {}) =>
  runDependencyCli("upgrade", args, io, runtime);
export const runOutdatedCli = (args: string[], io: CliIo = console, runtime: UpdateRuntime = {}) =>
  runDependencyCli("outdated", args, io, runtime);

async function main(): Promise<void> {
  process.exit(await runUpdateCli(process.argv.slice(2)));
}

if (isDirectExecution(import.meta.url)) void main();
