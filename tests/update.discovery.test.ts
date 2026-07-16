import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { discoverProject } from "../src/update/discovery";

const temporaryRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-update-discovery-"));
  temporaryRoots.push(root);
  return root;
}

async function writeManifest(directory: string, manifest: Record<string, unknown>): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("update project discovery", () => {
  test("should find the containing workspace root given a nested working directory when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, { name: "root", workspaces: ["packages/*"] });
    await writeManifest(path.join(root, "packages", "app"), { name: "app" });
    const nested = path.join(root, "packages", "app", "src", "pages");
    await fs.mkdir(nested, { recursive: true });

    const project = await discoverProject({
      cwd: nested,
      packagePatterns: [],
      workspacePatterns: [],
    });

    expect(project.root).toBe(root);
    expect(project.workspaces.map((workspace) => workspace.name)).toEqual(["root", "app"]);
  });

  test("should include only declared workspaces given sibling packages and node_modules when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, { name: "root", workspaces: ["packages/app"] });
    await writeManifest(path.join(root, "packages", "app"), { name: "app" });
    await writeManifest(path.join(root, "packages", "undeclared"), { name: "undeclared" });
    await writeManifest(path.join(root, "node_modules", "fixture"), { name: "fixture" });

    const project = await discoverProject({
      cwd: root,
      packagePatterns: [],
      workspacePatterns: [],
    });

    expect(project.workspaces.map((workspace) => workspace.name)).toEqual(["root", "app"]);
  });

  test("should discover pnpm package globs given a pnpm workspace file when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, { name: "root" });
    await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeManifest(path.join(root, "apps", "web"), { name: "web" });

    const project = await discoverProject({
      cwd: path.join(root, "apps", "web"),
      packagePatterns: [],
      workspacePatterns: [],
    });

    expect(project.workspaces.map((workspace) => workspace.name)).toEqual(["root", "web"]);
  });

  test("should reject duplicate workspace names given two declared manifests when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, { name: "root", workspaces: ["packages/*"] });
    await writeManifest(path.join(root, "packages", "a"), { name: "duplicate" });
    await writeManifest(path.join(root, "packages", "b"), { name: "duplicate" });

    await expect(
      discoverProject({ cwd: root, packagePatterns: [], workspacePatterns: [] }),
    ).rejects.toThrow(/multiple workspaces with the same name/i);
  });

  test("should classify workspace and local protocols as local given local declarations when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, {
      name: "root",
      workspaces: ["packages/*"],
      dependencies: {
        "local-package": "^1.0.0",
        "workspace-protocol": "workspace:*",
        "file-protocol": "file:../fixture",
        "link-protocol": "link:../fixture",
      },
    });
    await writeManifest(path.join(root, "packages", "local"), { name: "local-package" });

    const project = await discoverProject({
      cwd: root,
      packagePatterns: [],
      workspacePatterns: ["root"],
    });

    expect(project.occurrences.map((entry) => [entry.package, entry.kind])).toEqual([
      ["file-protocol", "local"],
      ["link-protocol", "local"],
      ["local-package", "local"],
      ["workspace-protocol", "local"],
    ]);
  });

  test("should let explicit package selection bypass ignores given matching policy when discovering", async () => {
    const root = await tempRoot();
    await writeManifest(root, {
      name: "root",
      dependencies: { typescript: "^6.0.0", vite: "^7.0.0" },
      askr: { update: { ignore: ["typescript"] } },
    });

    const ignored = await discoverProject({
      cwd: root,
      packagePatterns: [],
      workspacePatterns: [],
    });
    const explicit = await discoverProject({
      cwd: root,
      packagePatterns: ["type*"],
      workspacePatterns: [],
    });

    expect(ignored.occurrences.map((entry) => entry.package)).toEqual(["vite"]);
    expect(explicit.occurrences.map((entry) => entry.package)).toEqual(["typescript"]);
  });
});
