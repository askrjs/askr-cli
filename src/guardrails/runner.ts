import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { analysisHasBlockingFindings, runAnalysis } from "../analyze/runner";
import type { AnalyzeReport } from "../analyze/types";
import { inspectBundledSkills } from "../bin/skills";
import { discoverWorkspaceProject } from "../update/discovery";
import {
  GUARDRAIL_SCHEMA_VERSION,
  type CheckReport,
  type DoctorReport,
  type GuardrailFinding,
  type GuardrailSummary,
  type RepairReport,
  type ScriptResult,
} from "./types";

const SUPPORTED_NODE_RANGE = ">=24.0.0";
const VALIDATION_SCRIPTS = ["lint", "typecheck", "test", "build"] as const;

export interface GuardrailOptions {
  readonly cwd: string;
  readonly workspacePatterns: readonly string[];
}

export interface GuardrailRuntime {
  readonly nodeVersion?: string;
  readonly runScript?: (
    executable: string,
    args: readonly string[],
    cwd: string,
  ) => Promise<Omit<ScriptResult, "command" | "name">>;
  readonly runDatabaseValidation?: (cwd: string) => Promise<Omit<ScriptResult, "command" | "name">>;
}

function summary(findings: readonly GuardrailFinding[]): GuardrailSummary {
  return {
    passed: findings.filter((entry) => entry.status === "pass").length,
    warnings: findings.filter((entry) => entry.status === "warning").length,
    errors: findings.filter((entry) => entry.status === "error").length,
  };
}

function dependencyRecord(
  manifest: Record<string, unknown>,
  section: string,
): Record<string, unknown> {
  const value = manifest[section];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasAskrDependency(manifest: Record<string, unknown>): boolean {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
    (section) => "@askrjs/askr" in dependencyRecord(manifest, section),
  );
}

async function existingLockfiles(root: string): Promise<string[]> {
  const candidates = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
  const present = await Promise.all(
    candidates.map(async (name) => ({
      name,
      exists: Boolean(await fs.stat(path.join(root, name)).catch(() => null)),
    })),
  );
  return present.filter((entry) => entry.exists).map((entry) => entry.name);
}

function declaredPackageManager(manifest: Record<string, unknown>): string | null {
  if (typeof manifest.packageManager !== "string") return null;
  const match = /^(npm|pnpm|yarn|bun)@/.exec(manifest.packageManager);
  return match?.[1] ?? null;
}

function lockfilePackageManager(lockfile: string): string {
  if (lockfile === "package-lock.json") return "npm";
  if (lockfile === "pnpm-lock.yaml") return "pnpm";
  if (lockfile === "yarn.lock") return "yarn";
  return "bun";
}

function packageManagerFinding(
  lockfiles: readonly string[],
  manifest: Record<string, unknown>,
): GuardrailFinding {
  const declared = declaredPackageManager(manifest);
  if (lockfiles.length > 1) {
    return {
      id: "askr/doctor-package-manager",
      status: "error",
      message: `Multiple package-manager lockfiles are present: ${lockfiles.join(", ")}.`,
      remediation: "Keep the lockfile for the project's canonical package manager.",
    };
  }
  if (lockfiles.length === 0) {
    return {
      id: "askr/doctor-package-manager",
      status: "warning",
      message: "No package-manager lockfile is present.",
      remediation: "Install dependencies with the project's chosen package manager.",
    };
  }
  const detected = lockfilePackageManager(lockfiles[0]);
  if (declared && declared !== detected) {
    return {
      id: "askr/doctor-package-manager",
      status: "error",
      message: `packageManager declares ${declared}, but ${lockfiles[0]} belongs to ${detected}.`,
      remediation: "Align packageManager and the committed lockfile.",
    };
  }
  return {
    id: "askr/doctor-package-manager",
    status: "pass",
    message: `Package manager is ${declared ?? detected} (${lockfiles[0]}).`,
  };
}

