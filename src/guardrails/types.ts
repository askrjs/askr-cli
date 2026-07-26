import type { AnalyzeReport } from "../analyze/types";

export const GUARDRAIL_SCHEMA_VERSION = 1;

export type GuardrailStatus = "pass" | "warning" | "error";

export interface GuardrailFinding {
  readonly id: string;
  readonly status: GuardrailStatus;
  readonly message: string;
  readonly remediation?: string;
}

export interface GuardrailSummary {
  readonly passed: number;
  readonly warnings: number;
  readonly errors: number;
}

export interface DoctorReport {
  readonly schemaVersion: typeof GUARDRAIL_SCHEMA_VERSION;
  readonly command: "doctor";
  readonly root: string;
  readonly findings: readonly GuardrailFinding[];
  readonly analysis: AnalyzeReport;
  readonly summary: GuardrailSummary;
}

export interface ScriptResult {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly reason?: string;
}

export interface CheckReport {
  readonly schemaVersion: typeof GUARDRAIL_SCHEMA_VERSION;
  readonly command: "check";
  readonly root: string;
  readonly analysis: AnalyzeReport;
  readonly scripts: readonly ScriptResult[];
  readonly status: "passed" | "failed";
}

export interface RepairReport {
  readonly schemaVersion: typeof GUARDRAIL_SCHEMA_VERSION;
  readonly command: "repair";
  readonly root: string;
  readonly analysis: AnalyzeReport;
  readonly status: "clean" | "needs-review";
  readonly nextAction: string;
}
