import fs from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";
import { minimatch } from "minimatch";
import semver from "semver";
import { analyzeRange } from "./range";
import { parseDependencySpecification } from "./specification";
import {
  DEPENDENCY_SECTIONS,
  type DependencyOccurrence,
  type DiscoveredProject,
  type DiscoveredWorkspaceProject,
  type UpdatePolicy,
  type WorkspaceManifest,
} from "./types";

interface DiscoveryOptions {
  cwd: string;
  packagePatterns: string[];
  workspacePatterns: string[];
}

async function isFile(filePath: string): Promise<boolean> {
  return (await fs.stat(filePath).catch(() => null))?.isFile() ?? false;
}

async function readManifest(manifestPath: string): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await fs.readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`Unable to read manifest: ${manifestPath}`);
  }

  try {
    const value = JSON.parse(source.replace(/^\uFEFF/, "")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`Malformed package manifest: ${manifestPath}`);
  }
}

function packageWorkspacePatterns(manifest: Record<string, unknown>): string[] | null {
  if (!("workspaces" in manifest)) return null;
  const declaration = manifest.workspaces;
  const patterns = Array.isArray(declaration)
    ? declaration
    : declaration && typeof declaration === "object" && !Array.isArray(declaration)
      ? (declaration as Record<string, unknown>).packages
      : null;

  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string")) {
    throw new Error("Invalid package.json workspaces declaration; expected an array of paths.");
  }
  return patterns as string[];
}

