#!/usr/bin/env node

import path from "node:path";
import type { AnalyzeReport, PublicDiagnostic } from "../analyze/types";
import type { GuardrailRuntime } from "../guardrails/runner";
import type {
  CheckReport,
  DoctorReport,
  GuardrailFinding,
  RepairReport,
} from "../guardrails/types";

type CliIo = Pick<Console, "error" | "log">;
type GuardrailCommand = "check" | "doctor" | "repair";

interface ParsedGuardrailArgs {
  readonly cwd: string;
  readonly workspacePatterns: string[];
  readonly json: boolean;
  readonly help: boolean;
}

const descriptions: Record<GuardrailCommand, string> = {
  check: "Run analysis, lint, typecheck, tests, and build",
  doctor: "Diagnose environment and Askr project health",
  repair: "Apply safe fixes and report remaining semantic work",
};

function helpText(command: GuardrailCommand): string {
  return `askr ${command} - ${descriptions[command]}

Usage:
  askr ${command} [--cwd <dir>] [--workspace <pattern>]... [--json]

Options:
  --cwd <dir>             Resolve a project from another directory
  --workspace <pattern>   Select workspace names for analysis (repeatable)
  --json                  Emit one deterministic JSON object
  --help, -h              Show this help message
`;
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseGuardrailArgs(args: readonly string[]): ParsedGuardrailArgs {
  let cwd = process.cwd();
  const workspacePatterns: string[] = [];
  let json = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--json") json = true;
    else if (argument === "--cwd") {
      cwd = path.resolve(optionValue(args, index, "--cwd"));
      index += 1;
    } else if (argument.startsWith("--cwd=")) {
      const value = argument.slice("--cwd=".length);
      if (!value) throw new Error("--cwd requires a value");
      cwd = path.resolve(value);
    } else if (argument === "--workspace") {
      workspacePatterns.push(optionValue(args, index, "--workspace"));
      index += 1;
    } else if (argument.startsWith("--workspace=")) {
      const value = argument.slice("--workspace=".length);
      if (!value) throw new Error("--workspace requires a value");
      workspacePatterns.push(value);
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return { cwd, workspacePatterns, json, help };
}

function formatDiagnostic(diagnostic: PublicDiagnostic): string {
  const remediation = diagnostic.remediation ? `\n  ${diagnostic.remediation}` : "";
  return `${diagnostic.workspace}:${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity.toUpperCase()} ${diagnostic.ruleId} ${diagnostic.message}${remediation}`;
}

function printDiagnostics(analysis: AnalyzeReport, io: CliIo): void {
  for (const diagnostic of analysis.diagnostics) io.log(formatDiagnostic(diagnostic));
}

function formatFinding(finding: GuardrailFinding): string {
  const marker =
    finding.status === "pass" ? "PASS" : finding.status === "warning" ? "WARN" : "FAIL";
  return `${marker} ${finding.id} ${finding.message}${
    finding.remediation ? `\n  ${finding.remediation}` : ""
  }`;
}

function printDoctor(report: DoctorReport, io: CliIo): void {
  for (const finding of report.findings) io.log(formatFinding(finding));
  printDiagnostics(report.analysis, io);
  io.log(
    `Doctor: ${report.summary.passed} passed, ${report.summary.warnings} warning(s), ${report.summary.errors} error(s).`,
  );
}

function printRepair(report: RepairReport, io: CliIo): void {
  for (const fix of report.analysis.appliedFixes) {
    io.log(`fixed ${fix.file} ${fix.ruleId}: ${fix.description}`);
  }
  printDiagnostics(report.analysis, io);
  io.log(
    `Repair: ${report.analysis.summary.appliedFixes} safe fix(es) applied, ${report.analysis.summary.diagnostics} finding(s) remain.`,
  );
  io.log(report.nextAction);
}

function printCheck(report: CheckReport, io: CliIo): void {
  printDiagnostics(report.analysis, io);
  for (const script of report.scripts) {
    if (script.stdout.trim()) io.log(script.stdout.trimEnd());
    if (script.stderr.trim()) io.error(script.stderr.trimEnd());
    const marker =
      script.status === "passed" ? "PASS" : script.status === "failed" ? "FAIL" : "SKIP";
    io.log(`${marker} ${script.command}${script.reason ? ` (${script.reason})` : ""}`);
  }
  io.log(
    `Check ${report.status}: ${report.analysis.summary.errors} analysis error(s), ${report.analysis.summary.warnings} warning(s), ${report.scripts.filter((entry) => entry.status === "passed").length} script(s) passed.`,
  );
}

export async function runGuardrailCli(
  command: GuardrailCommand,
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
  runtime: GuardrailRuntime = {},
): Promise<number> {
  const wantsJson = args.includes("--json");
  try {
    const parsed = parseGuardrailArgs(args);
    if (parsed.help) {
      io.log(helpText(command).trimEnd());
      return 0;
    }
    const options = {
      cwd: parsed.cwd,
      workspacePatterns: parsed.workspacePatterns,
    };
    const { runCheck, runDoctor, runRepair } = await import("../guardrails/runner");
    const report =
      command === "doctor"
        ? await runDoctor(options, runtime)
        : command === "repair"
          ? await runRepair(options)
          : await runCheck(options, runtime);
    if (parsed.json) io.log(JSON.stringify(report));
    else if (report.command === "doctor") printDoctor(report, io);
    else if (report.command === "repair") printRepair(report, io);
    else printCheck(report, io);
    if (report.command === "doctor") return report.summary.errors > 0 ? 1 : 0;
    if (report.command === "repair") return report.status === "clean" ? 0 : 1;
    return report.status === "passed" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(
      wantsJson ? JSON.stringify({ schemaVersion: 1, status: "error", error: message }) : message,
    );
    return 1;
  }
}
