// Test-owned preliminary 0.4 archive projection; no final graph or product ranges change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const preliminaryNames = [
  "@askrjs/askr",
  "@askrjs/auth",
  "@askrjs/charts",
  "@askrjs/cli",
  "@askrjs/i18n",
  "@askrjs/lucide",
  "@askrjs/node",
  "@askrjs/otel",
  "@askrjs/schema",
  "@askrjs/server",
  "@askrjs/themes",
  "@askrjs/ui",
  "@askrjs/vite",
];
export interface PreliminaryArchive {
  name: string;
  version: string;
  sourceCommit: string;
  sourceTree: string;
  archive: string;
  archiveSha512: string;
  packageJsonSha256: string;
  files: { path: string; sha256: string }[];
}
export interface PreliminaryClosure {
  schemaVersion: number;
  boundary: string;
  toolchain: { node: string; npm: string };
  packages: PreliminaryArchive[];
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function validatePreliminaryClosure(
  closure: PreliminaryClosure,
  cliSource: { commit: string; tree: string },
) {
  assert.equal(closure.schemaVersion, 1);
  // Reuse the reviewed origin-v6 preliminary schema, never M18/final18.
  assert.equal(closure.boundary, "CLI_PROVIDER_ORIGIN_PRELIMINARY_NORMAL_ARCHIVES");
  assert.deepEqual(closure.toolchain, { node: "24.21.0", npm: "12.0.1" });
  assert.deepEqual(
    closure.packages.map((value) => value.name).sort(),
    [...preliminaryNames].sort(),
  );
  assert.match(cliSource.commit, /^[a-f0-9]{40}$/);
  assert.match(cliSource.tree, /^[a-f0-9]{40}$/);
  for (const value of closure.packages) {
    assert.match(value.sourceCommit, /^[a-f0-9]{40}$/);
    assert.match(value.sourceTree, /^[a-f0-9]{40}$/);
    assert.match(value.version, /^0\.4\.\d+$/);
    assert.match(value.packageJsonSha256, /^[a-f0-9]{64}$/);
    assert.match(value.archiveSha512, /^[a-f0-9]{128}$/);
    assert.ok(path.isAbsolute(value.archive));
    assert.ok(
      value.files.length > 0 &&
        value.files.length <= (value.name === "@askrjs/lucide" ? 16384 : 2048),
    );
    assert.equal(new Set(value.files.map((file) => file.path)).size, value.files.length);
    assert.equal(
      value.files.find((file) => file.path === "package.json")?.sha256,
      value.packageJsonSha256,
    );
    for (const file of value.files) {
      assert.ok(!path.isAbsolute(file.path) && !file.path.includes("\\"));
      assert.ok(!file.path.split("/").some((part) => part === ".." || part === "." || part === ""));
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
    if (value.name === "@askrjs/cli") {
      assert.equal(value.sourceCommit, cliSource.commit);
      assert.equal(value.sourceTree, cliSource.tree);
    }
  }
}
export async function readPreliminaryClosure(input: {
  file: string;
  sha256: string;
  cliSource: { commit: string; tree: string };
}): Promise<PreliminaryClosure> {
  assert.ok(path.isAbsolute(input.file));
  assert.match(input.sha256, /^[a-f0-9]{64}$/);
  const stat = await fs.lstat(input.file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024);
  const raw = await fs.readFile(input.file);
  assert.equal(sha256(raw), input.sha256);
  const closure = JSON.parse(raw.toString("utf8")) as PreliminaryClosure;
  validatePreliminaryClosure(closure, input.cliSource);
  for (const value of closure.packages) {
    const info = await fs.lstat(value.archive);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 32 * 1024 * 1024);
    assert.equal(
      createHash("sha512")
        .update(await fs.readFile(value.archive))
        .digest("hex"),
      value.archiveSha512,
    );
  }
  return closure;
}
export function projectPreliminaryManifest(
  original: Record<string, unknown>,
  packages: PreliminaryArchive[],
) {
  const manifest = structuredClone(original) as Record<string, Record<string, string>>;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith("@askrjs/")) continue;
      const candidate = packages.find((value) => value.name === name);
      assert.ok(candidate, `Unregistered emitted dependency: ${name}`);
      manifest[field]![name] = pathToFileURL(candidate.archive).href;
    }
  }
  // Finite explicit root peer/fixture closure; third-party specs stay byte-for-value exact.
  manifest.devDependencies ??= {};
  for (const candidate of packages) {
    if (!(candidate.name in (manifest.dependencies ?? {})))
      manifest.devDependencies[candidate.name] = pathToFileURL(candidate.archive).href;
  }
  return manifest;
}
export async function bindPreliminaryManifest(project: string, packages: PreliminaryArchive[]) {
  const file = path.join(project, "package.json");
  const manifest = projectPreliminaryManifest(
    JSON.parse(await fs.readFile(file, "utf8")),
    packages,
  );
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
export async function verifyPreliminaryGraph(project: string, packages: PreliminaryArchive[]) {
  const lock = JSON.parse(await fs.readFile(path.join(project, "package-lock.json"), "utf8")) as {
    lockfileVersion: number;
    packages: Record<
      string,
      { version?: string; integrity?: string; resolved?: string; link?: boolean }
    >;
  };
  assert.equal(lock.lockfileVersion, 3);
  const found = new Set<string>();
  const keys = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const match = /(?:^|\/)node_modules\/(@askrjs\/[^/]+)$/.exec(key);
    if (!match) continue;
    assert.ok(!path.isAbsolute(key) && !key.includes("\\") && !key.split("/").includes(".."));
    const name = match[1]!;
    const candidate = packages.find((value) => value.name === name);
    assert.ok(candidate, `Unregistered Askr lock owner: ${key}`);
    assert.notEqual(entry.link, true);
    assert.equal(entry.version, candidate.version);
    assert.ok(entry.resolved?.startsWith("file:"));
    assert.equal(
      await fs.realpath(fileURLToPath(new URL(entry.resolved, pathToFileURL(project + path.sep)))),
      await fs.realpath(candidate.archive),
    );
    assert.equal(
      entry.integrity,
      `sha512-${Buffer.from(candidate.archiveSha512, "hex").toString("base64")}`,
    );
    const installed = path.join(project, key);
    const info = await fs.lstat(installed);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    const actual: string[] = [];
    async function visit(directory: string, prefix = "") {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (!prefix && item.name === "node_modules") continue;
        const relative = prefix ? `${prefix}/${item.name}` : item.name;
        assert.ok(!item.isSymbolicLink());
        if (item.isDirectory()) await visit(path.join(directory, item.name), relative);
        else {
          assert.ok(item.isFile());
          actual.push(relative);
        }
      }
    }
    await visit(installed);
    assert.deepEqual(actual.sort(), candidate.files.map((file) => file.path).sort());
    for (const file of candidate.files)
      assert.equal(
        sha256(await fs.readFile(path.join(installed, file.path))),
        file.sha256,
        `${key}/${file.path}`,
      );
    const manifest = JSON.parse(await fs.readFile(path.join(installed, "package.json"), "utf8"));
    assert.equal(manifest.name, candidate.name);
    assert.equal(manifest.version, candidate.version);
    found.add(name);
    keys.add(key);
  }
  assert.deepEqual([...found].sort(), packages.map((value) => value.name).sort());
  const physical = new Set<string>();
  async function nodeModules(directory: string) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".")) continue;
      const locations =
        item.name.startsWith("@") && item.isDirectory()
          ? (await fs.readdir(path.join(directory, item.name))).map((name) =>
              path.join(directory, item.name, name),
            )
          : [path.join(directory, item.name)];
      for (const location of locations) {
        const info = await fs.lstat(location);
        const key = path.relative(project, location).split(path.sep).join("/");
        if (/(?:^|\/)node_modules\/@askrjs\/[^/]+$/.test(key)) {
          assert.ok(info.isDirectory() && !info.isSymbolicLink());
          physical.add(key);
        }
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const nested = path.join(location, "node_modules");
        try {
          await fs.access(nested);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        await nodeModules(nested);
      }
    }
  }
  await nodeModules(path.join(project, "node_modules"));
  assert.deepEqual(
    [...physical].sort(),
    [...keys].sort(),
    "Physical Askr owners must match every lock depth",
  );
}
export function assertSamePreliminarySiblings(
  before: PreliminaryClosure,
  after: PreliminaryClosure,
) {
  assert.deepEqual(after.toolchain, before.toolchain);
  const siblings = (closure: PreliminaryClosure) =>
    closure.packages
      .filter((value) => value.name !== "@askrjs/cli")
      .sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(
    siblings(after),
    siblings(before),
    "All twelve sibling archives/proofs stay exact across hosting RED/GREEN",
  );
  const cli = (closure: PreliminaryClosure) =>
    closure.packages.find((value) => value.name === "@askrjs/cli")!;
  assert.notEqual(cli(after).sourceTree, cli(before).sourceTree);
  assert.notEqual(cli(after).archiveSha512, cli(before).archiveSha512);
}
export async function readHostingRequest(file: string, digest: string) {
  assert.ok(path.isAbsolute(file));
  assert.match(digest, /^[a-f0-9]{64}$/);
  const info = await fs.lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024);
  const raw = await fs.readFile(file);
  assert.equal(sha256(raw), digest);
  const request = JSON.parse(raw.toString("utf8")) as {
    schemaVersion: number;
    stage: "red" | "green";
    normalArchivesIndependentlyAdmitted: boolean;
    independentReviewSha256: string;
    finalGraphAccepted: boolean;
    closure: { file: string; sha256: string; cliSource: { commit: string; tree: string } };
    previousClosure: null | {
      file: string;
      sha256: string;
      cliSource: { commit: string; tree: string };
    };
  };
  assert.equal(request.schemaVersion, 1);
  assert.ok(request.stage === "red" || request.stage === "green");
  assert.equal(request.normalArchivesIndependentlyAdmitted, true);
  assert.match(request.independentReviewSha256, /^[a-f0-9]{64}$/);
  assert.equal(request.finalGraphAccepted, false);
  const closure = await readPreliminaryClosure(request.closure);
  if (request.stage === "red") assert.equal(request.previousClosure, null);
  else {
    assert.ok(request.previousClosure);
    assertSamePreliminarySiblings(await readPreliminaryClosure(request.previousClosure), closure);
  }
  return { request, closure, raw };
}
export async function verifyEmittedSource(working: string, emitted: string) {
  async function visit(directory: string, prefix = "") {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink());
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await visit(path.join(directory, item.name), relative);
      else {
        assert.ok(item.isFile());
        if (relative !== "package.json")
          assert.equal(
            sha256(await fs.readFile(path.join(working, relative))),
            sha256(await fs.readFile(path.join(emitted, relative))),
            relative,
          );
      }
    }
  }
  await visit(emitted);
}
