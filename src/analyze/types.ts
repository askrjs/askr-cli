import type ts from "typescript";
import type { WorkspaceManifest } from "../update/types";

export const ANALYZE_SCHEMA_VERSION = 1;

export type AnalyzeSeverity = "error" | "warning" | "info";
export type AnalyzeCategory = "correctness" | "performance" | "configuration";
export type RuleSetting = AnalyzeSeverity | "off";

export interface AnalyzeFix {
  readonly description: string;
  readonly filePath: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export interface AnalyzeDiagnostic {
  readonly ruleId: string;
  readonly category: AnalyzeCategory;
  readonly severity: AnalyzeSeverity;
  readonly message: string;
  readonly workspace: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly remediation?: string;
  readonly fix?: AnalyzeFix;
}

export interface PublicDiagnostic extends Omit<AnalyzeDiagnostic, "fix"> {
  readonly fix?: {
    readonly description: string;
    readonly safe: true;
  };
}

export interface AnalyzeConfiguration {
  readonly exclude: string[];
  readonly rules: Record<string, RuleSetting>;
}

export interface WorkspaceAnalysisContext {
  readonly root: string;
  readonly workspace: WorkspaceManifest;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly sourceFiles: readonly ts.SourceFile[];
  readonly configuration: AnalyzeConfiguration;
}

export interface AnalyzeRule {
  readonly id: string;
  readonly category: AnalyzeCategory;
  readonly severity: AnalyzeSeverity;
  readonly description: string;
  analyze(context: WorkspaceAnalysisContext): AnalyzeDiagnostic[];
}

export interface AnalyzeWorkspaceResult {
  readonly name: string;
  readonly path: string;
  readonly tsconfig: string | null;
  readonly files: number;
}

export interface AnalyzeFixResult {
  readonly ruleId: string;
  readonly workspace: string;
  readonly file: string;
  readonly description: string;
  readonly reason?: string;
}

export interface AnalyzeSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
  readonly diagnostics: number;
  readonly appliedFixes: number;
  readonly skippedFixes: number;
}

export interface AnalyzeReport {
  readonly schemaVersion: typeof ANALYZE_SCHEMA_VERSION;
  readonly root: string;
  readonly discoveredWorkspaces: readonly string[];
  readonly selectedWorkspaces: readonly string[];
  readonly workspaces: readonly AnalyzeWorkspaceResult[];
  readonly appliedFixes: readonly AnalyzeFixResult[];
  readonly skippedFixes: readonly AnalyzeFixResult[];
  readonly diagnostics: readonly PublicDiagnostic[];
  readonly summary: AnalyzeSummary;
}
