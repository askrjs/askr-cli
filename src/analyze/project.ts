import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import ts from "typescript";
import type { AnalyzeConfiguration, WorkspaceAnalysisContext } from "./types";
import type { WorkspaceManifest } from "../update/types";

export const DEFAULT_ANALYZE_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.git/**",
  "**/.next/**",
  "**/.output/**",
  "**/.turbo/**",
  "**/generated/**",
  "**/*.d.ts",
] as const;

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/;

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function readAnalyzeConfiguration(
  rootManifest: Record<string, unknown>,
): AnalyzeConfiguration {
  const askr = rootManifest.askr;
  if (askr === undefined) {
    return { exclude: [...DEFAULT_ANALYZE_EXCLUDES], rules: {} };
  }
  const askrConfig = asObject(askr, "Invalid askr configuration in the workspace root.");
  const raw = askrConfig.analyze;
  if (raw === undefined) {
    return { exclude: [...DEFAULT_ANALYZE_EXCLUDES], rules: {} };
  }
  const analyze = asObject(raw, "Invalid askr.analyze configuration; expected an object.");
  const exclude = analyze.exclude ?? [];
  const rules = analyze.rules ?? {};
  if (!Array.isArray(exclude) || exclude.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error("Invalid askr.analyze.exclude; expected an array of non-empty patterns.");
  }
  const ruleObject = asObject(
    rules,
    "Invalid askr.analyze.rules; expected rule-to-severity entries.",
  );
  const allowed = new Set(["off", "info", "warning", "error"]);
  if (
    Object.entries(ruleObject).some(
      ([id, severity]) => !id || typeof severity !== "string" || !allowed.has(severity),
    )
  ) {
    throw new Error("Invalid askr.analyze.rules; severities must be off, info, warning, or error.");
  }
  return {
    exclude: [...DEFAULT_ANALYZE_EXCLUDES, ...(exclude as string[])],
    rules: ruleObject as AnalyzeConfiguration["rules"],
  };
}

function normalizeRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isExcluded(root: string, filePath: string, patterns: readonly string[]): boolean {
  const relative = normalizeRelative(root, filePath);
  return patterns.some((pattern) =>
    minimatch(relative, pattern, {
      dot: true,
      nocase: process.platform === "win32",
      windowsPathsNoEscape: true,
    }),
  );
}

async function discoverSourceFiles(
  directory: string,
  root: string,
  exclusions: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (isExcluded(root, child, exclusions)) continue;
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
        files.push(child);
      }
    }
  };
  await visit(directory);
  return files;
}

function formatConfigDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

async function compilerInputs(
  workspace: WorkspaceManifest,
  configuration: AnalyzeConfiguration,
): Promise<{
  rootNames: string[];
  options: ts.CompilerOptions;
  tsconfig: string | null;
}> {
  const tsconfig = path.join(workspace.directory, "tsconfig.json");
  const hasConfig = (await fs.stat(tsconfig).catch(() => null))?.isFile() ?? false;
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "@askrjs/askr",
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  let configuredFiles: string[] = [];

  if (hasConfig) {
    const loaded = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (loaded.error) throw new Error(`${tsconfig}: ${formatConfigDiagnostic(loaded.error)}`);
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      workspace.directory,
      {
        allowJs: true,
        noEmit: true,
        noLib: true,
        skipLibCheck: true,
        types: [],
      },
      tsconfig,
    );
    const error = parsed.errors.find(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (error) throw new Error(`${tsconfig}: ${formatConfigDiagnostic(error)}`);
    options = parsed.options;
    configuredFiles = parsed.fileNames;
  }

  const discovered = await discoverSourceFiles(
    workspace.directory,
    workspace.directory,
    configuration.exclude,
  );
  const rootNames = [...new Set([...configuredFiles, ...discovered])]
    .filter((filePath) => !isExcluded(workspace.directory, filePath, configuration.exclude))
    .sort((left, right) => left.localeCompare(right));
  return { rootNames, options, tsconfig: hasConfig ? tsconfig : null };
}

export async function createWorkspaceAnalysisContext(
  root: string,
  workspace: WorkspaceManifest,
  configuration: AnalyzeConfiguration,
): Promise<{ context: WorkspaceAnalysisContext; tsconfig: string | null }> {
  const inputs = await compilerInputs(workspace, configuration);
  const compilerHost = ts.createCompilerHost(inputs.options, true);
  const moduleResolutionCache = ts.createModuleResolutionCache(
    workspace.directory,
    (fileName) => compilerHost.getCanonicalFileName(fileName),
    inputs.options,
  );
  compilerHost.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
  ) =>
    moduleLiterals.map((moduleLiteral) => {
      const resolution = ts.resolveModuleName(
        moduleLiteral.text,
        containingFile,
        options,
        compilerHost,
        moduleResolutionCache,
        redirectedReference,
      );
      const resolved = resolution.resolvedModule;
      if (!resolved) return resolution;
      const realPath = ts.sys.realpath?.(resolved.resolvedFileName) ?? resolved.resolvedFileName;
      const relativeToProject = path.relative(root, realPath);
      const isProjectFile =
        relativeToProject !== ".." &&
        !relativeToProject.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeToProject) &&
        !relativeToProject.split(path.sep).includes("node_modules");
      return isProjectFile ? resolution : { ...resolution, resolvedModule: undefined };
    });
  const program = ts.createProgram({
    rootNames: inputs.rootNames,
    options: inputs.options,
    host: compilerHost,
  });
  const sourceFileSet = new Set(inputs.rootNames.map((filePath) => path.resolve(filePath)));
  const sourceFiles = program
    .getSourceFiles()
    .filter((sourceFile) => sourceFileSet.has(path.resolve(sourceFile.fileName)))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  return {
    context: {
      root,
      workspace,
      program,
      checker: program.getTypeChecker(),
      sourceFiles,
      configuration,
    },
    tsconfig: inputs.tsconfig,
  };
}

export function workspaceRelativeFile(
  context: Pick<WorkspaceAnalysisContext, "workspace">,
  filePath: string,
): string {
  return normalizeRelative(context.workspace.directory, filePath) || path.basename(filePath);
}