async function skillsFinding(root: string): Promise<GuardrailFinding> {
  const status = await inspectBundledSkills({ cwd: root });
  if (status.installed === 0) {
    return {
      id: "askr/doctor-agent-guidance",
      status: "warning",
      message: "Project-local Askr agent skills are not installed.",
      remediation: "Run `askr skills install`, or `askr skills sync` for an existing project.",
    };
  }
  if (!status.current) {
    const differences = [
      status.missing.length > 0 ? `${status.missing.length} missing` : "",
      status.modified.length > 0 ? `${status.modified.length} modified` : "",
      status.obsolete.length > 0 ? `${status.obsolete.length} obsolete` : "",
    ].filter(Boolean);
    return {
      id: "askr/doctor-agent-guidance",
      status: "warning",
      message: `Project-local Askr agent skills are stale (${differences.join(", ")}).`,
      remediation: "Run `askr skills sync` to restore the current bundled guidance.",
    };
  }
  return {
    id: "askr/doctor-agent-guidance",
    status: "pass",
    message: `${status.bundled} project-local Askr agent skill(s) are current.`,
  };
}

function analysisFinding(analysis: AnalyzeReport): GuardrailFinding {
  if (analysis.summary.errors > 0) {
    return {
      id: "askr/doctor-analysis",
      status: "error",
      message: `Static analysis found ${analysis.summary.errors} error(s) and ${analysis.summary.warnings} warning(s).`,
      remediation: "Run `askr repair`, review remaining findings, then run `askr check`.",
    };
  }
  if (analysis.summary.warnings > 0) {
    return {
      id: "askr/doctor-analysis",
      status: "warning",
      message: `Static analysis found ${analysis.summary.warnings} warning(s).`,
      remediation: "Review the reported performance or lifecycle guidance.",
    };
  }
  return {
    id: "askr/doctor-analysis",
    status: "pass",
    message: `Static analysis is clean across ${analysis.workspaces.length} workspace(s).`,
  };
}

export async function runDoctor(
  options: GuardrailOptions,
  runtime: GuardrailRuntime = {},
): Promise<DoctorReport> {
  const project = await discoverWorkspaceProject({
    cwd: options.cwd,
    workspacePatterns: [...options.workspacePatterns],
  });
  const analysis = await runAnalysis({
    cwd: options.cwd,
    workspacePatterns: [...options.workspacePatterns],
    check: true,
  });
  const rootWorkspace = project.workspaces.find((workspace) => workspace.isRoot);
  if (!rootWorkspace) throw new Error("Discovered project is missing its root workspace.");
  const nodeVersion = runtime.nodeVersion ?? process.versions.node;
  const findings: GuardrailFinding[] = [
    semver.satisfies(nodeVersion, SUPPORTED_NODE_RANGE)
      ? {
          id: "askr/doctor-node",
          status: "pass",
          message: `Node ${nodeVersion} satisfies ${SUPPORTED_NODE_RANGE}.`,
        }
      : {
          id: "askr/doctor-node",
          status: "error",
          message: `Node ${nodeVersion} does not satisfy ${SUPPORTED_NODE_RANGE}.`,
          remediation: `Install a Node version matching ${SUPPORTED_NODE_RANGE}.`,
        },
    packageManagerFinding(await existingLockfiles(project.root), rootWorkspace.manifest),
  ];

  const sourceWorkspaces = new Set(
    analysis.workspaces
      .filter((workspace) => workspace.files > 0)
      .map((workspace) => workspace.name),
  );
  const missingFramework = project.selectedWorkspaces.filter(
    (workspace) => sourceWorkspaces.has(workspace.name) && !hasAskrDependency(workspace.manifest),
  );
  findings.push(
    missingFramework.length === 0
      ? {
          id: "askr/doctor-framework-dependency",
          status: "pass",
          message: "Source workspaces declare @askrjs/askr.",
        }
      : {
          id: "askr/doctor-framework-dependency",
          status: "error",
          message: `Source workspace(s) do not declare @askrjs/askr: ${missingFramework
            .map((workspace) => workspace.name)
            .join(", ")}.`,
          remediation: "Declare @askrjs/askr in each application workspace.",
        },
  );
  findings.push(await skillsFinding(project.root), analysisFinding(analysis));
  return {
    schemaVersion: GUARDRAIL_SCHEMA_VERSION,
    command: "doctor",
    root: project.root,
    findings,
    analysis,
    summary: summary(findings),
  };
}

