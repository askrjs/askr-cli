import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, test } from "vite-plus/test";
import {
  digest,
  inventoryGeneratedSource,
  installFreshFinal,
  finalNpmListing,
  loadFinalAdmission,
  ownedEnvironment,
  validateRanges,
  verifyInstalled,
} from "../helpers/final-provider-graph";
import { runOwnedCommand } from "../helpers/owned-command";
import { packedHostingChecks } from "../helpers/packed-hosting";

// Final defaults are a downstream M18 gate. The ordinary producer gate and
// preliminary13 projection retain their own distinct scripts/test selectors.
const templates = ["full-stack", "spa", "ssr", "ssg", "startkit"] as const;
const repository = fileURLToPath(new URL("../../", import.meta.url));
let graph: Awaited<ReturnType<typeof loadFinalAdmission>>;
let root: string, evidence: string, launcher: string, cli: string;
let baseEnv: Record<string, string>;
let serial = 0,
  completed = 0;
async function floor() {
  const info = await fs.statfs(root);
  assert(
    info.bavail * info.bsize >= 8 * 1024 ** 3,
    "Final defaults require the unchanged 8GiB free floor",
  );
}
async function save(name: string, value: unknown, directory = evidence) {
  await fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}
async function command(
  command: string,
  args: string[],
  cwd: string,
  directory: string,
  signal?: AbortSignal,
) {
  await floor();
  return runOwnedCommand({
    command,
    args,
    cwd,
    evidence: directory,
    label: `phase-${++serial}`,
    timeoutMs: 120000,
    signal,
    env: baseEnv,
  });
}
const npm = (args: string[], cwd: string, directory: string, signal?: AbortSignal) =>
  command(process.execPath, [graph.input.tools.npmCli.file, ...args], cwd, directory, signal);

