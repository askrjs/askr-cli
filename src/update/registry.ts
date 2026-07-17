import { execFile } from "node:child_process";
import path from "node:path";
import semver from "semver";
import { parseDependencySpecification } from "./specification";
import type { Packument } from "./types";

interface NpmInvocation {
  executable: string;
  prefix: string[];
}

export interface NpmConfiguration {
  cwd: string;
  env: NodeJS.ProcessEnv;
  invocation: NpmInvocation;
}

export interface RegistryRequirements {
  specifications?: ReadonlyMap<string, readonly string[]>;
}

interface FetchPackumentOptions {
  requirements?: RegistryRequirements;
  viewPackage?: ViewPackage;
}

type ViewPackage = (
  packageName: string,
  configuration: NpmConfiguration,
  specifications: readonly string[],
) => Promise<unknown>;

function npmInvocation(env: NodeJS.ProcessEnv): NpmInvocation {
  const executable = env.npm_execpath;
  const executableName = executable ? path.basename(executable).toLowerCase() : "";
  const isNpmExecutable =
    executableName === "npm" ||
    executableName === "npm.cmd" ||
    /^npm(?:-cli)?\.(?:cjs|js|mjs)$/.test(executableName);
  if (executable && isNpmExecutable) {
    const extension = path.extname(executable).toLowerCase();
    return [".cjs", ".js", ".mjs"].includes(extension)
      ? { executable: process.execPath, prefix: [executable] }
      : { executable, prefix: [] };
  }
  return { executable: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };
}

function executionEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env === process.env) return { ...process.env };
  const inherited = { ...process.env };
  for (const name of Object.keys(inherited)) {
    if (/^npm_config_/i.test(name)) delete inherited[name];
  }
  return { ...inherited, ...env };
}

