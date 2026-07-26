#!/usr/bin/env node

import path from "node:path";
import type { RunAnalysisOptions } from "../analyze/runner";
import type { AnalyzeReport, PublicDiagnostic } from "../analyze/types";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedAnalyzeArgs {
  cwd: string;
  workspacePatterns: string[];
  json: boolean;
  check: boolean;
  help: boolean;
}

interface AnalyzeRuntime {
  readonly analyze?: (options: RunAnalysisOptions) => Promise<AnalyzeReport>;
}

const helpText = `askr analyze - Analyze Askr correctness and performance

Usage:
  askr analyze [--cwd <dir>] [--workspace <pattern>]... [--json] [--check]

Options:
  --cwd <dir>             Resolve a project from another directory
  --workspace <pattern>   Select workspace names (repeatable)
  --json                  Emit one deterministic JSON object on stdout
  --check                 Report safe fixes without writing files
  --help, -h              Show this help message

By default every declared workspace is scanned and explicitly safe fixes are
applied transactionally. Semantic rewrites are always report-only.
`;

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseAnalyzeArgs(args: readonly string[]): ParsedAnalyzeArgs {
  const parsed: ParsedAnalyzeArgs = {
    cwd: process.cwd(),
    workspacePatterns: [],
    json: false,
    check: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--check") parsed.check = true;
    else if (argument === "--cwd") {
      parsed.cwd = path.resolve(optionValue(args, index, "--cwd"));
      index += 1;
    } else if (argument.startsWith("--cwd=")) {
      const value = argument.slice("--cwd=".length);
      if (!value) throw new Error("--cwd requires a value");
      parsed.cwd = path.resolve(value);
    } else if (argument === "--workspace") {
      parsed.workspacePatterns.push(optionValue(args, index, "--workspace"));
      index += 1;
    } else if (argument.startsWith("--workspace=")) {
      const value = argument.slice("--workspace=".length);
      if (!value) throw new Error("--workspace requires a value");
      parsed.workspacePatterns.push(value);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return parsed;
}

function formatDiagnostic(diagnostic: PublicDiagnostic): string {
  const severity = diagnostic.severity.toUpperCase();
  const remedy = diagnostic.remediation ? `\n  ${diagnostic.remediation}` : "";
  return `${diagnostic.workspace}:${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${severity} ${diagnostic.ruleId} ${diagnostic.message}${remedy}`;
}

function printHuman(report: AnalyzeReport, io: CliIo): void {
  for (const fix of report.appliedFixes) {
    io.log(`fixed ${fix.file} ${fix.ruleId}: ${fix.description}`);
  }
  for (const diagnostic of report.diagnostics) io.log(formatDiagnostic(diagnostic));
  io.log(
    `Analyzed ${report.workspaces.length} workspace(s), ${report.workspaces.reduce(
      (count, workspace) => count + workspace.files,
      0,
    )} file(s): ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info, ${report.summary.appliedFixes} fix(es) applied.`,
  );
}

export async function runAnalyzeCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
  runtime: AnalyzeRuntime = {},
): Promise<number> {
  const wantsJson = args.includes("--json");
  try {
    const parsed = parseAnalyzeArgs(args);
    if (parsed.help) {
      io.log(helpText.trimEnd());
      return 0;
    }
    const analyze = runtime.analyze ?? (await import("../analyze/runner")).runAnalysis;
    const report = await analyze({
      cwd: parsed.cwd,
      workspacePatterns: parsed.workspacePatterns,
      check: parsed.check,
    });
    if (parsed.json) io.log(JSON.stringify(report));
    else printHuman(report, io);
    return report.summary.errors > 0 || report.summary.warnings > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(
      wantsJson ? JSON.stringify({ schemaVersion: 1, status: "error", error: message }) : message,
    );
    return 1;
  }
}

async function main(): Promise<void> {
  process.exit(await runAnalyzeCli(process.argv.slice(2)));
}

if (isDirectExecution(import.meta.url)) void main();
