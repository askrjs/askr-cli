import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCli } from "../src/bin/cli";
import { runOutdatedCli, runUpdateCli, runUpgradeCli } from "../src/bin/update";
import type { Packument } from "../src/update/types";
import { writeManifestEdits } from "../src/update/writer";

const temporaryRoots: string[] = [];

async function tempRoot(manifest: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-update-cli-"));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "package.json"), manifest);
  return root;
}

function ioCapture(): { io: Pick<Console, "error" | "log">; errors: string[]; logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    errors,
    logs,
    io: {
      error: (...values: unknown[]) => errors.push(values.join(" ")),
      log: (...values: unknown[]) => logs.push(values.join(" ")),
    },
  };
}

function registry(packuments: Record<string, Packument>) {
  return async (_root: string, names: string[]) => ({
    packuments: new Map(
      names.flatMap((name) => (packuments[name] ? [[name, packuments[name]] as const] : [])),
    ),
    failures: new Map(
      names.flatMap((name) =>
        packuments[name] ? [] : [[name, "package was not found in the selected registry"] as const],
      ),
    ),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("update CLI", () => {
  test("should leave a manifest byte-for-byte unchanged given a dry run when an update exists", async () => {
    const source = '{\r\n\t"name": "fixture",\r\n\t"dependencies": { "foo": "~1.0.0" }\r\n}';
    const root = await tempRoot(source);
    const capture = ioCapture();

    const code = await runOutdatedCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "1.8.0" },
          versions: { "1.0.0": {}, "1.8.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toBe(source);
    expect(capture.logs.join("\n")).toContain("safe");
  });

  test("should report one row given identical dependency occurrences across sections when outdated", async () => {
    const root = await tempRoot(
      '{"name":"fixture","dependencies":{"foo":"^1.0.0"},"devDependencies":{"foo":"^1.0.0"}}\n',
    );
    const capture = ioCapture();

    const code = await runOutdatedCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "2.0.0" },
          versions: { "1.0.0": {}, "2.0.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(capture.logs.filter((line) => line.startsWith("foo "))).toHaveLength(1);
    expect(capture.logs.join("\n")).toContain("Scanned 1 package");
  });

  test("should apply a compatible edit given upgrade when an update exists", async () => {
    const root = await tempRoot(
      '{\n  "name": "fixture",\n  "dependencies": { "foo": "~1.0.0" }\n}\n',
    );
    const capture = ioCapture();

    const code = await runUpdateCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "1.8.0" },
          versions: { "1.0.0": {}, "1.8.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toContain('"foo": "~1.8.0"');
  });

  test("should skip a breaking edit given upgrade without force when an update exists", async () => {
    const source = '{\n  "name": "fixture",\n  "dependencies": { "foo": "^1.0.0" }\n}\n';
    const root = await tempRoot(source);
    const capture = ioCapture();

    const code = await runUpdateCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "2.0.0" },
          versions: { "1.9.0": {}, "2.0.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toBe(source);
    expect(capture.logs.join("\n")).toContain("available via askr upgrade");
  });

  test("should apply a breaking edit given upgrade when peer dependencies allow it", async () => {
    const root = await tempRoot(
      '{\n  "name": "fixture",\n  "dependencies": { "foo": "^1.0.0" }\n}\n',
    );
    const capture = ioCapture();

    const code = await runUpgradeCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "2.0.0" },
          versions: { "1.9.0": {}, "2.0.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toContain('"foo": "^2.0.0"');
  });

  test("should preserve a selected dependency given an ignored co-dependency rejects its target when upgrading", async () => {
    const source = `${JSON.stringify(
      {
        name: "fixture",
        dependencies: { typescript: "^6.0.0", "vite-plus": "^0.1.0" },
        askr: { update: { ignore: ["vite-plus"] } },
      },
      null,
      2,
    )}\n`;
    const root = await tempRoot(source);
    const capture = ioCapture();

    const code = await runUpgradeCli(["--cwd", root, "typescript"], capture.io, {
      registry: registry({
        typescript: {
          "dist-tags": { latest: "7.0.0" },
          versions: { "6.9.0": {}, "7.0.0": {} },
        },
        "vite-plus": {
          "dist-tags": { latest: "0.1.2" },
          versions: {
            "0.1.2": { peerDependencies: { typescript: "^6.0.0" } },
          },
        },
      }),
    });

    expect(code).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toBe(source);
    expect(capture.logs.join("\n")).toContain("vite-plus@0.1.2 requires typescript@^6.0.0");
  });

  test("should perform no writes given one successful lookup and one registry failure when upgrading", async () => {
    const source = `${JSON.stringify(
      {
        name: "fixture",
        dependencies: { bar: "~1.0.0", foo: "~1.0.0" },
      },
      null,
      2,
    )}\n`;
    const root = await tempRoot(source);
    const capture = ioCapture();

    const code = await runUpdateCli(["--cwd", root], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "1.8.0" },
          versions: { "1.0.0": {}, "1.8.0": {} },
        },
      }),
    });

    expect(code).toBe(1);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toBe(source);
    expect(capture.errors.join("\n")).not.toMatch(/token|authorization|https?:\/\//i);
  });

  test("should reject legacy mutation flags given command names own behavior when parsing arguments", async () => {
    const capture = ioCapture();

    const code = await runUpdateCli(["--json", "-u"], capture.io);

    expect(code).toBe(1);
    expect(capture.logs).toHaveLength(1);
    expect(JSON.parse(capture.logs[0])).toMatchObject({ root: null, decisions: [] });
  });

  test("should accept force only for upgrade and bypass peer conflicts", async () => {
    const root = await tempRoot(
      '{"name":"fixture","dependencies":{"provider":"^1.0.0","peer":"^1.0.0"}}\n',
    );
    const packages = {
      provider: {
        "dist-tags": { latest: "2.0.0" },
        versions: {
          "1.0.0": { version: "1.0.0" },
          "2.0.0": { version: "2.0.0", peerDependencies: { peer: "^2" } },
        },
      },
      peer: { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { version: "1.0.0" } } },
    };
    const forced = ioCapture();
    expect(
      await runUpgradeCli(["--cwd", root, "provider", "-f", "--json"], forced.io, {
        registry: registry(packages),
      }),
    ).toBe(0);
    expect(await fs.readFile(path.join(root, "package.json"), "utf8")).toContain(
      '"provider":"^2.0.0"',
    );
    expect(JSON.parse(forced.logs[0]).decisions[0].occurrences[0]).toMatchObject({
      selectedVersion: "2.0.0",
    });

    const rejected = ioCapture();
    expect(await runUpdateCli(["--force", "--json"], rejected.io)).toBe(1);
    expect(rejected.errors.join("\n")).toContain("only supported by askr upgrade");
    const outdated = ioCapture();
    expect(await runOutdatedCli(["-f", "--json"], outdated.io)).toBe(1);
  });

  test("should reserve stdout for one object given JSON output when scanning", async () => {
    const root = await tempRoot('{"name":"fixture","dependencies":{"foo":"^1.0.0"}}\n');
    const capture = ioCapture();

    const code = await runUpdateCli(["--cwd", root, "--json"], capture.io, {
      registry: registry({
        foo: {
          "dist-tags": { latest: "1.1.0" },
          versions: { "1.0.0": {}, "1.1.0": {} },
        },
      }),
    });

    expect(code).toBe(0);
    expect(capture.logs).toHaveLength(1);
    expect(JSON.parse(capture.logs[0])).toMatchObject({
      root,
      workspaces: [{ name: "fixture", path: ".", manifest: "package.json" }],
      summary: { packages: 1, safe: 0, current: 1 },
      errors: [],
    });
  });

  test("should roll back replaced manifests given a later replacement failure when writing", async () => {
    const root = await tempRoot('{"name":"root","dependencies":{"foo":"1.0.0"}}\n');
    const nested = path.join(root, "nested");
    await fs.mkdir(nested);
    const nestedPath = path.join(nested, "package.json");
    await fs.writeFile(nestedPath, '{"name":"nested","dependencies":{"bar":"1.0.0"}}\n');
    const rootPath = path.join(root, "package.json");
    const beforeRoot = await fs.readFile(rootPath, "utf8");
    const beforeNested = await fs.readFile(nestedPath, "utf8");
    let replacements = 0;

    await expect(
      writeManifestEdits(
        [
          {
            manifestPath: rootPath,
            section: "dependencies",
            package: "foo",
            currentSpecification: "1.0.0",
            proposedSpecification: "1.1.0",
          },
          {
            manifestPath: nestedPath,
            section: "dependencies",
            package: "bar",
            currentSpecification: "1.0.0",
            proposedSpecification: "1.1.0",
          },
        ],
        {
          replace: async (temporaryPath, manifestPath) => {
            replacements += 1;
            if (replacements === 2) throw new Error("simulated replacement failure");
            await fs.rename(temporaryPath, manifestPath);
          },
        },
      ),
    ).rejects.toThrow(/rolled back/);

    expect(await fs.readFile(rootPath, "utf8")).toBe(beforeRoot);
    expect(await fs.readFile(nestedPath, "utf8")).toBe(beforeNested);
  });

  test("should preserve manifest formatting given escaped keys and multiple edits when writing", async () => {
    const source =
      '{\r\n\t"dependencies": {\r\n\t\t"\\u0040scope/foo": "1.0.0",\r\n\t\t"bar": "~2.0.0"\r\n\t}\r\n}\r\n';
    const root = await tempRoot(source);
    const manifestPath = path.join(root, "package.json");

    await writeManifestEdits([
      {
        manifestPath,
        section: "dependencies",
        package: "@scope/foo",
        currentSpecification: "1.0.0",
        proposedSpecification: "1.1.0",
      },
      {
        manifestPath,
        section: "dependencies",
        package: "bar",
        currentSpecification: "~2.0.0",
        proposedSpecification: "~2.1.0",
      },
    ]);

    expect(await fs.readFile(manifestPath, "utf8")).toBe(
      source.replace('"1.0.0"', '"1.1.0"').replace('"~2.0.0"', '"~2.1.0"'),
    );
  });

  test("should expose update help given top-level CLI help when dispatching", async () => {
    const capture = ioCapture();

    expect(await runCli(["--help"], capture.io)).toBe(0);
    expect(capture.logs.join("\n")).toMatch(/outdated\s+List available dependency/);
    expect(capture.logs.join("\n")).toMatch(/update\s+Apply safe dependency/);
    expect(capture.logs.join("\n")).toMatch(/upgrade\s+Apply latest peer-compatible/);
  });

  test("should keep the shipped runtime dependency surface narrow when inspecting", async () => {
    const manifest = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      engines: { node: string };
    };
    const config = await fs.readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
    const sources = await Promise.all([
      fs.readFile(new URL("../src/bin/update.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("../src/update/planner.ts", import.meta.url), "utf8"),
    ]);
    const forbiddenPackage = ["npm", "check", "updates"].join("-");
    const forbiddenAlias = ["n", "c", "u"].join("");

    expect(manifest.engines.node).toBe("^20.19.0 || >=22.12.0");
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "js-yaml",
      "minimatch",
      "semver",
      "tsx",
    ]);
    expect(JSON.stringify(manifest)).not.toContain(forbiddenPackage);
    expect(JSON.stringify(manifest)).not.toContain(forbiddenAlias);
    expect(sources.join("\n")).not.toContain(forbiddenPackage);
    expect(sources.join("\n")).not.toContain(forbiddenAlias);
    expect(config).toMatch(/update: "src\/bin\/update\.ts"/);
  });

  test("should load command implementations lazily given the top-level CLI when inspecting source", async () => {
    const source = await fs.readFile(new URL("../src/bin/cli.ts", import.meta.url), "utf8");

    expect(source).toContain('await import("./update")');
    expect(source).not.toMatch(
      /^import .* from "\.\/(?:add|create|generate|openapi|skills|ssg|update)";/m,
    );
  });
});
