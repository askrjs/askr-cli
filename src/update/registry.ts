import path from "node:path";
import { fileURLToPath } from "node:url";
import Config from "@npmcli/config";
import npmDefinitions from "@npmcli/config/lib/definitions";
import registryFetch from "npm-registry-fetch";
import type { Packument } from "./types";

export interface NpmConfiguration {
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: Record<string, unknown>;
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
  const { definitions, flatten, shorthands } = npmDefinitions;
  const npmPath = path.dirname(fileURLToPath(import.meta.resolve("@npmcli/config/package.json")));
  const configuration = new Config({
    npmPath,
    definitions,
    flatten,
    shorthands,
    argv: [process.execPath, "askr"],
    cwd: root,
    env: effectiveEnvironment,
    execPath: process.execPath,
    warn: false,
  });
  await configuration.load();
  configuration.validate();
  return { cwd: root, env: effectiveEnvironment, options: { ...configuration.flat } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPackument(value: unknown): value is Packument {
  return isRecord(value) && isRecord(value["dist-tags"]) && isRecord(value.versions);
}

async function fetchPackage(
  packageName: string,
  configuration: NpmConfiguration,
  _specifications: readonly string[],
): Promise<unknown> {
  return registryFetch.json(packageName.replace("/", "%2f"), {
    ...configuration.options,
    spec: packageName,
    headers: {
      ...(isRecord(configuration.options.headers) ? configuration.options.headers : {}),
      accept: "application/vnd.npm.install-v1+json",
    },
  });
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
  const viewPackage = options.viewPackage ?? fetchPackage;
  const configuredSockets = Number(configuration.options.maxSockets ?? 15);
  const concurrency = Math.max(
    1,
    Math.min(names.length, Number.isFinite(configuredSockets) ? configuredSockets : 15),
  );
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < names.length) {
      const packageName = names[nextIndex++];
      try {
        const result = await viewPackage(
          packageName,
          configuration,
          options.requirements?.specifications?.get(packageName) ?? [],
        );
        if (isPackument(result)) packuments.set(packageName, result);
        else failures.set(packageName, "registry returned malformed package metadata");
      } catch (error) {
        failures.set(packageName, sanitizeRegistryError(error));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { packuments, failures };
}