export async function loadNpmConfiguration(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NpmConfiguration> {
  const effectiveEnvironment = executionEnvironment(env);
  return {
    cwd: root,
    env: effectiveEnvironment,
    invocation: npmInvocation(effectiveEnvironment),
  };
}

function npmError(error: { code?: string | number | null }, stderr: string): Error {
  const details = `${String(error.code ?? "")}\n${stderr}`;
  const safe = new Error("npm registry lookup failed") as Error & {
    code?: string;
    statusCode?: number;
  };
  const npmCode = details.match(/\bE(?:401|403|404|CONNRESET|TIMEDOUT|TIMEOUT)\b/i)?.[0];
  safe.code = npmCode?.toUpperCase() ?? (typeof error.code === "string" ? error.code : "");
  if (safe.code === "E401") safe.statusCode = 401;
  if (safe.code === "E403") safe.statusCode = 403;
  if (safe.code === "E404") safe.statusCode = 404;
  return safe;
}

function executeNpmJson(
  args: string[],
  configuration: NpmConfiguration,
  preferOnline: boolean,
): Promise<unknown> {
  const [command, ...positionals] = args;
  return new Promise((resolve, reject) => {
    execFile(
      configuration.invocation.executable,
      [
        ...configuration.invocation.prefix,
        command,
        "--json",
        preferOnline ? "--prefer-online" : "--prefer-offline",
        "--offline=false",
        "--loglevel=error",
        "--update-notifier=false",
        "--",
        ...positionals,
      ],
      {
        cwd: configuration.cwd,
        encoding: "utf8",
        env: configuration.env,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(npmError(error, stderr));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("npm registry returned malformed JSON"));
        }
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function basePackument(value: unknown): Packument | null {
  if (!isRecord(value) || !Array.isArray(value.versions) || !isRecord(value["dist-tags"])) {
    return null;
  }
  const versions = value.versions.filter(
    (version): version is string => typeof version === "string",
  );
  if (versions.length === 0) return null;
  return {
    "dist-tags": value["dist-tags"],
    versions: Object.fromEntries(versions.map((version) => [version, { version }])),
  };
}

function selectedVersions(packument: Packument, specifications: readonly string[]): string[] {
  const versions = Object.keys(packument.versions ?? {}).filter(
    (version) => semver.valid(version) !== null,
  );
  const selected = new Set(
    Object.values(packument["dist-tags"] ?? {}).filter(
      (version): version is string =>
        typeof version === "string" && semver.valid(version) !== null && versions.includes(version),
    ),
  );

  for (const specification of specifications) {
    const parsed = parseDependencySpecification(specification);
    if (parsed.type === "tag") {
      const tagged = packument["dist-tags"]?.[parsed.rawSpec];
      if (typeof tagged === "string" && versions.includes(tagged)) selected.add(tagged);
    } else if (parsed.type === "version") {
      if (versions.includes(parsed.rawSpec)) selected.add(parsed.rawSpec);
    } else if (parsed.type === "range") {
      const matching = semver.maxSatisfying(versions, parsed.rawSpec);
      if (matching) selected.add(matching);
    }
  }
  return [...selected].sort(semver.compare);
}

function mergeVersionMetadata(
  packument: Packument,
  value: unknown,
  selected: readonly string[],
): boolean {
  const entries = Array.isArray(value) ? value : [value];
  const merged = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (packument.versions?.[entry]) merged.add(entry);
      continue;
    }
    if (!isRecord(entry) || typeof entry.version !== "string") continue;
    const metadata = packument.versions?.[entry.version];
    if (!isRecord(metadata)) continue;
    if (isRecord(entry.peerDependencies)) metadata.peerDependencies = entry.peerDependencies;
    merged.add(entry.version);
  }
  return selected.every((version) => merged.has(version));
}

async function executeNpmView(
  packageName: string,
  configuration: NpmConfiguration,
  specifications: readonly string[],
): Promise<Packument | null> {
  const packument = basePackument(
    await executeNpmJson(["view", packageName, "versions", "dist-tags"], configuration, true),
  );
  if (!packument) return null;

  const versions = selectedVersions(packument, specifications);
  if (versions.length === 0) return packument;
  const selector = `${packageName}@${versions.join(" || ")}`;
  const metadata = await executeNpmJson(
    ["view", selector, "version", "peerDependencies"],
    configuration,
    false,
  );
  return mergeVersionMetadata(packument, metadata, versions) ? packument : null;
}

function isPackument(value: unknown): value is Packument {
  return isRecord(value) && isRecord(value["dist-tags"]) && isRecord(value.versions);
}

export function sanitizeRegistryError(error: unknown): string {
  const value =
    error && typeof error === "object" ? (error as { code?: unknown; statusCode?: unknown }) : {};
  if (value.statusCode === 404 || value.code === "E404") {
    return "package was not found in the selected registry";
  }
  if (
    value.statusCode === 401 ||
    value.statusCode === 403 ||
    value.code === "E401" ||
    value.code === "E403"
  ) {
    return "registry authentication or authorization failed";
  }
  const code = typeof value.code === "string" ? value.code.toUpperCase() : "";
  if (["ETIMEDOUT", "ETIMEOUT", "FETCH_ERROR", "ECONNRESET"].includes(code)) {
    return "registry request timed out or was interrupted";
  }
  if (/^[A-Z][A-Z0-9_]{1,30}$/.test(code)) return `registry request failed (${code})`;
  return "registry request failed";
}

export interface PackumentResults {
  packuments: Map<string, Packument>;
  failures: Map<string, string>;
}

export async function fetchPackuments(
  packageNames: string[],
  configuration: NpmConfiguration,
  options: FetchPackumentOptions = {},
): Promise<PackumentResults> {
  const names = [...new Set(packageNames)].sort((left, right) => left.localeCompare(right));
  const packuments = new Map<string, Packument>();
  const failures = new Map<string, string>();
  const viewPackage = options.viewPackage ?? executeNpmView;
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < names.length) {
      const packageName = names[nextIndex];
      nextIndex += 1;
      try {
        const result = await viewPackage(
          packageName,
          configuration,
          options.requirements?.specifications?.get(packageName) ?? [],
        );
        if (isPackument(result)) {
          packuments.set(packageName, result);
        } else {
          failures.set(packageName, "registry returned malformed package metadata");
        }
      } catch (error) {
        failures.set(packageName, sanitizeRegistryError(error));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, names.length) }, worker));
  return { packuments, failures };
}
