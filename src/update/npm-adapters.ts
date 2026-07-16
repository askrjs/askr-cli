import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface NpmPackageSpec {
  escapedName: string;
  name?: string;
  rawSpec: string;
  type: string;
}

interface NpmPackageArg {
  (specification: string): NpmPackageSpec;
  resolve(name: string, specification: string, where?: string): NpmPackageSpec;
}

interface MapWorkspaces {
  (options: {
    cwd: string;
    pkg: { workspaces: string[] };
    ignore?: string[];
  }): Promise<Map<string, string>>;
}

export interface NpmFetchOptions extends Record<string, unknown> {
  headers?: Record<string, string>;
  spec?: NpmPackageSpec;
}

interface NpmRegistryFetch {
  json(uri: string, options: NpmFetchOptions): Promise<unknown>;
}

export const npmPackageArg = require("npm-package-arg") as NpmPackageArg;
export const mapDeclaredWorkspaces = require("@npmcli/map-workspaces") as MapWorkspaces;
export const npmRegistryFetch = require("npm-registry-fetch") as NpmRegistryFetch;

interface NpmConfigInstance {
  flat: NpmFetchOptions;
  load(): Promise<void>;
  validate(): boolean;
}

interface NpmConfigConstructor {
  new (options: {
    argv: string[];
    cwd: string;
    definitions: Record<string, unknown>;
    env: NodeJS.ProcessEnv;
    flatten(source: Record<string, unknown>, destination: Record<string, unknown>): unknown;
    npmPath: string;
    shorthands: Record<string, string[]>;
  }): NpmConfigInstance;
}

export const NpmConfig = require("@npmcli/config") as NpmConfigConstructor;
export const npmConfigDefinitions = require("@npmcli/config/lib/definitions") as {
  definitions: Record<string, unknown>;
  flatten(source: Record<string, unknown>, destination: Record<string, unknown>): unknown;
  shorthands: Record<string, string[]>;
};