function scriptsFromManifest(manifest: Record<string, unknown>): Record<string, string> {
  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function defaultRunScript(
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<Omit<ScriptResult, "command" | "name">> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "passed" : "failed",
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

function managerCommand(
  lockfiles: readonly string[],
  manifest: Record<string, unknown>,
): { executable: string; args: (script: string) => string[] } {
  const executable =
    declaredPackageManager(manifest) ??
    (lockfiles.length === 1 ? lockfilePackageManager(lockfiles[0]) : "npm");
  return { executable, args: (script) => ["run", script] };
}

export async function runCheck(
  options: GuardrailOptions,
  runtime: GuardrailRuntime = {},
): Promise<CheckReport> {
  const project = await discoverWorkspaceProject({
    cwd: options.cwd,
    workspacePatterns: [...options.workspacePatterns],
  });
  const rootWorkspace = project.workspaces.find((workspace) => workspace.isRoot);
  if (!rootWorkspace) throw new Error("Discovered project is missing its root workspace.");
  const analysis = await runAnalysis({
    cwd: options.cwd,
    workspacePatterns: [...options.workspacePatterns],
    check: true,
  });
  const scripts = scriptsFromManifest(rootWorkspace.manifest);
  const selected = VALIDATION_SCRIPTS.filter((name) => scripts[name]);
  const lockfiles = await existingLockfiles(project.root);
  const manager = managerCommand(lockfiles, rootWorkspace.manifest);
  const results: ScriptResult[] = [];
  const hasDatabase = Boolean(
    await fs.stat(path.join(project.root, "database", "index.ts")).catch(() => null),
  );
  const selectedChecks = [...(hasDatabase ? (["database"] as const) : []), ...selected];

  if (analysisHasBlockingFindings(analysis)) {
    for (const name of selectedChecks) {
      results.push({
        name,
        status: "skipped",
        command:
          name === "database" ? "askr database validate" : `${manager.executable} run ${name}`,
        exitCode: null,
        stdout: "",
        stderr: "",
        reason: "static analysis must pass first",
      });
    }
  } else {
    for (const [index, name] of selectedChecks.entries()) {
      if (name === "database") {
        const runDatabase =
          runtime.runDatabaseValidation ?? (await import("../bin/database")).runDatabaseValidation;
        const result = await runDatabase(project.root);
        results.push({
          name,
          command: "askr database validate",
          ...result,
        });
        if (result.status === "failed") {
          for (const skipped of selectedChecks.slice(index + 1)) {
            results.push({
              name: skipped,
              status: "skipped",
              command: `${manager.executable} run ${skipped}`,
              exitCode: null,
              stdout: "",
              stderr: "",
              reason: "database validation failed",
            });
          }
          break;
        }
        continue;
      }
      const args = manager.args(name);
      const result = await (runtime.runScript ?? defaultRunScript)(
        manager.executable,
        args,
        project.root,
      );
      results.push({
        name,
        command: [manager.executable, ...args].join(" "),
        ...result,
      });
      if (result.status === "failed") {
        for (const skipped of selectedChecks.slice(index + 1)) {
          results.push({
            name: skipped,
            status: "skipped",
            command: `${manager.executable} run ${skipped}`,
            exitCode: null,
            stdout: "",
            stderr: "",
            reason: `${name} failed`,
          });
        }
        break;
      }
    }
  }

  const failed =
    analysisHasBlockingFindings(analysis) || results.some((entry) => entry.status === "failed");
  return {
    schemaVersion: GUARDRAIL_SCHEMA_VERSION,
    command: "check",
    root: project.root,
    analysis,
    scripts: results,
    status: failed ? "failed" : "passed",
  };
}

export async function runRepair(options: GuardrailOptions): Promise<RepairReport> {
  const analysis = await runAnalysis({
    cwd: options.cwd,
    workspacePatterns: [...options.workspacePatterns],
    check: false,
  });
  const needsReview = analysisHasBlockingFindings(analysis);
  return {
    schemaVersion: GUARDRAIL_SCHEMA_VERSION,
    command: "repair",
    root: analysis.root,
    analysis,
    status: needsReview ? "needs-review" : "clean",
    nextAction: needsReview
      ? "Review the remaining semantic diagnostics, then run `askr repair` again."
      : "Run `askr check` to execute the full validation path.",
  };
}
