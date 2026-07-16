import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  NpmConfig,
  npmConfigDefinitions,
  npmPackageArg,
  npmRegistryFetch,
  type NpmFetchOptions,
} from "./npm-adapters";
import type { Packument } from "./types";

const ABBREVIATED_PACKUMENT =
  "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

function npmPathFromExecutable(executable: string): string | null {
  let directory = path.dirname(path.resolve(executable));
  for (let depth = 0; depth < 5; depth += 1) {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = createRequire(import.meta.url)(manifestPath) as { name?: string };
        if (manifest.name === "npm") return directory;
      } catch {
        // Continue to a parent; npm may be launched through a shim.
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

function resolveNpmPath(env: NodeJS.ProcessEnv): string {
  if (env.npm_execpath) {
    const fromEnvironment = npmPathFromExecutable(env.npm_execpath);
    if (fromEnvironment) return fromEnvironment;
  }

  const executableDirectory = path.dirname(process.execPath);
  const candidates =
    process.platform === "win32"
      ? [path.join(executableDirectory, "node_modules", "npm")]
      : [path.resolve(executableDirectory, "..", "lib", "node_modules", "npm")];
  const installed = candidates.find((candidate) =>
    existsSync(path.join(candidate, "package.json")),
  );
  if (installed) return installed;

  return path.dirname(createRequire(import.meta.url).resolve("@npmcli/config/package.json"));
}

export async function loadNpmConfiguration(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NpmFetchOptions> {
  try {
    const config = new NpmConfig({
      argv: [],
      cwd: root,
      definitions: npmConfigDefinitions.definitions,
      env,
      flatten: npmConfigDefinitions.flatten,
      npmPath: resolveNpmPath(env),
      shorthands: npmConfigDefinitions.shorthands,
    });
    await config.load();
    if (!config.validate()) throw new Error("Invalid npm configuration");
    return { ...config.flat };
  } catch {
    throw new Error("Unable to load or validate npm configuration.");
  }
}

export function sanitizeRegistryError(error: unknown): string {
  const value =
    error && typeof error === "object" ? (error as { code?: unknown; statusCode?: unknown }) : {};
  if (value.statusCode === 404) return "package was not found in the selected registry";
  if (value.statusCode === 401 || value.statusCode === 403) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPackument(value: unknown): value is Packument {
  return isRecord(value) && isRecord(value["dist-tags"]) && isRecord(value.versions);
}

export async function fetchPackuments(
  packageNames: string[],
  configuration: NpmFetchOptions,
  fetchJson: typeof npmRegistryFetch.json = npmRegistryFetch.json.bind(npmRegistryFetch),
): Promise<PackumentResults> {
  const names = [...new Set(packageNames)].sort((left, right) => left.localeCompare(right));
  const packuments = new Map<string, Packument>();
  const failures = new Map<string, string>();
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < names.length) {
      const packageName = names[nextIndex];
      nextIndex += 1;
      const spec = npmPackageArg(packageName);
      try {
        const result = await fetchJson(`/${spec.escapedName}`, {
          ...configuration,
          headers: {
            ...configuration.headers,
            accept: ABBREVIATED_PACKUMENT,
          },
          offline: false,
          preferOffline: false,
          preferOnline: true,
          spec,
        });
        if (!isPackument(result)) {
          failures.set(packageName, "registry returned malformed package metadata");
        } else {
          packuments.set(packageName, result as Packument);
        }
      } catch (error) {
        failures.set(packageName, sanitizeRegistryError(error));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, names.length) }, worker));
  return { packuments, failures };
}
