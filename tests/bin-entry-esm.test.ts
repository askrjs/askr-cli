import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Vitest and tsx resolve module specifiers more leniently than Node's ES module
// loader (for example, bare directory imports of CommonJS packages). These tests
// build the real CLI bundle and execute it under plain Node, so a specifier that
// only works through a dev-time resolver fails here instead of after publishing.

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const vpBin = path.join(repository, "node_modules", "vite-plus", "bin", "vp");

let outDir = "";
let server: http.Server | undefined;
let registryUrl = "";
const requestedPaths: string[] = [];
const scratchRoots: string[] = [];

function version(name: string, value: string): Record<string, unknown> {
  return {
    name,
    version: value,
    dist: { tarball: `${registryUrl}${name}/-/${name.split("/").pop()}-${value}.tgz` },
  };
}

function packument(name: string, versions: string[], latest: string): Record<string, unknown> {
  return {
    name,
    "dist-tags": { latest },
    versions: Object.fromEntries(versions.map((value) => [value, version(name, value)])),
  };
}

const packuments: Record<string, () => Record<string, unknown>> = {
  "fixture-plain": () => packument("fixture-plain", ["1.0.0", "1.1.0", "2.0.0"], "2.0.0"),
  "@fixture/scoped": () => packument("@fixture/scoped", ["3.0.0", "3.2.0", "4.0.0"], "4.0.0"),
};

function childEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    // Drop inherited npm configuration (npm injects npm_config_* into scripts)
    // and proxies so the child talks only to the local stub registry.
    if (/^npm_config_/i.test(name) || /^(?:https?|all|no)_proxy$/i.test(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    NO_COLOR: "1",
    npm_config_registry: registryUrl,
    npm_config_userconfig: path.join(root, ".user-npmrc"),
    npm_config_globalconfig: path.join(root, ".global-npmrc"),
    npm_config_cache: path.join(root, ".npm-cache"),
    npm_config_fetch_retries: "0",
  };
}

async function fixtureProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-bin-esm-"));
  scratchRoots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "askr-bin-esm-fixture",
        private: true,
        type: "module",
        dependencies: {
          "fixture-plain": "^1.0.0",
          "@fixture/scoped": "^3.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(path.join(root, ".user-npmrc"), "");
  await fs.writeFile(path.join(root, ".global-npmrc"), "");
  return root;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runBuiltCli(args: string[], root: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(outDir, "cli.js"), ...args],
      { cwd: root, env: childEnvironment(root), maxBuffer: 20 * 1024 * 1024 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    if (typeof failure.code !== "number") throw error;
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function manifestDependencies(value: string): Record<string, string> {
  return (JSON.parse(value) as { dependencies: Record<string, string> }).dependencies;
}

beforeAll(async () => {
  // Build inside node_modules so the bundle resolves the repository's real
  // installed dependencies exactly as a consumer's node_modules would.
  outDir = await fs.mkdtemp(path.join(repository, "node_modules", ".cache", "askr-bin-esm-"));
  await execFileAsync(process.execPath, [vpBin, "pack", "--out-dir", outDir], {
    cwd: repository,
    maxBuffer: 20 * 1024 * 1024,
  });

  server = http.createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? "/").slice(1));
    requestedPaths.push(requested);
    const body = packuments[requested];
    if (!body) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body()));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  registryUrl = `http://127.0.0.1:${port}/`;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await Promise.all(
    [...scratchRoots.splice(0), outDir]
      .filter(Boolean)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

describe("built CLI entry points under Node ESM", () => {
  test("should load every built module given plain Node ESM resolution", async () => {
    const modules = (await fs.readdir(outDir))
      .filter((file) => file.endsWith(".js"))
      .map((file) => pathToFileURL(path.join(outDir, file)).href);
    expect(modules).toContain(pathToFileURL(path.join(outDir, "cli.js")).href);

    const script = `for (const url of ${JSON.stringify(modules)}) await import(url);`;
    const { stderr } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: repository, env: { ...process.env, NO_COLOR: "1" } },
    );
    expect(stderr).toBe("");
  }, 60_000);

  test("should report outdated dependencies without writing given the built askr bin", async () => {
    const root = await fixtureProject();
    const before = await fs.readFile(path.join(root, "package.json"), "utf8");

    const result = await runBuiltCli(["outdated", "--json"], root);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      errors: string[];
      decisions: Array<{ package: string; targetVersion: string | null }>;
    };
    expect(report.errors).toEqual([]);
    expect(
      Object.fromEntries(
        report.decisions.map((decision) => [decision.package, decision.targetVersion]),
      ),
    ).toEqual({ "@fixture/scoped": "4.0.0", "fixture-plain": "2.0.0" });
    expect(requestedPaths).toEqual(expect.arrayContaining(["fixture-plain", "@fixture/scoped"]));
    await expect(fs.readFile(path.join(root, "package.json"), "utf8")).resolves.toBe(before);
  }, 60_000);

  test("should apply in-range updates given the built askr bin", async () => {
    const root = await fixtureProject();

    const result = await runBuiltCli(["update"], root);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Updated 2 manifest occurrences.");
    const manifest = await fs.readFile(path.join(root, "package.json"), "utf8");
    expect(manifestDependencies(manifest)).toEqual({
      "fixture-plain": "^1.1.0",
      "@fixture/scoped": "^3.2.0",
    });
  }, 60_000);

  test("should apply latest upgrades given the built askr bin", async () => {
    const root = await fixtureProject();

    const result = await runBuiltCli(["upgrade"], root);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Updated 2 manifest occurrences.");
    const manifest = await fs.readFile(path.join(root, "package.json"), "utf8");
    expect(manifestDependencies(manifest)).toEqual({
      "fixture-plain": "^2.0.0",
      "@fixture/scoped": "^4.0.0",
    });
  }, 60_000);
});
