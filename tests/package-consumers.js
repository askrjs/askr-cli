import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { readPackRecord } from "./pack-result.js";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm.");
const root = process.cwd();
const npm = (args, options) => execFileSync(process.execPath, [npmCli, ...args], options);
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const contract = JSON.parse(await readFile("tests/public-contract.json", "utf8"));
const directory = await mkdtemp(join(tmpdir(), "askr-cli-contract-"));
try {
  const packed = readPackRecord(
    JSON.parse(
      npm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
        encoding: "utf8",
      }),
    ),
  );
  assert.ok(packed.files.some((file) => file.path === "CHANGELOG.md"));
  assert.ok(packed.files.some((file) => file.path === "docs/0.5.0-api.md"));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      join(directory, packed.filename),
      `@askrjs/askr@${manifest.devDependencies["@askrjs/askr"]}`,
    ],
    { cwd: directory, stdio: "pipe" },
  );
  const installed = JSON.parse(
    await readFile(join(directory, "node_modules/@askrjs/cli/package.json"), "utf8"),
  );
  assert.deepEqual(installed.exports, manifest.exports);
  assert.deepEqual(Object.keys(installed.exports).sort(), contract.exportKeys);
  const fixture = join(directory, "contract.ts");
  await writeFile(fixture, await readFile("tests/types/public-contract.ts", "utf8"));
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        types: [],
        lib: ["ES2022"],
      },
      files: ["contract.ts"],
    }),
  );
  execFileSync(
    process.execPath,
    [join(root, "node_modules/@typescript/native/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: directory, stdio: "pipe" },
  );
  const program = ts.createProgram([fixture], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    types: [],
    lib: ["lib.es2022.d.ts"],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => directory,
      getNewLine: () => "\n",
    }),
  );
  const checker = program.getTypeChecker();
  const declaration = program
    .getSourceFile(fixture)
    .statements.find(
      (statement) =>
        ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "@askrjs/cli/ssg",
    );
  const names = checker
    .getExportsOfModule(checker.getSymbolAtLocation(declaration.moduleSpecifier))
    .map((symbol) => symbol.name)
    .sort();
  assert.deepEqual(names, contract.entrypoints["@askrjs/cli/ssg"].types);
  await writeFile(
    join(directory, "runtime.js"),
    `
    import assert from 'node:assert/strict';
    assert.deepEqual(Object.keys(await import('@askrjs/cli/ssg')), []);
    assert.equal((await import('@askrjs/cli/package.json', { with: { type: 'json' } })).default.version, ${JSON.stringify(manifest.version)});
    await assert.rejects(import('@askrjs/cli'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    for(const path of ${JSON.stringify(contract.privateSubpaths)}) await assert.rejects(import('@askrjs/cli/' + path), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  `,
  );
  execFileSync(process.execPath, [join(directory, "runtime.js")], {
    cwd: directory,
    stdio: "pipe",
  });
  const cli = join(directory, "node_modules/@askrjs/cli", installed.bin.askr);
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { cwd: directory, encoding: "utf8" }),
    /Unified CLI for the Askr platform/,
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], { cwd: directory, encoding: "utf8" }).trim(),
    manifest.version,
  );
  const native = JSON.parse(
    await readFile(join(root, "node_modules/@typescript/native/package.json"), "utf8"),
  );
  console.log(
    JSON.stringify({
      normalInstall: true,
      declarationNames: names.length,
      removedImports: contract.removed.length,
      privateSubpaths: contract.privateSubpaths.length,
      compilers: [ts.version, native.version],
      installedBinary: ["help", "version"],
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
