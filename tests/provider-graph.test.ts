import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  finalParentEnvironment,
  finalWorkerPath,
  validateFinalWorkerEnvironment,
  verifyInstalledNpmAliases,
  prepareFinalWorker,
  resolveFinalJob,
  type FinalJobInput,
} from "./helpers/final-parent-setup";
import { expect, test } from "vite-plus/test";
import {
  finalNames,
  loadFinalAdmission,
  validateAdmission,
  validateManifest,
  validateRanges,
  ownedEnvironment,
  validateParentWitness,
  digest,
  type FinalManifest,
  type FinalAdmission,
  type ParentWitness,
} from "./helpers/final-provider-graph";
import { relayBrowserRequest } from "./helpers/signed-starter-provider";

const h = (length: number) => "a".repeat(length);
function manifest(): FinalManifest {
  return {
    schemaVersion: 1,
    release: "0.5.0",
    complete: true,
    toolchain: { node: "24.21.0", npm: "12.0.1" },
    packages: finalNames.map((name) => ({
      name,
      repo: name === "@askrjs/askr" ? "askrjs/askr" : `askrjs/askr-${name.slice(8)}`,
      commit: h(40),
      tree: h(40),
      packageJsonSha256: h(64),
      lockSha256: h(64),
      archiveSha512: h(128),
    })),
  };
}
function admission(): FinalAdmission {
  const ref = { file: "/owned/proof", sha256: h(64) };
  return {
    schemaVersion: 1,
    boundary: "CLI_PROVIDER_STARTERS_FINAL18",
    approvedForExecution: true,
    platform: "linux",
    phase: "all",
    manifest: ref,
    rootReadback: ref,
    independentReview: ref,
    publicHelperReadback: ref,
    caller: ref,
    helper: { commit: h(40), tree: h(40) },
    registry: { url: "http://127.0.0.1:12345/", id: "12345678-1234-1234-1234-123456789abc" },
    archives: manifest().packages.map((row) => ({
      name: row.name,
      archive: "/owned/archive.tgz",
      archiveSha512: row.archiveSha512,
      packageJsonSha256: row.packageJsonSha256,
      files: [{ path: "package.json", mode: 0o644, sha256: row.packageJsonSha256, size: 1 }],
    })),
    tools: {
      npmCli: ref,
      openssl: { executable: ref, version: "synthetic-model-only" },
      typescript6: { cli: ref, packageJson: ref, version: "6.0.2" },
      typescript7: { cli: ref, packageJson: ref, version: "7.0.2" },
      playwright: {
        packageJson: ref,
        version: "1.63.0",
        browsers: ["chromium", "firefox", "webkit"].map((name) => ({
          name,
          executable: ref,
          rootExecutable: ref,
        })),
      },
    },
  };
}
function parentAdmissionFixture(platform = "linux", extra: Record<string, string> = {}) {
  const m = manifest(),
    a = admission(),
    file = "/owned/admission.json";
  a.platform = platform;
  a.phase = platform === "linux" ? "all" : "native";
  a.manifest = { file: "/owned/manifest.json", sha256: digest(Buffer.from(JSON.stringify(m))) };
  const ambient: Record<string, string> = {
    HOME: "/owned/home",
    VP_HOME: path.join("/owned", "home", "data", "vite-plus"),
    PATH: "/tool:/usr/bin:/bin",
    ASKR_FINAL18_ADMISSION: file,
    ASKR_FINAL18_ADMISSION_SHA256: "",
    ...extra,
  };
  const pairs = Object.entries(ambient).sort(([x], [y]) => x.localeCompare(y));
  const value: ParentWitness = {
    schemaVersion: 1,
    boundary: "REVIEWED_FINAL16_FINITE_PARENT",
    finiteEnvironmentReviewed: true,
    platform: a.platform,
    phase: a.phase,
    manifestSha256: a.manifest.sha256,
    callerCommit: m.packages.find((row) => row.name === "@askrjs/cli")!.commit,
    callerTree: m.packages.find((row) => row.name === "@askrjs/cli")!.tree,
    cwd: "/owned/checkout",
    environmentSha256: digest(
      Buffer.from(
        JSON.stringify(pairs.filter(([name]) => name !== "ASKR_FINAL18_ADMISSION_SHA256")),
      ),
    ),
    environmentKeys: pairs.map(([name]) => name),
    nodeExecutable: { file: "/tool/node", sha256: h(64) },
    terminationTool: platform === "win32" ? { file: "/tool/taskkill.exe", sha256: h(64) } : null,
  };
  // Freeze the witness first, then the admission that pins it, then the actual parent digest.
  a.caller = { file: "/owned/caller.json", sha256: digest(Buffer.from(JSON.stringify(value))) };
  const verifiedAdmission = { file, sha256: digest(Buffer.from(JSON.stringify(a))) };
  ambient.ASKR_FINAL18_ADMISSION_SHA256 = verifiedAdmission.sha256;
  return { m, a, ambient, value, verifiedAdmission };
}
test("missing final admission rejects before any registry request or install", async () => {
  await expect(loadFinalAdmission(undefined, undefined)).rejects.toThrow(
    /Explicit final18 admission/u,
  );
});
test("product child environment has owned paths and no ambient credentials or injectors", () => {
  const env = ownedEnvironment(
    {
      HOME: "/human",
      PATH: "/untrusted",
      GITHUB_TOKEN: "PRIVATE_CANARY",
      ASKR_FOREIGN_AUTHORITY: "PRIVATE_CANARY",
    },
    "linux",
    "/owned",
    "/tool/node",
    "/tool/openssl",
  );
  expect(env.HOME).toBe("/owned/owned-home");
  expect(env.PATH).toBe("/tool:/usr/bin:/bin:/usr/sbin:/sbin");
  expect(env.GITHUB_TOKEN).toBeUndefined();
  expect(env.ASKR_FOREIGN_AUTHORITY).toBeUndefined();
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "HTTPS_PROXY", "BASH_ENV", "ENV", "LD_PRELOAD"])
    expect(() =>
      ownedEnvironment(
        { [name]: "PRIVATE_CANARY" },
        "linux",
        "/owned",
        "/tool/node",
        "/tool/openssl",
      ),
    ).toThrow();
});
test("finite parent witness is mandatory and exact without retaining values", () => {
  const { m, a, ambient, value, verifiedAdmission } = parentAdmissionFixture();
  const validate = (witness = value, env = ambient, cwd = "/owned/checkout") =>
    validateParentWitness(witness, a, m, env, cwd, verifiedAdmission);
  expect(() => validate()).not.toThrow();
  expect(() => validate(value, { ...ambient, GITHUB_TOKEN: "PRIVATE_CANARY" })).toThrow();
  expect(() => validate(value, { ...ambient, PATH: "/foreign" })).toThrow();
  const foreign = parentAdmissionFixture("linux", { VP_HOME: "/foreign" });
  expect(() =>
    validateParentWitness(
      foreign.value,
      foreign.a,
      foreign.m,
      foreign.ambient,
      "/owned/checkout",
      foreign.verifiedAdmission,
    ),
  ).toThrow();
  expect(() => validate(value, ambient, "/foreign")).toThrow();
  expect(() => validate({ ...value, finiteEnvironmentReviewed: false })).toThrow();
});
test("a pinned witness can precede its admission without hashing its own admission digest", () => {
  const { m, a, ambient, value, verifiedAdmission } = parentAdmissionFixture();
  expect(a.caller.sha256).toBe(digest(Buffer.from(JSON.stringify(value))));
  expect(verifiedAdmission.sha256).toBe(digest(Buffer.from(JSON.stringify(a))));
  expect(value.environmentKeys).toContain("ASKR_FINAL18_ADMISSION_SHA256");
  const validate = (witness = value, env = ambient, ref = verifiedAdmission) =>
    validateParentWitness(witness, a, m, env, "/owned/checkout", ref);
  expect(() => validate()).not.toThrow();
  expect(() =>
    validate(value, { ...ambient, ASKR_FINAL18_ADMISSION_SHA256: "b".repeat(64) }),
  ).toThrow();
  expect(() =>
    validate(value, { ...ambient, ASKR_FINAL18_ADMISSION: "/foreign/admission.json" }),
  ).toThrow();
  expect(() =>
    validate(value, ambient, { ...verifiedAdmission, sha256: "b".repeat(64) }),
  ).toThrow();
  expect(() => validate(value, { ...ambient, HOME: "/foreign" })).toThrow();
  expect(() => validate({ ...value, environmentSha256: "b".repeat(64) })).toThrow();
  expect(() =>
    validate({
      ...value,
      environmentKeys: value.environmentKeys.filter(
        (name) => name !== "ASKR_FINAL18_ADMISSION_SHA256",
      ),
    }),
  ).toThrow();
  for (const name of ["GITHUB_TOKEN", "HTTPS_PROXY", "UNREVIEWED_PARENT_KEY"])
    expect(() => validate(value, { ...ambient, [name]: "PRIVATE_CANARY" })).toThrow();
});
test("only the exact Darwin UID neutral encoding can enter the finite parent", () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const neutral = `0x${uid.toString(16).toUpperCase()}:0x0:0x0`;
  const validate = (platform: string, encoding: string) => {
    const { m, a, ambient, value, verifiedAdmission } = parentAdmissionFixture(platform, {
      __CF_USER_TEXT_ENCODING: encoding,
    });
    return validateParentWitness(value, a, m, ambient, "/owned/checkout", verifiedAdmission);
  };
  if (process.platform === "darwin") expect(() => validate("darwin", neutral)).not.toThrow();
  else expect(() => validate("darwin", neutral)).toThrow();
  for (const platform of ["linux", "win32"]) expect(() => validate(platform, neutral)).toThrow();
  for (const encoding of [
    `0x${(uid + 1).toString(16).toUpperCase()}:0x0:0x0`,
    `0x${uid.toString(16).toUpperCase()}:0x1:0x0`,
    "ambient-value",
  ])
    expect(() => validate("darwin", encoding)).toThrow();
});
test("browser relay forwards actual allHeaders cookie/origin instead of the filtered headers view", async () => {
  let all = 0,
    filtered = 0;
  const body = Buffer.from("state=sealed");
  const source = {
    url: () => "https://app.example.test/auth/callback/apple",
    method: () => "POST",
    headers: () => {
      filtered++;
      return { "content-type": "application/x-www-form-urlencoded" };
    },
    allHeaders: async () => {
      all++;
      return {
        cookie: "actual-browser-transaction",
        origin: "https://appleid.apple.com",
        "content-type": "application/x-www-form-urlencoded",
      };
    },
    postDataBuffer: () => body,
  };
  const reply = await relayBrowserRequest(source, async (url, request) => {
    expect(url).toBe(source.url());
    expect(request.method).toBe("POST");
    expect(request.headers.cookie).toBe("actual-browser-transaction");
    expect(request.headers.origin).toBe("https://appleid.apple.com");
    expect(request.body).toBe(body);
    return { status: 303, headers: {}, body: Buffer.alloc(0) };
  });
  expect(reply.status).toBe(303);
  expect(all).toBe(1);
  expect(filtered).toBe(0);
});
test.each([false, null, undefined])(
  "unapproved admission %s is rejected",
  (approvedForExecution) => {
    const value = admission();
    Object.assign(value, { approvedForExecution });
    expect(() => validateAdmission(value, manifest())).toThrow();
  },
);
test("preliminary13 and incomplete/future tool graphs cannot become final18", () => {
  for (const alter of [
    (m: FinalManifest) => {
      m.complete = false;
    },
    (m: FinalManifest) => {
      m.packages.length = 13;
    },
    (m: FinalManifest) => {
      m.packages[1] = m.packages[0]!;
    },
    (m: FinalManifest) => {
      m.toolchain.npm = "11.19.0";
    },
    (m: FinalManifest) => {
      m.release = "0.4.2";
    },
    (m: FinalManifest) => {
      m.packages[0]!.commit = "";
    },
  ]) {
    const value = manifest();
    alter(value);
    expect(() => validateManifest(value)).toThrow();
  }
});
test("original final product ranges are checked without a fixture projection", () => {
  expect(() =>
    validateRanges({ dependencies: { "@askrjs/auth": ">=0.5.0 <0.6.0" } }),
  ).not.toThrow();
  for (const range of [">=0.4.0 <0.5.0", "file:/owned/auth.tgz", "latest"]) {
    expect(() => validateRanges({ dependencies: { "@askrjs/auth": range } })).toThrow();
  }
  expect(() => validateRanges({ dependencies: { "@askrjs/unknown": "0.5.0" } })).toThrow();
  expect(() => validateRanges({})).toThrow();
});
test("registry identity, archive hash, owner and path boundaries fail closed", () => {
  const changes: ((a: FinalAdmission) => void)[] = [
    (a) => {
      a.registry.url = "https://registry.npmjs.org/";
    },
    (a) => {
      a.registry.url = "http://127.0.0.1:12345/redirect";
    },
    (a) => {
      a.registry.url = "http://user@127.0.0.1:12345/";
    },
    (a) => {
      a.registry.id = "";
    },
    (a) => {
      a.helper.commit = "";
    },
    (a) => {
      a.archives[0]!.archiveSha512 = "b".repeat(128);
    },
    (a) => {
      a.archives[0]!.files[0]!.path = "../package.json";
    },
    (a) => {
      a.archives[0]!.files[0]!.path = "server\\package.json";
    },
    (a) => {
      a.archives[0]!.files[0]!.mode = 0o777;
    },
    (a) => {
      a.archives[0]!.files[0]!.size = -1;
    },
    (a) => {
      a.tools.typescript7.version = "6.0.2";
    },
    (a) => {
      a.tools.playwright.browsers.length = 2;
    },
  ];
  expect(() => validateAdmission(admission(), manifest())).not.toThrow();
  for (const alter of changes) {
    const value = admission();
    alter(value);
    expect(() => validateAdmission(value, manifest())).toThrow();
  }
});

