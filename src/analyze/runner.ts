import fs from "node:fs/promises";
import path from "node:path";
import { writeFileChanges, type FileChange } from "../file-changes";
import { discoverWorkspaceProject } from "../update/discovery";
import type { WorkspaceManifest } from "../update/types";
import { createWorkspaceAnalysisContext, readAnalyzeConfiguration } from "./project";
import { ANALYZE_RULES, configuredSeverity } from "./rules";
import {
  ANALYZE_SCHEMA_VERSION,
  type AnalyzeDiagnostic,
  type AnalyzeFixResult,
  type AnalyzeReport,
  type AnalyzeSummary,
  type AnalyzeWorkspaceResult,
  type PublicDiagnostic,
} from "./types";

export interface RunAnalysisOptions {
  readonly cwd: string;
  readonly workspacePatterns: string[];
  readonly check: boolean;
  readonly writer?: (changes: readonly FileChange[]) => Promise<void>;
}

interface AnalysisPass {
  readonly diagnostics: AnalyzeDiagnostic[];
  readonly workspaces: AnalyzeWorkspaceResult[];
}

function rootManifest(workspaces: readonly WorkspaceManifest[]): Record<string, unknown> {
  const root = workspaces.find((workspace) => workspace.isRoot);
  if (!root) throw new Error("Discovered project is missing its root workspace.");
  return root.manifest;
}

function compareDiagnostics(left: AnalyzeDiagnostic, right: AnalyzeDiagnostic): number {
  return (
    left.workspace.localeCompare(right.workspace) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.message.localeCompare(right.message)
  );
}

async function analyzePass(
  root: string,
  allWorkspaces: readonly WorkspaceManifest[],
  selectedWorkspaces: readonly WorkspaceManifest[],
  manifest: Record<string, unknown>,
): Promise<AnalysisPass> {
  const baseConfiguration = readAnalyzeConfiguration(manifest);
  const diagnostics: AnalyzeDiagnostic[] = [];
  const workspaces: AnalyzeWorkspaceResult[] = [];
  for (const workspace of selectedWorkspaces) {
    const nestedWorkspaceExclusions = allWorkspaces.flatMap((candidate) => {
      if (candidate.directory === workspace.directory) return [];
      const relative = path
        .relative(workspace.directory, candidate.directory)
        .split(path.sep)
        .join("/");
      return relative && !relative.startsWith("../") ? [`${relative}/**`] : [];
    });
    const configuration = {
      ...baseConfiguration,
      exclude: [...baseConfiguration.exclude, ...nestedWorkspaceExclusions],
    };
    const created = await createWorkspaceAnalysisContext(root, workspace, configuration);
    workspaces.push({
      name: workspace.name,
      path: path.relative(root, workspace.directory).split(path.sep).join("/") || ".",
      tsconfig: created.tsconfig
        ? path.relative(root, created.tsconfig).split(path.sep).join("/")
        : null,
      files: created.context.sourceFiles.length,
    });
    for (const rule of ANALYZE_RULES) {
      const severity = configuredSeverity(rule, configuration);
      if (severity === "off") continue;
      diagnostics.push(...rule.analyze(created.context).map((entry) => ({ ...entry, severity })));
    }
  }
  diagnostics.sort(compareDiagnostics);
  return { diagnostics, workspaces };
}

function fixResult(root: string, diagnostic: AnalyzeDiagnostic, reason?: string): AnalyzeFixResult {
  if (!diagnostic.fix) throw new Error("Cannot record a missing analysis fix.");
  return {
    ruleId: diagnostic.ruleId,
    workspace: diagnostic.workspace,
    file: path.relative(root, diagnostic.fix.filePath).split(path.sep).join("/"),
    description: diagnostic.fix.description,
    ...(reason ? { reason } : {}),
  };
}