beforeAll(async () => {
  assert.equal(process.version, "v24.21.0");
  assert.equal(
    process.env.ASKR_PROVIDER_PHASE,
    "native",
    "Final five defaults require the explicit native phase on each OS",
  );
  assert.equal(
    process.env.ASKR_TEMPLATE,
    undefined,
    "Final qualification must run all five defaults",
  );
  graph = await loadFinalAdmission(
    process.env.ASKR_FINAL18_ADMISSION,
    process.env.ASKR_FINAL18_ADMISSION_SHA256,
  );
  assert.equal(graph.input.platform, process.platform);
  assert.equal(graph.input.phase, "native");
  assert.equal(
    await fs.realpath(process.env.npm_execpath!),
    await fs.realpath(graph.input.tools.npmCli.file),
  );
  evidence = process.env.ASKR_PROVIDER_EVIDENCE!;
  assert(evidence && path.isAbsolute(evidence));
  await fs.mkdir(evidence, { recursive: false });
  root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-final-defaults-"));
  await floor();
  baseEnv = ownedEnvironment(
    process.env,
    process.platform,
    root,
    process.execPath,
    graph.input.tools.openssl.executable.file,
  );
  for (const name of [
    "HOME",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (baseEnv[name]) await fs.mkdir(baseEnv[name]!, { recursive: true });
  await fs.writeFile(
    baseEnv.OPENSSL_CONF!,
    "[req]\ndistinguished_name=owned_dn\nprompt=no\n[owned_dn]\nCN=Owned default starter fixture\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(root, "owned.npmrc"),
    `registry=https://registry.npmjs.org/\n@askrjs:registry=${graph.input.registry.url}\nignore-scripts=false\n`,
    { flag: "wx" },
  );
  await fs.writeFile(path.join(root, "empty.npmrc"), "", { flag: "wx" });
  launcher = path.join(root, "launcher");
  await fs.mkdir(launcher);
  await fs.writeFile(
    path.join(launcher, "package.json"),
    JSON.stringify({
      name: "owned-final-defaults-launcher",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: { "@askrjs/cli": "0.5.0" },
    }),
    { flag: "wx" },
  );
  assert.equal((await npm(["--version"], launcher, evidence)).trim(), graph.manifest.toolchain.npm);
  assert.equal(
    (await npm(["config", "get", "ignore-scripts"], launcher, evidence)).trim(),
    "false",
  );
  const { initial } = await installFreshFinal(launcher, graph, (args, cwd) =>
    npm(args, cwd, evidence),
  );
  await finalNpmListing(launcher, evidence, graph, (args, cwd) => npm(args, cwd, evidence));
  cli = path.join(launcher, "node_modules", "@askrjs", "cli", "dist", "cli.js");
  await save("authority.json", {
    phase: "native",
    platform: process.platform,
    manifestSha256: digest(graph.manifestRaw),
    admissionFile: process.env.ASKR_FINAL18_ADMISSION,
    admissionSha256: process.env.ASKR_FINAL18_ADMISSION_SHA256,
    launcher: initial.installed,
    root,
    preliminary13: false,
    resolutionProjection: false,
  });
}, 600000);

test.each(templates)(
  "final18 packed CLI default %s preserves generated ranges and hosting",
  async (template) => {
    const out = path.join(evidence, template);
    await fs.mkdir(out);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 170000);
    const directory = path.join(root, template);
    let project = path.join(directory, `fixture-${template}`);
    await fs.mkdir(directory);
    let passed = false;
    let result: unknown;
    try {
      await command(
        process.execPath,
        [
          cli,
          "create",
          template,
          `fixture-${template}`,
          "--dir",
          project,
          "--no-install",
          "--no-skills",
        ],
        directory,
        out,
        controller.signal,
      );
      const manifestRaw = await fs.readFile(path.join(project, "package.json"));
      validateRanges(JSON.parse(manifestRaw.toString()));
      const emitted = await inventoryGeneratedSource(project);
      await fs.cp(project, path.join(out, "emitted-product"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await save(
        "emission.json",
        { manifestSha256: digest(manifestRaw), files: emitted, resolutionProjection: false },
        out,
      );
      const { fresh } = await installFreshFinal(project, graph, (args, cwd) =>
        npm(args, cwd, out, controller.signal),
      );
      await fs.writeFile(path.join(out, "package-lock.json"), fresh.lockRaw, { flag: "wx" });
      await finalNpmListing(project, out, graph, (args, cwd) =>
        npm(args, cwd, out, controller.signal),
      );
      await npm(["audit", "--json"], project, out, controller.signal);
      await npm(["audit", "--omit=dev", "--json"], project, out, controller.signal);
      await npm(["run", "check"], project, out, controller.signal);
      for (const tool of [graph.input.tools.typescript6, graph.input.tools.typescript7]) {
        assert.equal(
          JSON.parse(await fs.readFile(tool.packageJson.file, "utf8")).version,
          tool.version,
        );
        const major = tool === graph.input.tools.typescript6 ? 6 : 7;
        assert.match(
          (
            await command(
              process.execPath,
              [tool.cli.file, "--version"],
              project,
              out,
              controller.signal,
            )
          ).trim(),
          new RegExp(`^Version ${major}\\.`),
        );
        for (const jsx of ["react-jsx", "react-jsxdev"]) {
          await fs.writeFile(
            path.join(project, ".provider-types.json"),
            JSON.stringify({
              extends: "./tsconfig.json",
              compilerOptions: {
                strict: true,
                noEmit: true,
                composite: false,
                jsx,
                jsxImportSource: "@askrjs/askr",
                types: ["node", "vite/client"],
              },
              include: ["src", "server.ts", "vite.config.ts"],
              references: [],
            }),
          );
          await command(
            process.execPath,
            [tool.cli.file, "-p", ".provider-types.json", "--pretty", "false"],
            project,
            out,
            controller.signal,
          );
        }
      }
      await fs.rm(path.join(project, ".provider-types.json"));
      const run = (commandName: string, args: string[], cwd: string) =>
        commandName === "npm"
          ? npm(args, cwd, out, controller.signal)
          : command(commandName, args, cwd, out, controller.signal);
      const { checkBuiltHosting, checkScopedSsgJsx } = packedHostingChecks(run, repository);
      const added =
        template === "ssg"
          ? ["src/scoped-jsx-contract.tsx", "tsconfig.scoped-jsx.json"]
          : template === "ssr" || template === "full-stack"
            ? ["public/hosting-public.txt", "public/hosting-public.css"]
            : [];
      for (const relative of added) {
        try {
          await fs.lstat(path.join(project, relative));
          assert.fail(`Fixture would replace emitted source: ${relative}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        if (template === "ssr" || template === "full-stack") {
          const launchDirectory = path.join(directory, "unrelated cwd #100% ü");
          await fs.mkdir(launchDirectory);
          project = await checkBuiltHosting(project, launchDirectory, (relocated) => {
            project = relocated;
          });
        } else {
          await npm(["run", "build"], project, out, controller.signal);
        }
        if (template === "ssg") {
          await checkScopedSsgJsx(project);
          for (const relative of ["sitemap.xml", "robots.txt", ".askr/sitemap-manifest.json"])
            await fs.access(path.join(project, "dist", relative));
        }
      } finally {
        for (const relative of added) await fs.rm(path.join(project, relative), { force: true });
      }
      assert((await fs.readFile(path.join(project, "package.json"))).equals(manifestRaw));
      assert.deepEqual(await inventoryGeneratedSource(project), emitted);
      assert((await verifyInstalled(project, graph)).lockRaw.equals(fresh.lockRaw));
      result = {
        status: "PASS",
        template,
        installed: fresh.installed,
        manifestSha256: digest(manifestRaw),
        lockSha256: digest(fresh.lockRaw),
        emittedSourceUnchanged: true,
        resolutionProjection: false,
        nativeHosting: ["ssr", "full-stack"].includes(template),
      };
      passed = true;
    } finally {
      clearTimeout(timer);
      await save("case.json", { passed, result: result ?? null, directory, retained: true }, out);
    }
    assert(passed);
    completed++;
  },
  180000,
);

afterAll(async () => {
  if (!evidence) return;
  await save("summary.json", {
    completed,
    expected: 5,
    qualified: completed === 5,
    platform: process.platform,
    final18ManifestSha256: graph ? digest(graph.manifestRaw) : null,
    root,
    preliminary13: false,
    resolutionProjection: false,
  });
  assert.equal(completed, 5);
});