async function pnpmWorkspacePatterns(root: string): Promise<string[] | null> {
  const workspacePath = path.join(root, "pnpm-workspace.yaml");
  if (!(await isFile(workspacePath))) return null;

  const source = await fs.readFile(workspacePath, "utf8");
  let value: unknown;
  try {
    value = load(source);
  } catch {
    throw new Error(`Malformed pnpm workspace declaration: ${workspacePath}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid pnpm workspace declaration; expected a mapping with packages.");
  }
  const packages = (value as Record<string, unknown>).packages;
  if (!Array.isArray(packages) || packages.some((pattern) => typeof pattern !== "string")) {
    throw new Error("Invalid pnpm workspace declaration; expected packages to be an array.");
  }
  return packages as string[];
}

async function findProjectRoot(start: string): Promise<string> {
  const resolved = path.resolve(start);
  const startStat = await fs.stat(resolved).catch(() => null);
  if (!startStat?.isDirectory()) throw new Error(`Working directory does not exist: ${resolved}`);

  let directory = resolved;
  let nearestManifestDirectory: string | null = null;

  while (true) {
    const manifestPath = path.join(directory, "package.json");
    const hasManifest = await isFile(manifestPath);
    if (hasManifest) {
      const manifest = await readManifest(manifestPath);
      nearestManifestDirectory ??= directory;
      if (packageWorkspacePatterns(manifest) !== null) return directory;
    }

    if (await isFile(path.join(directory, "pnpm-workspace.yaml"))) {
      if (!hasManifest) throw new Error(`Workspace root is missing package.json: ${directory}`);
      await pnpmWorkspacePatterns(directory);
      return directory;
    }

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (nearestManifestDirectory) return nearestManifestDirectory;
  throw new Error(`No package.json found from ${resolved}.`);
}

function parsePolicy(manifest: Record<string, unknown>): UpdatePolicy {
  const empty = { ignore: [], tags: {} };
  if (!("askr" in manifest)) return empty;
  if (!manifest.askr || typeof manifest.askr !== "object" || Array.isArray(manifest.askr)) {
    throw new Error("Invalid askr update configuration in the workspace root.");
  }
  const update = (manifest.askr as Record<string, unknown>).update;
  if (update === undefined) return empty;
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new Error("Invalid askr.update configuration in the workspace root.");
  }

  const config = update as Record<string, unknown>;
  const ignore = config.ignore ?? [];
  const tags = config.tags ?? {};
  if (!Array.isArray(ignore) || ignore.some((entry) => typeof entry !== "string")) {
    throw new Error("Invalid askr.update.ignore configuration; expected an array of patterns.");
  }
  if (
    !tags ||
    typeof tags !== "object" ||
    Array.isArray(tags) ||
    Object.entries(tags).some(([name, tag]) => !name || typeof tag !== "string" || !tag)
  ) {
    throw new Error("Invalid askr.update.tags configuration; expected package-to-tag strings.");
  }

  return { ignore: ignore as string[], tags: tags as Record<string, string> };
}

function relativeManifestPath(root: string, manifestPath: string): string {
  return path.relative(root, manifestPath).split(path.sep).join("/") || "package.json";
}

function workspaceName(manifest: Record<string, unknown>, fallback: string): string {
  return typeof manifest.name === "string" && manifest.name.trim() ? manifest.name : fallback;
}

const WORKSPACE_GLOB_OPTIONS = {
  dot: true,
  nocase: process.platform === "win32",
  windowsPathsNoEscape: true,
} as const;

function normalizeWorkspacePattern(pattern: string): { negative: boolean; value: string } {
  const leadingBangs = pattern.match(/^!+/)?.[0].length ?? 0;
  const negative = leadingBangs % 2 === 1;
  let value = pattern.slice(leadingBangs);
  value = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (value.endsWith("/package.json")) value = value.slice(0, -"/package.json".length);
  if (value === ".." || value.startsWith("../")) {
    throw new Error(`Workspace patterns outside the project root are unsupported: ${pattern}`);
  }
  return { negative, value: value || "." };
}

function matchesWorkspace(relativeDirectory: string, patterns: string[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    const normalized = normalizeWorkspacePattern(pattern);
    if (minimatch(relativeDirectory, normalized.value, WORKSPACE_GLOB_OPTIONS)) {
      included = !normalized.negative;
    }
  }
  return included;
}

function mayContainWorkspace(relativeDirectory: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = normalizeWorkspacePattern(pattern);
    return (
      !normalized.negative &&
      minimatch(relativeDirectory, normalized.value, {
        ...WORKSPACE_GLOB_OPTIONS,
        partial: true,
      })
    );
  });
}

async function mapDeclaredWorkspaces(
  root: string,
  patterns: string[],
): Promise<Map<string, string>> {
  const directories: string[] = [];
  if (matchesWorkspace(".", patterns)) directories.push(root);

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const childRelative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (!mayContainWorkspace(childRelative, patterns)) continue;
      const child = path.join(directory, entry.name);
      const isSymbolicDirectory =
        entry.isSymbolicLink() && (await fs.stat(child).catch(() => null))?.isDirectory();
      if (!entry.isDirectory() && !isSymbolicDirectory) continue;
      if (
        matchesWorkspace(childRelative, patterns) &&
        (await isFile(path.join(child, "package.json")))
      ) {
        directories.push(child);
      }
      if (!entry.isSymbolicLink()) await visit(child, childRelative);
    }
  };

  await visit(root, "");
  const mapped = new Map<string, string>();
  for (const directory of directories.sort((left, right) => left.localeCompare(right))) {
    const manifest = await readManifest(path.join(directory, "package.json"));
    const fallback = path.basename(directory);
    const name = workspaceName(manifest, fallback);
    if (mapped.has(name)) {
      throw new Error(`Multiple workspaces with the same name '${name}'.`);
    }
    mapped.set(name, directory);
  }
  return mapped;
}

async function discoverWorkspaces(root: string): Promise<{
  policy: UpdatePolicy;
  rootManifest: Record<string, unknown>;
  workspaces: WorkspaceManifest[];
}> {
  const rootManifestPath = path.join(root, "package.json");
  const rootManifest = await readManifest(rootManifestPath);
  const policy = parsePolicy(rootManifest);
  const packagePatterns = packageWorkspacePatterns(rootManifest) ?? [];
  const pnpmPatterns = (await pnpmWorkspacePatterns(root)) ?? [];
  const patterns = [...packagePatterns, ...pnpmPatterns];
  const mapped = patterns.length > 0 ? await mapDeclaredWorkspaces(root, patterns) : new Map();

  const rootName = workspaceName(rootManifest, "(root)");
  if (mapped.has(rootName)) {
    throw new Error(`Duplicate workspace name '${rootName}' includes the workspace root.`);
  }

  const workspaces: WorkspaceManifest[] = [
    {
      name: rootName,
      directory: root,
      manifestPath: rootManifestPath,
      relativeManifestPath: "package.json",
      manifest: rootManifest,
      isRoot: true,
    },
  ];

  for (const [mappedName, directory] of mapped) {
    const manifestPath = path.join(directory, "package.json");
    const manifest = await readManifest(manifestPath);
    workspaces.push({
      name: workspaceName(manifest, mappedName),
      directory,
      manifestPath,
      relativeManifestPath: relativeManifestPath(root, manifestPath),
      manifest,
      isRoot: false,
    });
  }

  workspaces.sort((left, right) => {
    if (left.isRoot !== right.isRoot) return left.isRoot ? -1 : 1;
    return (
      left.name.localeCompare(right.name) || left.manifestPath.localeCompare(right.manifestPath)
    );
  });
  return { policy, rootManifest, workspaces };
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(value, pattern, { dot: true }));
}

function isRegistryPackageName(packageName: string): boolean {
  if (
    !packageName ||
    packageName.length > 214 ||
    /^[._-]/.test(packageName) ||
    /[\s%\\:]/.test(packageName)
  ) {
    return false;
  }
  if (!packageName.startsWith("@")) return !packageName.includes("/");
  const parts = packageName.slice(1).split("/");
  return parts.length === 2 && parts.every((part) => part.length > 0 && !/^[._-]/.test(part));
}

function classifySpecification(
  packageName: string,
  specification: string,
  directory: string,
  localNames: Set<string>,
): Pick<DependencyOccurrence, "kind" | "registryManaged" | "reason"> {
  if (localNames.has(packageName)) {
    return {
      kind: "local",
      registryManaged: false,
      reason: "dependency resolves to a discovered workspace",
    };
  }
  if (/^workspace:/i.test(specification)) {
    return {
      kind: "local",
      registryManaged: false,
      reason: "workspace protocol is not registry-managed",
    };
  }
  if (/^link:/i.test(specification)) {
    return {
      kind: "local",
      registryManaged: false,
      reason: "link protocol is not registry-managed",
    };
  }
  if (!isRegistryPackageName(packageName)) {
    return {
      kind: "manual",
      registryManaged: false,
      reason: "invalid registry package name",
    };
  }

  const parsed = parseDependencySpecification(specification);

  if (["file", "git", "remote"].includes(parsed.type)) {
    return {
      kind: "local",
      registryManaged: false,
      reason: `${parsed.type} specification is not registry-managed`,
    };
  }
  if (parsed.type === "alias") {
    return { kind: "manual", registryManaged: false, reason: "npm aliases require manual review" };
  }
  if (parsed.type === "tag") {
    return { kind: "current", registryManaged: true, reason: "tracking tag is not rewritten" };
  }
  if (parsed.type !== "range" && parsed.type !== "version") {
    return {
      kind: "manual",
      registryManaged: false,
      reason: "unsupported dependency specification",
    };
  }

  const analysis = analyzeRange(specification);
  if (analysis.tracking) {
    return { kind: "current", registryManaged: true, reason: analysis.reason };
  }
  if (!analysis.shape) {
    return { kind: "manual", registryManaged: false, reason: analysis.reason };
  }
  return { kind: "fetch", registryManaged: true, reason: "" };
}

function collectOccurrences(
  root: string,
  workspaces: WorkspaceManifest[],
  localNames: Set<string>,
  policy: UpdatePolicy,
  packagePatterns: string[],
): DependencyOccurrence[] {
  const occurrences: DependencyOccurrence[] = [];
  for (const workspace of workspaces) {
    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = workspace.manifest[section];
      if (dependencies === undefined) continue;
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
        throw new Error(
          `Invalid ${section} in ${workspace.relativeManifestPath}; expected an object.`,
        );
      }

      for (const [packageName, specification] of Object.entries(dependencies)) {
        if (typeof specification !== "string") {
          throw new Error(
            `Invalid ${section}.${packageName} in ${workspace.relativeManifestPath}.`,
          );
        }
        if (packagePatterns.length > 0 && !matchesAny(packageName, packagePatterns)) continue;
        if (packagePatterns.length === 0 && matchesAny(packageName, policy.ignore)) continue;
        occurrences.push({
          package: packageName,
          workspace: workspace.name,
          manifestPath: workspace.manifestPath,
          relativeManifestPath: relativeManifestPath(root, workspace.manifestPath),
          section,
          currentSpecification: specification,
          ...classifySpecification(packageName, specification, workspace.directory, localNames),
        });
      }
    }
  }

  const sectionOrder = new Map(DEPENDENCY_SECTIONS.map((section, index) => [section, index]));
  occurrences.sort(
    (left, right) =>
      left.package.localeCompare(right.package) ||
      left.workspace.localeCompare(right.workspace) ||
      left.relativeManifestPath.localeCompare(right.relativeManifestPath) ||
      sectionOrder.get(left.section)! - sectionOrder.get(right.section)!,
  );
  return occurrences;
}

export async function discoverWorkspaceProject(
  options: Pick<DiscoveryOptions, "cwd" | "workspacePatterns">,
): Promise<DiscoveredWorkspaceProject> {
  const root = await findProjectRoot(options.cwd);
  const { policy, workspaces } = await discoverWorkspaces(root);
  const selectedWorkspaces =
    options.workspacePatterns.length === 0
      ? workspaces
      : workspaces.filter((workspace) => matchesAny(workspace.name, options.workspacePatterns));
  if (selectedWorkspaces.length === 0) {
    throw new Error("No discovered workspace matches the requested --workspace filters.");
  }
  return { root, workspaces, selectedWorkspaces, policy };
}

export async function discoverProject(options: DiscoveryOptions): Promise<DiscoveredProject> {
  const { root, workspaces, selectedWorkspaces, policy } = await discoverWorkspaceProject(options);

  const localNames = new Set(workspaces.map((workspace) => workspace.name));
  const localVersions = new Map(
    workspaces.flatMap((workspace) =>
      typeof workspace.manifest.version === "string" && semver.valid(workspace.manifest.version)
        ? [[workspace.name, workspace.manifest.version] as const]
        : [],
    ),
  );
  return {
    root,
    workspaces,
    selectedWorkspaces,
    policy,
    occurrences: collectOccurrences(
      root,
      selectedWorkspaces,
      localNames,
      policy,
      options.packagePatterns,
    ),
    contextOccurrences: collectOccurrences(
      root,
      selectedWorkspaces,
      localNames,
      { ignore: [], tags: policy.tags },
      [],
    ),
    localVersions,
  };
}