async function prepareFixes(
  root: string,
  diagnostics: readonly AnalyzeDiagnostic[],
): Promise<{
  changes: FileChange[];
  applied: AnalyzeFixResult[];
  skipped: AnalyzeFixResult[];
}> {
  const candidates = diagnostics.filter(
    (entry): entry is AnalyzeDiagnostic & { fix: NonNullable<AnalyzeDiagnostic["fix"]> } =>
      Boolean(entry.fix),
  );
  const byFile = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const list = byFile.get(candidate.fix.filePath) ?? [];
    list.push(candidate);
    byFile.set(candidate.fix.filePath, list);
  }

  const changes: FileChange[] = [];
  const applied: AnalyzeFixResult[] = [];
  const skipped: AnalyzeFixResult[] = [];
  for (const [filePath, entries] of [...byFile].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const original = await fs.readFile(filePath, "utf8");
    const ordered = [...entries].sort(
      (left, right) =>
        right.fix.start - left.fix.start ||
        right.fix.end - left.fix.end ||
        left.ruleId.localeCompare(right.ruleId),
    );
    let content = original;
    let nextStart = original.length + 1;
    for (const entry of ordered) {
      const fix = entry.fix;
      if (
        fix.start < 0 ||
        fix.end < fix.start ||
        fix.end > original.length ||
        fix.end > nextStart
      ) {
        skipped.push(fixResult(root, entry, "conflicts with another safe fix"));
        continue;
      }
      content = `${content.slice(0, fix.start)}${fix.replacement}${content.slice(fix.end)}`;
      nextStart = fix.start;
      applied.push(fixResult(root, entry));
    }
    if (content !== original) changes.push({ filePath, content });
  }
  return { changes, applied, skipped };
}

function publicDiagnostic(diagnostic: AnalyzeDiagnostic): PublicDiagnostic {
  const { fix, ...entry } = diagnostic;
  return {
    ...entry,
    ...(fix ? { fix: { description: fix.description, safe: true as const } } : {}),
  };
}

function summary(
  diagnostics: readonly AnalyzeDiagnostic[],
  applied: readonly AnalyzeFixResult[],
  skipped: readonly AnalyzeFixResult[],
): AnalyzeSummary {
  return {
    errors: diagnostics.filter((entry) => entry.severity === "error").length,
    warnings: diagnostics.filter((entry) => entry.severity === "warning").length,
    info: diagnostics.filter((entry) => entry.severity === "info").length,
    diagnostics: diagnostics.length,
    appliedFixes: applied.length,
    skippedFixes: skipped.length,
  };
}

export function analysisHasBlockingFindings(report: AnalyzeReport): boolean {
  return report.summary.errors > 0 || report.summary.warnings > 0;
}

export async function runAnalysis(options: RunAnalysisOptions): Promise<AnalyzeReport> {
  const project = await discoverWorkspaceProject({
    cwd: options.cwd,
    workspacePatterns: options.workspacePatterns,
  });
  const manifest = rootManifest(project.workspaces);
  let pass = await analyzePass(
    project.root,
    project.workspaces,
    project.selectedWorkspaces,
    manifest,
  );
  let applied: AnalyzeFixResult[] = [];
  let skipped: AnalyzeFixResult[] = [];

  if (options.check) {
    skipped = pass.diagnostics
      .filter((entry) => entry.fix)
      .map((entry) => fixResult(project.root, entry, "check mode does not write files"));
  } else {
    const prepared = await prepareFixes(project.root, pass.diagnostics);
    skipped = prepared.skipped;
    if (prepared.changes.length > 0) {
      await (options.writer ?? writeFileChanges)(prepared.changes);
      applied = prepared.applied;
      pass = await analyzePass(
        project.root,
        project.workspaces,
        project.selectedWorkspaces,
        manifest,
      );
    }
  }

  return {
    schemaVersion: ANALYZE_SCHEMA_VERSION,
    root: project.root,
    discoveredWorkspaces: project.workspaces.map((workspace) => workspace.name),
    selectedWorkspaces: project.selectedWorkspaces.map((workspace) => workspace.name),
    workspaces: pass.workspaces,
    appliedFixes: applied,
    skippedFixes: skipped,
    diagnostics: pass.diagnostics.map(publicDiagnostic),
    summary: summary(pass.diagnostics, applied, skipped),
  };
}