// Synthetic construction fixtures exercise authority wiring, never qualify product archives.
async function finalJobFixture(probe = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "askr-final-parent-")));
  const source = path.join(root, "source"),
    runner = path.join(root, "runner"),
    bundle = path.join(root, "authority");
  for (const dir of [source, runner, bundle]) await fs.mkdir(dir, { mode: 0o700 });
  const script =
    "vp test run -c vitest.integration.config.ts tests/integration/final-packed-templates.test.ts";
  const project = path.resolve(import.meta.dirname, "..");
  const packageMetadata = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
  expect(packageMetadata.name).toBe("@askrjs/cli");
  expect(packageMetadata.config).toBeUndefined();
  const pkgRaw = Buffer.from(
    JSON.stringify(
      {
        ...packageMetadata,
        version: "0.5.0",
        scripts: { ...packageMetadata.scripts, "test:templates:final": script },
      },
      null,
      2,
    ) + "\n",
  );
  const lockRaw = Buffer.from('{"lockfileVersion":3}\n');
  await fs.writeFile(path.join(source, "package.json"), pkgRaw);
  await fs.writeFile(path.join(source, "package-lock.json"), lockRaw);
  const sourceOwners = ["package.json", "package-lock.json"];
  let npmRef: { file: string; sha256: string } | undefined;
  if (probe) {
    const copies = [
      "scripts/qualification/final-parent.mjs",
      "tests/helpers/final-parent-setup.ts",
      "tests/helpers/final-provider-graph.ts",
      "tests/helpers/preliminary-archives.ts",
      "vitest.integration.config.ts",
    ];
    for (const owner of copies) {
      const target = path.join(source, owner);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(project, owner), target);
    }
    const testOwner = "tests/integration/final-packed-templates.test.ts";
    await fs.mkdir(path.dirname(path.join(source, testOwner)), { recursive: true });
    await fs.writeFile(
      path.join(source, testOwner),
      `import fs from "node:fs/promises"; import path from "node:path"; import { expect, test } from "vite-plus/test";
 test("synthetic final worker construction only", async () => { const input = JSON.parse(await fs.readFile(process.env.ASKR_FINAL18_ADMISSION!, "utf8")); const witness = JSON.parse(await fs.readFile(input.caller.file, "utf8")); expect(witness.finiteEnvironmentReviewed).toBe(true); for (const key of Object.keys(process.env)) expect(/^(GITHUB_|RUNNER_|BOUNDARY_|HTTPS?_PROXY)/u.test(key)).toBe(false); await fs.writeFile(path.join(path.dirname(input.caller.file), "probe-observed.json"), JSON.stringify({ workerConstructed: true, environmentKeys: witness.environmentKeys, finalQualification: false }), {flag: "wx"}); });
`,
    );
    sourceOwners.push(...copies, testOwner);
    await fs.symlink(
      path.join(project, "node_modules"),
      path.join(source, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const npmCli = process.env.npm_execpath;
    if (!npmCli)
      throw new Error("Actual worker probe must run through the admitted normal npm 12 command");
    const npmRoot = path.dirname(path.dirname(await fs.realpath(npmCli)));
    expect(JSON.parse(await fs.readFile(path.join(npmRoot, "package.json"), "utf8")).version).toBe(
      "12.0.1",
    );
    await fs.cp(npmRoot, path.join(bundle, "npm"), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    npmRef = {
      file: "@bundle/npm/bin/npm-cli.js",
      sha256: digest(await fs.readFile(path.join(bundle, "npm/bin/npm-cli.js"))),
    };
  }
  const m = manifest();
  const archives = m.packages.map((row) => {
    const raw = Buffer.from("synthetic-owned-archive:" + row.name);
    row.archiveSha512 = digest(raw, "sha512");
    const packageRaw =
      row.name === "@askrjs/cli"
        ? pkgRaw
        : Buffer.from(JSON.stringify({ name: row.name, version: "0.5.0" }, null, 2) + "\n");
    row.packageJsonSha256 = digest(packageRaw);
    row.lockSha256 = digest(lockRaw);
    return { row, raw, packageRaw };
  });
  const manifestRaw = Buffer.from(JSON.stringify(m, null, 2) + "\n"),
    manifestSha = digest(manifestRaw);
  const registry = path.join(runner, "askr-0.5-candidate-" + manifestSha);
  await fs.mkdir(registry, { mode: 0o700 });
  const catalog: Record<string, unknown> = {},
    proof = [];
  for (const { row, raw, packageRaw } of archives) {
    const short = row.name.slice(8),
      artifactDir = path.join(registry, "artifacts", short),
      sourceDir = path.join(registry, "sources", short);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });
    const artifact = path.join(artifactDir, `askrjs-${short}-0.5.0.tgz`);
    await fs.writeFile(artifact, raw);
    await fs.writeFile(path.join(sourceDir, "package.json"), packageRaw);
    const integrity = "sha512-" + Buffer.from(row.archiveSha512, "hex").toString("base64"),
      shasum = digest(raw, "sha1");
    catalog[row.name] = {
      artifact,
      archiveSha512: row.archiveSha512,
      integrity,
      shasum,
      manifest: {
        ...JSON.parse(packageRaw.toString()),
        dist: {
          tarball: `https://registry.npmjs.org/${row.name}/-/${short}-0.5.0.tgz`,
          integrity,
          shasum,
        },
      },
    };
    proof.push({
      name: row.name,
      builderCommit: row.commit,
      builderTree: row.tree,
      artifact,
      archiveSha512: row.archiveSha512,
      integrity,
      shasum,
    });
  }
  const registryUrl = "http://127.0.0.1:12345/",
    id = "12345678-1234-1234-1234-123456789abc";
  await fs.writeFile(path.join(registry, "manifest.json"), manifestRaw);
  for (const [name, value] of Object.entries({
    "mode.json": { mode: "candidate", registry: registryUrl },
    "server.json": { pid: process.pid, registry: registryUrl, id },
    "catalog.json": catalog,
    "assembly.json": { order: m.packages.map((row) => row.name), proof },
  }))
    await fs.writeFile(path.join(registry, name), JSON.stringify(value));
  await fs.writeFile(path.join(bundle, "manifest.json"), manifestRaw);
  await fs.writeFile(path.join(bundle, "tool"), "synthetic-tool-only");
  const tool = { file: "@bundle/tool", sha256: digest(Buffer.from("synthetic-tool-only")) };
  const inventory = await Promise.all(
    sourceOwners.map(async (owner) => {
      const raw = await fs.readFile(path.join(source, owner));
      return { path: owner, mode: "100644", sha256: digest(raw), size: raw.length };
    }),
  );
  const inventoryRaw = Buffer.from(JSON.stringify(inventory));
  await fs.writeFile(path.join(bundle, "source-files.json"), inventoryRaw);
  const windows =
    process.platform === "win32"
      ? Object.entries(process.env).find(([name]) => /^SystemRoot$/iu.test(name))?.[1]
      : null;
  if (process.platform === "win32" && !windows)
    throw new Error("Windows fixture needs the physical SystemRoot");
  const terminationTool = windows
    ? {
        file: "@system/System32/taskkill.exe",
        sha256: digest(await fs.readFile(path.join(windows, "System32", "taskkill.exe"))),
      }
    : null;
  const base = admission();
  const { caller: _caller, ...withoutCaller } = base;
  const job: FinalJobInput = {
    schemaVersion: 1,
    boundary: "CLI_FINAL18_REVIEWED_JOB_INPUT",
    approvedForExecution: true,
    operation: "defaults",
    runtime: "h20",
    source: {
      root: "@source",
      commit: h(40),
      tree: h(40),
      inventory: { file: "@bundle/source-files.json", sha256: digest(inventoryRaw) },
    },
    ownedRoot: `@runner/askr-final18-defaults-${manifestSha}`,
    nodeExecutable: { file: "@node", sha256: digest(await fs.readFile(process.execPath)) },
    terminationTool,
    systemRoot: windows ?? null,
    admission: {
      ...withoutCaller,
      platform: process.platform,
      phase: "native",
      manifest: { file: "@bundle/manifest.json", sha256: manifestSha },
      rootReadback: { ...tool },
      independentReview: { ...tool },
      publicHelperReadback: { ...tool },
      registry: null,
      archives: m.packages.map((row) => ({
        name: row.name,
        archive: `@registry/artifacts/${row.name.slice(8)}/askrjs-${row.name.slice(8)}-0.5.0.tgz`,
        archiveSha512: row.archiveSha512,
        packageJsonSha256: row.packageJsonSha256,
        files: [
          {
            path: "package.json",
            mode: 0o644,
            sha256: row.packageJsonSha256,
            size: archives.find((item) => item.row.name === row.name)!.packageRaw.length,
          },
        ],
      })),
      tools: {
        npmCli: npmRef ?? { ...tool },
        openssl: { executable: { ...tool }, version: "synthetic-only" },
        typescript6: { cli: { ...tool }, packageJson: { ...tool }, version: "6.0.2" },
        typescript7: { cli: { ...tool }, packageJson: { ...tool }, version: "7.0.2" },
        playwright: { packageJson: { ...tool }, version: "1.63.0", browsers: [] },
      },
    },
  };
  const file = path.join(bundle, "defaults.json");
  async function freeze(value = job) {
    const raw = Buffer.from(JSON.stringify(value));
    await fs.writeFile(file, raw);
    return { file, sha256: digest(raw) };
  }
  const ref = await freeze();
  const resolved = await resolveFinalJob(job, file, runner, source);
  if (!probe) {
    await fs.mkdir(resolved.ownedRoot, { mode: 0o700 });
    for (const name of ["user.npmrc", "global.npmrc", "openssl.cnf"])
      await fs.writeFile(path.join(resolved.ownedRoot, name), "", { flag: "wx", mode: 0o600 });
  }
  const ambient: NodeJS.ProcessEnv = {
    ...finalParentEnvironment(resolved, ref),
    ...(process.platform === "win32"
      ? {}
      : {
          PWD: source,
          SHLVL: "1",
          _: path.join(source, "node_modules", ".bin", "vp"),
        }),
    npm_config_allow_scripts: "",
    npm_config_global_ignore_file: path.join(resolved.ownedRoot, "npm-prefix", "etc", "npmignore"),
    npm_config_init_module: path.join(resolved.ownedRoot, "home", ".npm-init.js"),
    npm_config_noproxy: "",
    JS_RUNTIME_NAME: "node",
    JS_RUNTIME_VERSION: "24.21.0",
    NODE_PACKAGE_MANAGER: "vite-plus",
    VP_VERSION: "0.3.3",
    BASE_URL: "/",
    MODE: "test",
    DEV: "1",
    PROD: "",
    SSR: "1",
    COLOR: "0",
    EDITOR:
      resolved.admission.platform === "win32"
        ? path.join(resolved.systemRoot!, "notepad.exe")
        : "vi",
    npm_config_node_gyp: path.join(
      path.dirname(path.dirname(resolved.admission.tools.npmCli.file)),
      "node_modules",
      "node-gyp",
      "bin",
      "node-gyp.js",
    ),
    npm_config_npm_version: "12.0.1",
    npm_command: "run",
    npm_package_bin_askr: path.posix.normalize(packageMetadata.bin.askr),
    npm_package_engines_node: packageMetadata.engines.node,
    VITEST: "true",
    VITEST_MODE: "RUN",
    VITEST_POOL_ID: "1",
    VITEST_WORKER_ID: "0",
    TEST: "true",
    FORCE_TTY: "",
    npm_lifecycle_event: "test:templates:final",
    npm_lifecycle_script: script,
    npm_execpath: resolved.admission.tools.npmCli.file,
    npm_node_execpath: process.execPath,
    npm_package_json: path.join(source, "package.json"),
  };
  ambient.PATH = finalWorkerPath(resolved, ambient.PATH!);
  return { root, source, runner, registry, job, ref, resolved, ambient, freeze };
}
test("final worker constructs a separately pinned witness and admission from actual worker values", async () => {
  const f = await finalJobFixture();
  try {
    const original = await fs.readFile(f.ref.file);
    const result = await prepareFinalWorker(f.ref.file, f.ref.sha256, f.ambient, f.source);
    expect(await fs.readFile(f.ref.file)).toEqual(original);
    expect(digest(await fs.readFile(result.finalRef.file))).toBe(result.finalRef.sha256);
    expect(digest(await fs.readFile(result.admission.caller.file))).toBe(
      result.admission.caller.sha256,
    );
    expect(result.witness.environmentKeys).toContain("ASKR_FINAL18_ADMISSION_SHA256");
    validateParentWitness(
      result.witness,
      result.admission,
      manifestFromFixture(f),
      f.ambient,
      f.source,
      result.finalRef,
    );
    const reset = {
      ...f.ambient,
      ASKR_FINAL18_ADMISSION: f.ref.file,
      ASKR_FINAL18_ADMISSION_SHA256: f.ref.sha256,
    };
    await expect(prepareFinalWorker(f.ref.file, f.ref.sha256, reset, f.source)).rejects.toThrow(
      /Repeated final worker output/u,
    );
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
function manifestFromFixture(f: Awaited<ReturnType<typeof finalJobFixture>>): FinalManifest {
  const m = manifest();
  for (const row of m.packages) {
    const archive = f.job.admission.archives.find((entry) => entry.name === row.name)!;
    row.archiveSha512 = archive.archiveSha512;
    row.packageJsonSha256 = archive.packageJsonSha256;
    row.lockSha256 = digest(Buffer.from('{"lockfileVersion":3}\n'));
  }
  return m;
}
test("final worker rejects unrelated metadata and changed controlled lifecycle values before witness publication", async () => {
  const f = await finalJobFixture();
  try {
    const packageMetadata = JSON.parse(
      await fs.readFile(path.join(f.source, "package.json"), "utf8"),
    );
    for (const [key, value] of Object.entries({
      PWD: "/foreign",
      SHLVL: "2",
      _: "/foreign/vp",
      npm_config_allow_scripts: "foreign",
      npm_config_global_ignore_file: "/foreign/npmignore",
      npm_config_init_module: "/foreign/init.js",
      npm_config_noproxy: "foreign",
      JS_RUNTIME_NAME: "bun",
      JS_RUNTIME_VERSION: "24.20.0",
      NODE_PACKAGE_MANAGER: "npm",
      VP_VERSION: "0.3.2",
      BASE_URL: "/foreign/",
      MODE: "production",
      DEV: "",
      PROD: "1",
      SSR: "",
      COLOR: "1",
      EDITOR: "foreign-editor",
      npm_config_node_gyp: "/foreign/node-gyp.js",
      npm_config_npm_version: "11.0.0",
      npm_command: "run-script",
      npm_package_bin_askr: "foreign.js",
      npm_package_engines_node: ">=0.0.0",
      npm_package_config_foreign: "foreign",
      GITHUB_TOKEN: "PRIVATE_CANARY",
      RUNNER_TEMP: f.runner,
      BOUNDARY_MODE: "candidate",
      HTTPS_PROXY: "http://foreign",
      UNREVIEWED_KEY: "foreign",
      HOME: "/foreign",
      VP_HOME: "/foreign",
      npm_execpath: "/foreign/npm",
      VITEST_WORKER_ID: "1",
      ASKR_FINAL18_ADMISSION_SHA256: "b".repeat(64),
    })) {
      const env = { ...f.ambient, [key]: value };
      await expect(
        validateFinalWorkerEnvironment(f.resolved, f.ref, env, packageMetadata),
      ).rejects.toThrow();
    }
    for (const key of [
      ...(process.platform === "darwin"
        ? ["PWD", "SHLVL", "_"]
        : process.platform === "linux"
          ? ["PWD"]
          : []),
      "npm_config_allow_scripts",
      "npm_config_global_ignore_file",
      "npm_config_init_module",
      "npm_config_noproxy",
      "JS_RUNTIME_NAME",
      "JS_RUNTIME_VERSION",
      "NODE_PACKAGE_MANAGER",
      "VP_VERSION",
      "BASE_URL",
      "MODE",
      "DEV",
      "PROD",
      "SSR",
    ]) {
      const missing = { ...f.ambient };
      delete missing[key];
      await expect(
        validateFinalWorkerEnvironment(f.resolved, f.ref, missing, packageMetadata),
      ).rejects.toThrow();
    }
    // Keep full publication-boundary checks after the exhaustive environment-only table.
    await expect(
      prepareFinalWorker(
        f.ref.file,
        f.ref.sha256,
        { ...f.ambient, ASKR_FINAL18_ADMISSION_SHA256: "b".repeat(64) },
        f.source,
      ),
    ).rejects.toThrow(/ASKR_FINAL18_ADMISSION_SHA256/u);
    const changed = {
      ...f.ambient,
      JS_RUNTIME_VERSION: "PRIVATE_CANARY",
      VITEST_WORKER_ID: "1",
      npm_config_init_module: "PRIVATE_CANARY",
    };
    const changedRejected = await prepareFinalWorker(
      f.ref.file,
      f.ref.sha256,
      changed,
      f.source,
    ).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(changedRejected?.message).toContain(
      "JS_RUNTIME_VERSION, VITEST_WORKER_ID, npm_config_init_module",
    );
    expect(changedRejected?.message).not.toContain("PRIVATE_CANARY");
    const unknown = {
      ...f.ambient,
      JS_RUNTIME_FOREIGN: "PRIVATE_CANARY",
      VITE_UNREVIEWED: "PRIVATE_CANARY",
      UNREVIEWED_KEY: "PRIVATE_CANARY",
    };
    const rejected = await prepareFinalWorker(f.ref.file, f.ref.sha256, unknown, f.source).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(rejected?.message).toContain("JS_RUNTIME_FOREIGN, UNREVIEWED_KEY, VITE_UNREVIEWED");
    expect(rejected?.message).not.toContain("PRIVATE_CANARY");
    for (const name of ["caller.json", "admission.json"])
      await expect(fs.lstat(path.join(f.resolved.ownedRoot, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("final worker binds static source, manifest, tools, runtime archive and owned path authority", async () => {
  const f = await finalJobFixture();
  try {
    const mutations: ((job: FinalJobInput) => void)[] = [
      (job) => {
        job.approvedForExecution = false;
      },
      (job) => {
        job.source.commit = "b".repeat(40);
      },
      (job) => {
        job.source.inventory.sha256 = "b".repeat(64);
      },
      (job) => {
        job.admission.manifest.sha256 = "b".repeat(64);
      },
      (job) => {
        job.admission.tools.npmCli.sha256 = "b".repeat(64);
      },
      (job) => {
        job.admission.platform = "foreign";
      },
      (job) => {
        job.ownedRoot = "@runner/foreign";
      },
      (job) => {
        job.source.inventory.file = "@bundle/../source-files.json";
      },
      (job) => {
        job.admission.archives[0]!.archive = "@registry/foreign.tgz";
      },
      (job) => {
        const row = job.admission.archives[0]!,
          short = row.name.slice(8);
        row.archive = `@registry/artifacts/${short}/${short}-0.5.0.tgz`;
      },
    ];
    for (const mutate of mutations) {
      const job = structuredClone(f.job);
      mutate(job);
      const ref = await f.freeze(job);
      await expect(
        prepareFinalWorker(
          ref.file,
          ref.sha256,
          { ...f.ambient, ASKR_FINAL18_ADMISSION_SHA256: ref.sha256 },
          f.source,
        ),
      ).rejects.toThrow();
    }
    await f.freeze();
    await expect(
      prepareFinalWorker(f.ref.file, "b".repeat(64), f.ambient, f.source),
    ).rejects.toThrow();
    await expect(
      prepareFinalWorker(f.ref.file, f.ref.sha256, f.ambient, f.runner),
    ).rejects.toThrow();
    const serverFile = path.join(f.registry, "server.json"),
      serverRaw = await fs.readFile(serverFile);
    await fs.writeFile(
      serverFile,
      JSON.stringify({
        pid: process.pid,
        registry: "http://127.0.0.1:23456/",
        id: "12345678-1234-1234-1234-123456789abc",
      }),
    );
    await expect(
      prepareFinalWorker(f.ref.file, f.ref.sha256, f.ambient, f.source),
    ).rejects.toThrow();
    await fs.writeFile(serverFile, serverRaw);
    await expect(fs.lstat(path.join(f.resolved.ownedRoot, "caller.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("the physical npm and Vitest worker constructs the final envelope without hosted metadata", async () => {
  const f = await finalJobFixture(true);
  try {
    const env: NodeJS.ProcessEnv = {
      RUNNER_TEMP: f.runner,
      PATH: path.dirname(process.execPath),
      JS_RUNTIME_NAME: "bun",
      JS_RUNTIME_VERSION: "0.0.0",
      NODE_PACKAGE_MANAGER: "foreign",
      VP_VERSION: "foreign",
      VITE_UNREVIEWED: "PRIVATE_CANARY",
      COLOR: "1",
      EDITOR: "foreign-editor",
      npm_config_node_gyp: "/foreign/node-gyp.js",
      npm_config_npm_version: "11.0.0",
      GITHUB_TOKEN: "PRIVATE_CANARY",
      BOUNDARY_MODE: "candidate",
      RUNNER_NAME: "unforwarded-canary",
    };
    if (f.job.systemRoot) env.SystemRoot = f.job.systemRoot;
    if (process.platform === "darwin")
      env.__CF_USER_TEXT_ENCODING = `0x${process.getuid!().toString(16).toUpperCase()}:0x0:0x0`;
    const result = await promisify(execFile)(
      process.execPath,
      [
        path.join(f.source, "scripts/qualification/final-parent.mjs"),
        "defaults",
        f.ref.file,
        f.ref.sha256,
      ],
      { cwd: f.source, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
    );
    expect(result.stderr).not.toContain("PRIVATE_CANARY");
    const observed = JSON.parse(
      await fs.readFile(path.join(f.resolved.ownedRoot, "probe-observed.json"), "utf8"),
    );
    expect(observed.workerConstructed).toBe(true);
    expect(observed.finalQualification).toBe(false);
    expect(
      JSON.parse(await fs.readFile(path.join(f.resolved.ownedRoot, "parent-exit.json"), "utf8"))
        .status,
    ).toBe(0);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
}, 90000);

test("managed npm PATH requires the exact owned prefix, unchanged tail and admitted runtime", async () => {
  const f = await finalJobFixture(true);
  try {
    const managed = path.join(
      f.resolved.ownedRoot,
      "home",
      "data",
      "vite-plus",
      "package_manager",
      "npm",
      "12.0.1",
      "npm",
    );
    const admitted = path.dirname(path.dirname(f.resolved.admission.tools.npmCli.file));
    await fs.mkdir(path.dirname(managed), { recursive: true });
    await fs.cp(admitted, managed, { recursive: true, dereference: false, verbatimSymlinks: true });
    await fs.rm(path.join(managed, "node_modules", ".bin"), { recursive: true, force: true });
    const shims: Record<string, string> = {
      "bin/npm":
        '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\ncase `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n    exec "$basedir/node" "$basedir/npm-cli.js" "$@"\nelse\n    exec node "$basedir/npm-cli.js" "$@"\nfi\n',
      "bin/npm.cmd":
        '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n    "%~dp0\\node.exe" "%~dp0\\npm-cli.js" %*\r\n) ELSE (\r\n@SET PATHEXT=%PATHEXT:;.JS;=;%\r\n    node "%~dp0\\npm-cli.js" %*\r\n)\r\n',
      "bin/npm.ps1":
        '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n    # Fix case when both the Windows and Linux builds of Node\n    # are installed in the same directory\n    $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n    # Support pipeline input\n    if ($MyInvocation.ExpectingInput) {\n        $input | & "$basedir/node$exe" "$basedir/npm-cli.js" $args\n    } else {\n        & "$basedir/node$exe" "$basedir/npm-cli.js" $args\n    }\n    $ret=$LASTEXITCODE\n} else {\n    # Support pipeline input\n    if ($MyInvocation.ExpectingInput) {\n        $input | & "node$exe" "$basedir/npm-cli.js" $args\n    } else {\n        & "node$exe" "$basedir/npm-cli.js" $args\n    }\n    $ret=$LASTEXITCODE\n}\nexit $ret\n',
      "bin/npx":
        '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\ncase `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n    exec "$basedir/node" "$basedir/npx-cli.js" "$@"\nelse\n    exec node "$basedir/npx-cli.js" "$@"\nfi\n',
      "bin/npx.cmd":
        '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n    "%~dp0\\node.exe" "%~dp0\\npx-cli.js" %*\r\n) ELSE (\r\n@SET PATHEXT=%PATHEXT:;.JS;=;%\r\n    node "%~dp0\\npx-cli.js" %*\r\n)\r\n',
      "bin/npx.ps1":
        '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n    # Fix case when both the Windows and Linux builds of Node\n    # are installed in the same directory\n    $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n    # Support pipeline input\n    if ($MyInvocation.ExpectingInput) {\n        $input | & "$basedir/node$exe" "$basedir/npx-cli.js" $args\n    } else {\n        & "$basedir/node$exe" "$basedir/npx-cli.js" $args\n    }\n    $ret=$LASTEXITCODE\n} else {\n    # Support pipeline input\n    if ($MyInvocation.ExpectingInput) {\n        $input | & "node$exe" "$basedir/npx-cli.js" $args\n    } else {\n        & "node$exe" "$basedir/npx-cli.js" $args\n    }\n    $ret=$LASTEXITCODE\n}\nexit $ret\n',
    };
    for (const [file, raw] of Object.entries(shims))
      await fs.writeFile(path.join(managed, file), raw);
    const pkg = JSON.parse(await fs.readFile(path.join(f.source, "package.json"), "utf8"));
    const prefix = path.join(managed, "bin"),
      tail = f.ambient.PATH!;
    const env = { ...f.ambient, PATH: prefix + path.delimiter + tail };
    await expect(
      validateFinalWorkerEnvironment(f.resolved, f.ref, f.ambient, pkg),
    ).resolves.toBeUndefined();
    await expect(
      validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg),
    ).resolves.toBeUndefined();
    for (const PATH of [
      "/foreign" + path.delimiter + tail,
      prefix + path.delimiter + env.PATH,
      tail + path.delimiter + prefix,
      prefix + path.delimiter + tail + path.delimiter + "/foreign",
      prefix.replace("12.0.1", "12.0.2") + path.delimiter + tail,
    ])
      await expect(
        validateFinalWorkerEnvironment(f.resolved, f.ref, { ...env, PATH }, pkg),
      ).rejects.toThrow(/PATH/u);
    for (const file of ["lib/cli.js", "bin/npm"]) {
      const target = path.join(managed, file),
        raw = await fs.readFile(target);
      await fs.appendFile(target, "\nUNREVIEWED_RUNTIME_CHANGE\n");
      await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
      await fs.writeFile(target, raw);
    }
    const extra = path.join(managed, "bin", "node");
    await fs.writeFile(extra, "unreviewed executable");
    await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
    await fs.unlink(extra);
    const target = path.join(managed, "lib", "cli.js"),
      raw = await fs.readFile(target);
    await fs.unlink(target);
    await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
    await fs.writeFile(target, raw);
    if (process.platform === "win32") {
      const alias = path.join(admitted, "node_modules", ".bin", "semver.cmd"),
        raw = await fs.readFile(alias);
      await fs.appendFile(alias, "UNREVIEWED_WRAPPER");
      await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
      await fs.writeFile(alias, raw);
    } else {
      const alias = path.join(admitted, "node_modules", ".bin", "semver"),
        link = await fs.readlink(alias);
      await fs.unlink(alias);
      await fs.symlink("../../../../foreign", alias);
      await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
      await fs.unlink(alias);
      await fs.symlink(link, alias);
    }
    const aliases = path.join(admitted, "node_modules", ".bin");
    await fs.rename(aliases, aliases + ".saved");
    await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
    await fs.rename(aliases + ".saved", aliases);
    await fs.rename(managed, managed + ".saved");
    await fs.symlink(
      managed + ".saved",
      managed,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(validateFinalWorkerEnvironment(f.resolved, f.ref, env, pkg)).rejects.toThrow();
    await fs.unlink(managed);
    await fs.rename(managed + ".saved", managed);
    await expect(fs.lstat(path.join(f.resolved.ownedRoot, "caller.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
}, 90000);

test("Windows npm installed aliases require the exact27 generated wrappers and reject missing or altered entries", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "askr-npm-windows-shims-")),
  );
  try {
    const aliases: Record<string, string> = {
      arborist: "../@npmcli/arborist/bin/index.js",
      cssesc: "../cssesc/bin/cssesc",
      "installed-package-contents": "../@npmcli/installed-package-contents/bin/index.js",
      "node-gyp": "../node-gyp/bin/node-gyp.js",
      "node-which": "../which/bin/which.js",
      nopt: "../nopt/bin/nopt.js",
      pacote: "../pacote/bin/index.js",
      "qrcode-terminal": "../qrcode-terminal/bin/qrcode-terminal.js",
      semver: "../semver/bin/semver.js",
    };
    const dir = path.join(root, "node_modules", ".bin");
    await fs.mkdir(dir, { recursive: true });
    for (const [name, target] of Object.entries(aliases)) {
      const source = path.resolve(dir, target);
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.writeFile(source, "#!/usr/bin/env node\n");
      const wrappers = {
        [name]:
          '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\nbasedir_win="$basedir"\n\ncase `uname -a` in\n  *CYGWIN*|*MINGW*|*MSYS*)\n    if command -v cygpath > /dev/null 2>&1; then\n      basedir_win=`cygpath -w "$basedir"`\n    fi\n  ;;\n  *WSL2*)\n    if command -v wslpath > /dev/null 2>&1; then\n      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"\n      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then\n        echo "Error: wslpath failed to convert path. WSL environment may be misconfigured." >&2\n        exit 1\n      fi\n    fi\n  ;;\nesac\n\nPROG_EXE="$basedir/node.exe"\nif ! [ -x "$PROG_EXE" ]; then\n  PROG_EXE="$basedir/node"\n  if ! [ -x "$PROG_EXE" ]; then\n    PROG_EXE=node\n    if ! [ -x "$PROG_EXE" ]; then\n      PROG_EXE=node.exe\n    fi\n  fi\nfi\n\n' +
          `exec "$PROG_EXE"  "$basedir_win/${target}" "$@"\n`,
        [name + ".cmd"]:
          '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  ' +
          '"%dp0%\\' +
          target.replaceAll("/", "\\") +
          '" %*\r\n',
        [name + ".ps1"]:
          '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "$basedir/TARGET" $args\n  } else {\n    & "$basedir/node$exe"  "$basedir/TARGET" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "$basedir/TARGET" $args\n  } else {\n    & "node$exe"  "$basedir/TARGET" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n'.replaceAll(
            "TARGET",
            target,
          ),
      };
      for (const [file, raw] of Object.entries(wrappers))
        await fs.writeFile(path.join(dir, file), raw);
    }
    await expect(verifyInstalledNpmAliases(root, "win32")).resolves.toBeUndefined();
    const file = path.join(dir, "semver.cmd"),
      raw = await fs.readFile(file);
    await fs.appendFile(file, "UNREVIEWED_WRAPPER");
    await expect(verifyInstalledNpmAliases(root, "win32")).rejects.toThrow();
    await fs.unlink(file);
    await expect(verifyInstalledNpmAliases(root, "win32")).rejects.toThrow();
    await fs.writeFile(file, raw);
    const extra = path.join(dir, "foreign.cmd");
    await fs.writeFile(extra, "UNREVIEWED_WRAPPER");
    await expect(verifyInstalledNpmAliases(root, "win32")).rejects.toThrow();
    await fs.unlink(extra);
    await fs.rename(dir, dir + ".saved");
    await expect(verifyInstalledNpmAliases(root, "win32")).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
