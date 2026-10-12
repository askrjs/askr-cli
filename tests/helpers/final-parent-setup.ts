import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  digest,
  pinned,
  validateAdmission,
  validateManifest,
  validateParentWitness,
  type FinalAdmission,
  type FinalManifest,
  type ParentWitness,
  type Ref,
} from "./final-provider-graph";

export interface FinalJobInput {
  schemaVersion: number;
  boundary: string;
  approvedForExecution: boolean;
  operation: "defaults" | "providers-native" | "providers-all";
  runtime: "h20";
  source: { root: string; commit: string; tree: string; inventory: Ref };
  ownedRoot: string;
  nodeExecutable: Ref;
  terminationTool: Ref | null;
  systemRoot: string | null;
  admission: Omit<FinalAdmission, "caller" | "registry"> & {
    registry: FinalAdmission["registry"] | null;
  };
}
const scripts = {
  defaults: "test:templates:final",
  "providers-native": "test:provider-starters",
  "providers-all": "test:provider-starters",
} as const;
const bodies = {
  defaults:
    "vp test run -c vitest.integration.config.ts tests/integration/final-packed-templates.test.ts",
  "providers-native":
    "vp test run -c vitest.integration.config.ts tests/integration/provider-starters.test.ts",
  "providers-all":
    "vp test run -c vitest.integration.config.ts tests/integration/provider-starters.test.ts",
} as const;
export function finalParentEnvironment(job: FinalJobInput, ref: Ref): Record<string, string> {
  const root = job.ownedRoot;
  const home = path.join(root, "home"),
    temp = path.join(root, "tmp");
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    USER: "owned-final18",
    LOGNAME: "owned-final18",
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    XDG_DATA_HOME: path.join(home, "data"),
    VP_HOME: path.join(home, "data", "vite-plus"),
    NPM_CONFIG_USERCONFIG: path.join(root, "user.npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(root, "global.npmrc"),
    NPM_CONFIG_CACHE: path.join(root, "npm-cache"),
    NPM_CONFIG_PREFIX: path.join(root, "npm-prefix"),
    NPM_CONFIG_IGNORE_SCRIPTS: "false",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    OPENSSL_CONF: path.join(root, "openssl.cnf"),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CI: "1",
    LANG: "C.UTF-8",
    TZ: "UTC",
    ASKR_FINAL18_ADMISSION: ref.file,
    ASKR_FINAL18_ADMISSION_SHA256: ref.sha256,
    ASKR_PROVIDER_PHASE: job.admission.phase,
    ASKR_PROVIDER_EVIDENCE: path.join(root, "evidence"),
  };
  let system = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  if (job.admission.platform === "win32") {
    const windows = job.systemRoot;
    assert(windows && path.win32.isAbsolute(windows) && !/[\r\n;]/u.test(windows));
    Object.assign(env, {
      SystemRoot: windows,
      WINDIR: windows,
      ComSpec: path.join(windows, "System32", "cmd.exe"),
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
    });
    system = [path.join(windows, "System32"), windows];
  } else {
    assert.equal(job.systemRoot, null);
    if (job.admission.platform === "darwin") {
      assert.equal(process.platform, "darwin");
      assert.equal(typeof process.getuid, "function");
      env.__CF_USER_TEXT_ENCODING = `0x${process.getuid!().toString(16).toUpperCase()}:0x0:0x0`;
    }
  }
  env.PATH = [
    ...new Set([
      path.dirname(job.nodeExecutable.file),
      path.dirname(job.admission.tools.openssl.executable.file),
      ...system,
    ]),
  ].join(path.delimiter);
  return env;
}
export function finalWorkerPath(job: FinalJobInput, parentPath: string) {
  const bins: string[] = [];
  let current = job.source.root;
  for (;;) {
    bins.push(path.join(current, "node_modules", ".bin"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // npm 12's pinned @npmcli/run-script set-path contract, not an ambient PATH.
  bins.push(
    path.join(
      path.dirname(path.dirname(job.admission.tools.npmCli.file)),
      "node_modules",
      "@npmcli",
      "run-script",
      "lib",
      "node-gyp-bin",
    ),
    parentPath,
  );
  return bins.join(path.delimiter);
}
// Vite+ 0.3.3 rewrites only these npm 12.0.1 launchers (pinned shim.rs).
const managedNpmShims: Record<string, { size: number; sha256: string }> = {
  "bin/npm": {
    size: 364,
    sha256: "6f537a2d21013d09e8b779b4762553e6fe6e524f064c884e261e152741a71c09",
  },
  "bin/npm.cmd": {
    size: 162,
    sha256: "830b2f39309afdaecefa0ee432bcd6ca5577cbc14b0f89dc82c2069dec868a0c",
  },
  "bin/npm.ps1": {
    size: 791,
    sha256: "1eb5f921afd90b573cb666db3a195bc9a7b4f9ae86f7c002265e2a61cb26c05f",
  },
  "bin/npx": {
    size: 364,
    sha256: "6f27779081046e5d6c46df1f7aaedaafbb64900c3e259be2ab698206cde49298",
  },
  "bin/npx.cmd": {
    size: 162,
    sha256: "b72a56e18714dd363f08ffa52a37a0d1372cbeb59add6eba16dd1cc71fbf1470",
  },
  "bin/npx.ps1": {
    size: 791,
    sha256: "e88960cc8c0756733b229cd905be40935d750100171249e217b5616e460c27b0",
  },
};
// npm install adds these aliases; the managed npm tarball has no .bin directory.
const installedNpmAliases: Record<string, string> = {
  "node_modules/.bin/arborist": "../@npmcli/arborist/bin/index.js",
  "node_modules/.bin/cssesc": "../cssesc/bin/cssesc",
  "node_modules/.bin/installed-package-contents":
    "../@npmcli/installed-package-contents/bin/index.js",
  "node_modules/.bin/node-gyp": "../node-gyp/bin/node-gyp.js",
  "node_modules/.bin/node-which": "../which/bin/which.js",
  "node_modules/.bin/nopt": "../nopt/bin/nopt.js",
  "node_modules/.bin/pacote": "../pacote/bin/index.js",
  "node_modules/.bin/qrcode-terminal": "../qrcode-terminal/bin/qrcode-terminal.js",
  "node_modules/.bin/semver": "../semver/bin/semver.js",
};
const windowsNpmAliases: Record<string, { size: number; sha256: string }> = {
  arborist: {
    size: 826,
    sha256: "827fea7fdefcccf9ddb629cc2254cc5ba739a5ece855de2e77eeff567864ed16",
  },
  "arborist.cmd": {
    size: 333,
    sha256: "4c362e1bc22ae3316e429af11f09e90235f0e0b6c81483d8a23ce30a68de0434",
  },
  "arborist.ps1": {
    size: 841,
    sha256: "49bd3a68c15b4320017d9da48b2f14ae9774eef9dd9cfc2c7dfb34cd9a2061f4",
  },
  cssesc: {
    size: 814,
    sha256: "6b043b289b2ee92bc5624d218e16ba19918b9cd442b9d05cf7e1c4b141bceadc",
  },
  "cssesc.cmd": {
    size: 321,
    sha256: "f084200df660e846bd62f46856acf88d68e04628cece7ac4570493df4df3599d",
  },
  "cssesc.ps1": {
    size: 793,
    sha256: "374097dc2c3fac96d5a11ec029ec1598d4098a70242bb3c31012a85bd5ee4655",
  },
  "installed-package-contents": {
    size: 844,
    sha256: "1e151969b084cfbcf73f7dc9fb3fd5bf429239eecc4ad8af7eb020e70c9e1fa6",
  },
  "installed-package-contents.cmd": {
    size: 351,
    sha256: "759821c501f7d7dd5999df88f0aa353f54f76a9c5ad981cffc18e83ddd909be4",
  },
  "installed-package-contents.ps1": {
    size: 913,
    sha256: "fffd0f93c9033a13b1b33f52b5e40b681168686460bef93e33f40040fb15bc49",
  },
  "node-gyp": {
    size: 821,
    sha256: "9e35698e24bc6a783f8e37c04e002913eb633549a3294a19f7d942adb4011426",
  },
  "node-gyp.cmd": {
    size: 328,
    sha256: "43b1e1205f1bd769ed64f2cca412b8c27b1929a07239df960f851e654110eada",
  },
  "node-gyp.ps1": {
    size: 821,
    sha256: "78d9fe7e2c419aef5f787f1e9bda0c4d3d411fdd7686d92363ed17a62c3ad1f5",
  },
  "node-which": {
    size: 815,
    sha256: "36200b4ada070633ee5b5c5dff8912ebaae6448913912ca7831135dac15e88e0",
  },
  "node-which.cmd": {
    size: 322,
    sha256: "633246aa128d781693b73771d555e9e1f233ed36fde6a542449778eb2e204087",
  },
  "node-which.ps1": {
    size: 797,
    sha256: "951b24a10604321639e1ac23d5c0f0b2d56c2d8db7f50be37ef1dc6963899277",
  },
  nopt: {
    size: 813,
    sha256: "bd4a662cd02a6613a77b05871a539b446b3bf09b1b49d064702a968650c2c8c2",
  },
  "nopt.cmd": {
    size: 320,
    sha256: "ede71b1b2a9d6b70f8d23aa8a074b366bb30ce346132132bca6e2f9125679f95",
  },
  "nopt.ps1": {
    size: 789,
    sha256: "08b2e0c384c9feb9d17908fdab0c583f5f3455884f0702a96ef7ed870b508eba",
  },
  pacote: {
    size: 816,
    sha256: "2d8820378a8dcea5684719969b34fb4b5b7d47b21e4a1cc4dabb47f027e642dc",
  },
  "pacote.cmd": {
    size: 323,
    sha256: "99955a4f757d97b3f0fa96c5cad798b629c86f851355be9afd7a8034a39e1eaf",
  },
  "pacote.ps1": {
    size: 801,
    sha256: "3a9c9ca320b14a3023f8233a568beb96081bc8e3a3bf3b8c93474aeafbe7a33d",
  },
  "qrcode-terminal": {
    size: 835,
    sha256: "8d729bd6f0f04c3aff541f456474a7729241535634a3ac79216f997d34054f2a",
  },
  "qrcode-terminal.cmd": {
    size: 342,
    sha256: "5defec9c3c97ae49722d299e68d92a4c9ef5d4e8b2061ba20f97dad9991a2992",
  },
  "qrcode-terminal.ps1": {
    size: 877,
    sha256: "a63e3ebafae09cd4d175d8a0506116ed29c8f9b0dbcaebd385bafe9a2ad376f3",
  },
  semver: {
    size: 817,
    sha256: "060ce88b470f3cc13bf82185f1c9ec7261ded9df77345eb2deb36823e3f5e8d2",
  },
  "semver.cmd": {
    size: 324,
    sha256: "0fd99ca07944dc778a4e14172565524a636f7ab3fa8a8eefa595db7c914e6f67",
  },
  "semver.ps1": {
    size: 805,
    sha256: "1e1355d1aaf2a75275f9d884dbcd2f1c713d4ada1782fe8370bc21db6aedbc31",
  },
};
export async function verifyInstalledNpmAliases(admitted: string, platform: string) {
  assert(["darwin", "linux", "win32"].includes(platform));
  const dir = path.join(admitted, "node_modules", ".bin");
  await physical(dir, true);
  const names = (await fs.readdir(dir)).sort();
  assert.deepEqual(
    names,
    platform === "win32"
      ? Object.keys(windowsNpmAliases).sort()
      : Object.keys(installedNpmAliases)
          .map((name) => path.posix.basename(name))
          .sort(),
  );
  for (const [relative, target] of Object.entries(installedNpmAliases)) {
    const file = path.join(admitted, relative),
      resolved = path.resolve(dir, target);
    assert(resolved.startsWith(admitted + path.sep), "npm alias escapes runtime");
    await physical(resolved);
    if (platform !== "win32") {
      assert((await fs.lstat(file)).isSymbolicLink(), "Unexpected npm installed alias form");
      assert.equal(await fs.readlink(file), target);
      assert.equal(await fs.realpath(file), resolved);
    }
  }
  if (platform === "win32")
    for (const name of names) {
      const file = path.join(dir, name),
        info = await physical(file),
        expected = windowsNpmAliases[name]!;
      assert.equal(info.size, expected.size);
      const raw = await fs.readFile(file);
      assert.equal(raw.length, expected.size);
      assert.equal(digest(raw), expected.sha256, "Changed Windows npm installed alias");
    }
}
async function verifyManagedNpm(job: FinalJobInput, managed: string) {
  const admitted = path.dirname(path.dirname(job.admission.tools.npmCli.file));
  assert.equal(job.admission.tools.npmCli.file, path.join(admitted, "bin", "npm-cli.js"));
  await pinned(job.admission.tools.npmCli);
  await physical(admitted, true);
  await verifyInstalledNpmAliases(admitted, job.admission.platform);
  await physical(managed, true);
  for (const root of [admitted, managed]) {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.name, "npm");
    assert.equal(pkg.version, "12.0.1");
  }
  async function rows(root: string, isManaged: boolean) {
    const result: {
      path: string;
      kind: string;
      size?: number;
      sha256?: string;
      executable?: number;
    }[] = [];
    let entries = 0,
      bytes = 0;
    async function walk(relative: string) {
      const dir = path.join(root, relative);
      const info = await physical(dir, true);
      if (isManaged && process.getuid) assert.equal(info.uid, process.getuid());
      const names = (await fs.readdir(dir)).sort();
      if (relative === "node_modules/.bin") {
        assert(!isManaged, "Managed npm must not add installed aliases");
        return; // The complete platform-specific installed cohort was verified above.
      }
      if (relative) result.push({ path: relative, kind: "directory" });
      for (const name of names) {
        assert(++entries <= 4096, "npm runtime entry cap");
        const rel = relative ? `${relative}/${name}` : name,
          file = path.join(root, rel),
          stat = await fs.lstat(file);
        if (stat.isDirectory()) {
          await walk(rel);
          continue;
        }
        assert(stat.isFile() && !stat.isSymbolicLink(), "Unexpected npm runtime entry type");
        await physical(file);
        if (isManaged && process.getuid) assert.equal(stat.uid, process.getuid());
        assert(
          stat.size <= 16 * 1024 * 1024 && (bytes += stat.size) <= 64 * 1024 * 1024,
          "npm runtime size cap",
        );
        const raw = await fs.readFile(file);
        assert.equal(raw.length, stat.size);
        const row = {
          path: rel,
          kind: "file",
          size: stat.size,
          sha256: digest(raw),
          executable: process.platform === "win32" ? 0 : stat.mode & 0o111,
        };
        const shim = managedNpmShims[rel];
        if (shim) {
          if (isManaged) {
            assert.equal(row.size, shim.size);
            assert.equal(row.sha256, shim.sha256);
          } else {
            row.size = shim.size;
            row.sha256 = shim.sha256;
          }
        }
        result.push(row);
      }
    }
    await walk("");
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  assert.deepEqual(
    await rows(managed, true),
    await rows(admitted, false),
    "Managed npm runtime differs from admitted npm",
  );
}
export async function validateFinalWorkerEnvironment(
  job: FinalJobInput,
  ref: Ref,
  ambient: NodeJS.ProcessEnv,
  packageMetadata: { version: string; bin: { askr: string }; engines: { node: string } },
) {
  const expected = finalParentEnvironment(job, ref);
  expected.PATH = finalWorkerPath(job, expected.PATH!);
  if (ambient.PATH !== expected.PATH) {
    const managed = path.join(expected.VP_HOME!, "package_manager", "npm", "12.0.1", "npm");
    const prefixed = path.join(managed, "bin") + path.delimiter + expected.PATH;
    assert.equal(ambient.PATH, prefixed, "Changed final worker environment keys: PATH");
    await verifyManagedNpm(job, managed);
    expected.PATH = prefixed;
  }
  assert.deepEqual(Object.keys(packageMetadata.bin), ["askr"]);
  assert.deepEqual(Object.keys(packageMetadata.engines), ["node"]);
  assert.equal(packageMetadata.bin.askr, "./dist/cli.js");
  const additions: Record<string, string> = {
    ...(job.admission.platform === "win32"
      ? {}
      : {
          PWD: job.source.root,
          SHLVL: "1",
          _: path.join(job.source.root, "node_modules", ".bin", "vp"),
        }),
    npm_config_allow_scripts: "",
    npm_config_global_ignore_file: path.join(expected.NPM_CONFIG_PREFIX!, "etc", "npmignore"),
    npm_config_init_module: path.join(expected.HOME!, ".npm-init.js"),
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
    EDITOR: job.admission.platform === "win32" ? path.join(job.systemRoot!, "notepad.exe") : "vi",
    npm_config_node_gyp: path.join(
      path.dirname(path.dirname(job.admission.tools.npmCli.file)),
      "node_modules",
      "node-gyp",
      "bin",
      "node-gyp.js",
    ),
    npm_config_npm_version: "12.0.1",
    NODE: job.nodeExecutable.file,
    NODE_ENV: "test",
    VITEST: "true",
    VITEST_MODE: "RUN",
    VITEST_POOL_ID: "1",
    VITEST_WORKER_ID: "0",
    TEST: "true",
    FORCE_TTY: "",
    INIT_CWD: job.source.root,
    npm_execpath: job.admission.tools.npmCli.file,
    npm_node_execpath: job.nodeExecutable.file,
    npm_lifecycle_event: scripts[job.operation],
    npm_lifecycle_script: bodies[job.operation],
    npm_command: "run",
    npm_package_json: path.join(job.source.root, "package.json"),
    npm_package_name: "@askrjs/cli",
    npm_package_version: packageMetadata.version,
    npm_package_bin_askr: path.posix.normalize(packageMetadata.bin.askr),
    npm_package_engines_node: packageMetadata.engines.node,
    npm_config_user_agent: `npm/12.0.1 node/v24.21.0 ${process.platform} ${process.arch} workspaces/false`,
    npm_config_local_prefix: job.source.root,
    npm_config_prefix: expected.NPM_CONFIG_PREFIX!,
    npm_config_global_prefix: expected.NPM_CONFIG_PREFIX!,
    npm_config_metrics_registry: "https://registry.npmjs.org/",
  };
  const unknown = Object.keys(ambient).filter(
    (name) =>
      ambient[name] !== undefined &&
      !Object.keys(expected).some((key) => key.toLowerCase() === name.toLowerCase()) &&
      !Object.hasOwn(additions, name),
  );
  assert.equal(
    unknown.length,
    0,
    `Unexpected final worker environment keys: ${unknown.sort().join(", ")}`,
  );
  const changed = new Set<string>();
  for (const [name, value] of Object.entries(expected))
    if (ambient[name] !== value) changed.add(name);
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined || name in expected) continue;
    const lower = name.toLowerCase();
    const configured = Object.keys(expected).find((key) => key.toLowerCase() === lower);
    const wanted = configured ? expected[configured] : additions[name];
    if (wanted === undefined || value !== wanted) changed.add(name);
  }
  for (const name of [
    ...(job.admission.platform === "darwin"
      ? ["PWD", "SHLVL", "_"]
      : job.admission.platform === "linux"
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
    "COLOR",
    "EDITOR",
    "npm_config_node_gyp",
    "npm_config_npm_version",
    "npm_command",
    "npm_package_bin_askr",
    "npm_package_engines_node",
    "VITEST",
    "VITEST_MODE",
    "VITEST_POOL_ID",
    "VITEST_WORKER_ID",
    "TEST",
    "FORCE_TTY",
    "npm_lifecycle_event",
    "npm_lifecycle_script",
    "npm_execpath",
    "npm_node_execpath",
    "npm_package_json",
  ])
    if (ambient[name] !== additions[name]) changed.add(name);
  assert.equal(
    changed.size,
    0,
    `Changed final worker environment keys: ${[...changed].sort().join(", ")}`,
  );
}
async function physical(file: string, directory = false) {
  assert(path.isAbsolute(file) && path.resolve(file) === file);
  const info = await fs.lstat(file);
  assert(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()));
  assert.equal(await fs.realpath(file), file, "Symlink ancestors are forbidden");
  return info;
}
async function ownedDirectory(root: string) {
  const info = await physical(root, true);
  if (process.getuid) {
    assert.equal(info.uid, process.getuid());
    assert.equal(info.mode & 0o777, 0o700);
  }
}
async function runtimeJson(root: string, name: string) {
  const file = path.join(root, name),
    info = await physical(file);
  assert(info.size <= 32 * 1024 * 1024, "H20 metadata cap");
  if (process.getuid) assert.equal(info.uid, process.getuid());
  return JSON.parse(await fs.readFile(file, "utf8"));
}
export async function resolveFinalJob(
  template: FinalJobInput,
  file: string,
  runner: string,
  source: string,
) {
  assert.deepEqual(
    Object.keys(template).sort(),
    [
      "schemaVersion",
      "boundary",
      "approvedForExecution",
      "operation",
      "runtime",
      "source",
      "ownedRoot",
      "nodeExecutable",
      "terminationTool",
      "systemRoot",
      "admission",
    ].sort(),
  );
  assert.equal(template.schemaVersion, 1);
  assert.equal(template.boundary, "CLI_FINAL18_REVIEWED_JOB_INPUT");
  assert.equal(template.approvedForExecution, true);
  assert(Object.hasOwn(scripts, template.operation));
  assert.equal(template.admission.approvedForExecution, true);
  assert.equal(template.admission.platform, process.platform);
  assert.equal(template.admission.phase, template.operation === "providers-all" ? "all" : "native");
  if (template.operation === "providers-all") assert.equal(process.platform, "linux");
  assert.equal(template.runtime, "h20");
  assert.equal(template.source.root, "@source");
  assert.equal(template.nodeExecutable.file, "@node");
  assert.equal(
    template.admission.registry,
    null,
    "Runtime registry cannot be asserted by the template",
  );
  assert(
    !Object.hasOwn(template.admission, "caller"),
    "Static input cannot assert its runtime witness",
  );
  await physical(runner, true);
  await physical(source, true);
  await physical(path.dirname(file), true);
  const registryRoot = path.join(
    runner,
    "askr-0.5-candidate-" + template.admission.manifest.sha256,
  );
  await physical(registryRoot, true);
  if (process.getuid) assert.equal((await fs.lstat(registryRoot)).uid, process.getuid());
  const owned = path.join(
    runner,
    `askr-final18-${template.operation}-${template.admission.manifest.sha256}`,
  );
  assert.equal(template.ownedRoot, "@runner/" + path.basename(owned));
  const system = process.platform === "win32" ? template.systemRoot : null;
  if (process.platform === "win32")
    assert(system && path.isAbsolute(system) && path.resolve(system) === system);
  else assert.equal(template.systemRoot, null);
  function locate(value: string): string {
    if (value === "@source") return source;
    if (value === "@node") return process.execPath;
    const roots: Record<string, string | null> = {
      "@bundle": path.dirname(file),
      "@source": source,
      "@runner": runner,
      "@registry": registryRoot,
      "@system": system,
      "@toolchain":
        process.platform === "win32"
          ? path.dirname(process.execPath)
          : path.dirname(path.dirname(process.execPath)),
    };
    const [prefix, ...parts] = value.split("/");
    assert(
      prefix &&
        roots[prefix] &&
        parts.length &&
        parts.every((part) => part && part !== "." && part !== ".." && !part.includes("\\")),
      "Closed runtime path required",
    );
    return path.join(roots[prefix]!, ...parts);
  }
  const job = structuredClone(template);
  job.source.root = locate(template.source.root);
  job.ownedRoot = locate(template.ownedRoot);
  const refs: Ref[] = [
    job.source.inventory,
    job.nodeExecutable,
    job.admission.manifest,
    job.admission.rootReadback,
    job.admission.independentReview,
    job.admission.publicHelperReadback,
    job.admission.tools.npmCli,
    job.admission.tools.openssl.executable,
    job.admission.tools.typescript6.cli,
    job.admission.tools.typescript6.packageJson,
    job.admission.tools.typescript7.cli,
    job.admission.tools.typescript7.packageJson,
    job.admission.tools.playwright.packageJson,
  ];
  if (job.terminationTool) refs.push(job.terminationTool);
  for (const browser of job.admission.tools.playwright.browsers)
    refs.push(browser.executable, browser.rootExecutable);
  for (const ref of refs) {
    ref.file = locate(ref.file);
    await physical(ref.file);
  }
  for (const row of job.admission.archives) row.archive = locate(row.archive);
  const manifest = JSON.parse((await pinned(job.admission.manifest)).toString()) as FinalManifest;
  validateManifest(manifest);
  await physical(path.join(registryRoot, "manifest.json"));
  assert.equal(
    digest(await fs.readFile(path.join(registryRoot, "manifest.json"))),
    job.admission.manifest.sha256,
  );
  const mode = await runtimeJson(registryRoot, "mode.json"),
    server = await runtimeJson(registryRoot, "server.json"),
    catalog = await runtimeJson(registryRoot, "catalog.json"),
    assembly = await runtimeJson(registryRoot, "assembly.json");
  assert.equal(mode.mode, "candidate", "Final lane requires the owned H20 candidate registry");
  assert.equal(mode.registry, server.registry);
  const registryUrl = new URL(server.registry);
  assert.equal(registryUrl.protocol, "http:");
  assert.equal(registryUrl.hostname, "127.0.0.1");
  assert(
    registryUrl.port &&
      registryUrl.pathname === "/" &&
      !registryUrl.search &&
      !registryUrl.hash &&
      !registryUrl.username &&
      !registryUrl.password,
  );
  assert.match(server.id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert(Number.isSafeInteger(server.pid) && server.pid > 0);
  assert.deepEqual(Object.keys(catalog).sort(), manifest.packages.map((row) => row.name).sort());
  assert.deepEqual(assembly.order.slice().sort(), manifest.packages.map((row) => row.name).sort());
  assert.deepEqual(
    assembly.proof.map((row: { name: string }) => row.name).sort(),
    manifest.packages.map((row) => row.name).sort(),
  );
  for (const entry of manifest.packages) {
    const recorded = catalog[entry.name],
      proof = assembly.proof.find((row: { name: string }) => row.name === entry.name),
      archive = job.admission.archives.find((row) => row.name === entry.name);
    assert(recorded && proof && archive);
    const short = entry.name.slice(8),
      artifact = path.join(registryRoot, "artifacts", short, `askrjs-${short}-0.5.0.tgz`);
    assert.equal(recorded.artifact, artifact);
    assert.equal(proof.artifact, artifact);
    assert.equal(archive.archive, artifact);
    assert.equal(proof.builderCommit, entry.commit);
    assert.equal(proof.builderTree, entry.tree);
    assert.equal(recorded.archiveSha512, entry.archiveSha512);
    assert.equal(proof.archiveSha512, entry.archiveSha512);
    assert.equal(recorded.manifest.name, entry.name);
    assert.equal(recorded.manifest.version, "0.5.0");
    const { dist, ...packageJson } = recorded.manifest;
    const packageRaw = await pinned({
      file: path.join(registryRoot, "sources", short, "package.json"),
      sha256: entry.packageJsonSha256,
    });
    assert.deepEqual(packageJson, JSON.parse(packageRaw.toString()));
    const info = await physical(artifact);
    assert(info.size <= 128 * 1024 * 1024);
    const raw = await fs.readFile(artifact),
      sri = "sha512-" + Buffer.from(entry.archiveSha512, "hex").toString("base64");
    assert.equal(digest(raw, "sha512"), entry.archiveSha512);
    assert.equal(recorded.integrity, sri);
    assert.equal(proof.integrity, sri);
    assert.equal(dist.integrity, sri);
    assert.equal(recorded.shasum, digest(raw, "sha1"));
    assert.equal(proof.shasum, recorded.shasum);
    assert.equal(dist.shasum, recorded.shasum);
    assert.equal(dist.tarball, `https://registry.npmjs.org/${entry.name}/-/${short}-0.5.0.tgz`);
  }
  job.admission.registry = { url: server.registry, id: server.id };
  return job;
}
export async function prepareFinalWorker(
  file: string,
  expected: string,
  ambient: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  // The immutable external input is pinned before any runtime witness is created.
  const ref = { file, sha256: expected };
  const template = JSON.parse((await pinned(ref)).toString()) as FinalJobInput;
  const evidence = ambient.ASKR_PROVIDER_EVIDENCE;
  assert(evidence && path.basename(evidence) === "evidence");
  const owned = path.dirname(evidence);
  assert.equal(
    path.basename(owned),
    `askr-final18-${template.operation}-${template.admission.manifest.sha256}`,
  );
  const job = await resolveFinalJob(template, file, path.dirname(owned), cwd);
  assert.deepEqual(
    Object.keys(job).sort(),
    [
      "schemaVersion",
      "boundary",
      "approvedForExecution",
      "operation",
      "runtime",
      "source",
      "ownedRoot",
      "nodeExecutable",
      "terminationTool",
      "systemRoot",
      "admission",
    ].sort(),
  );
  assert.equal(job.schemaVersion, 1);
  assert.equal(job.boundary, "CLI_FINAL18_REVIEWED_JOB_INPUT");
  assert.equal(job.approvedForExecution, true);
  assert(Object.hasOwn(scripts, job.operation));
  assert.equal(job.admission.platform, process.platform);
  assert.equal(job.admission.phase, job.operation === "providers-all" ? "all" : "native");
  if (job.operation === "providers-all") assert.equal(process.platform, "linux");
  assert.equal(cwd, job.source.root);
  assert.equal(await fs.realpath(job.source.root), job.source.root);
  assert(path.isAbsolute(job.ownedRoot) && path.resolve(job.ownedRoot) === job.ownedRoot);
  const relative = path.relative(job.source.root, job.ownedRoot);
  assert(relative && relative.startsWith(".." + path.sep), "Owned outputs must be outside source");
  await ownedDirectory(job.ownedRoot);
  for (const name of ["user.npmrc", "global.npmrc", "openssl.cnf"]) {
    const config = await physical(path.join(job.ownedRoot, name));
    assert.equal(config.size, 0, "Final parent configuration must remain empty");
  }
  const manifest = JSON.parse((await pinned(job.admission.manifest)).toString()) as FinalManifest;
  const cli = manifest.packages.find((row) => row.name === "@askrjs/cli")!;
  assert(cli);
  assert.equal(job.source.commit, cli.commit);
  assert.equal(job.source.tree, cli.tree);
  const pkgRaw = await fs.readFile(path.join(job.source.root, "package.json"));
  const pkg = JSON.parse(pkgRaw.toString()) as {
    name: string;
    version: string;
    scripts: Record<string, string>;
    bin: { askr: string };
    engines: { node: string };
    config?: unknown;
  };
  assert.equal(digest(pkgRaw), cli.packageJsonSha256);
  assert.equal(
    digest(await fs.readFile(path.join(job.source.root, "package-lock.json"))),
    cli.lockSha256,
  );
  assert.equal(pkg.name, "@askrjs/cli");
  assert.equal(pkg.version, "0.5.0");
  assert.equal(pkg.scripts[scripts[job.operation]], bodies[job.operation]);
  const inventory = JSON.parse((await pinned(job.source.inventory)).toString()) as {
    path: string;
    sha256: string;
    size: number;
    mode: string;
  }[];
  assert(inventory.length > 0 && inventory.length <= 4096);
  assert.equal(new Set(inventory.map((row) => row.path)).size, inventory.length);
  for (const row of inventory) {
    assert(row.path && !path.isAbsolute(row.path) && !row.path.includes("\\"));
    assert(
      row.path
        .split("/")
        .every(
          (part) =>
            part && part !== "." && part !== ".." && part !== ".git" && part !== "node_modules",
        ),
    );
    assert(["100644", "100755"].includes(row.mode));
    const target = path.join(job.source.root, row.path),
      info = await physical(target);
    assert(info.isFile() && !info.isSymbolicLink());
    assert.equal(info.size, row.size);
    assert.equal(digest(await pinned({ file: target, sha256: row.sha256 })), row.sha256);
    if (process.platform !== "win32")
      assert.equal(info.mode & 0o111 ? "100755" : "100644", row.mode);
  }
  await pinned(job.nodeExecutable);
  assert.equal(await fs.realpath(job.nodeExecutable.file), await fs.realpath(process.execPath));
  if (process.platform === "win32") {
    assert(job.terminationTool && job.systemRoot);
    assert.equal(
      await fs.realpath(job.terminationTool.file),
      await fs.realpath(path.join(job.systemRoot, "System32", "taskkill.exe")),
    );
    await pinned(job.terminationTool);
  } else assert.equal(job.terminationTool, null);
  for (const authority of [
    job.admission.rootReadback,
    job.admission.independentReview,
    job.admission.publicHelperReadback,
  ])
    await pinned(authority);
  for (const tool of [
    job.admission.tools.npmCli,
    job.admission.tools.openssl.executable,
    job.admission.tools.typescript6.cli,
    job.admission.tools.typescript6.packageJson,
    job.admission.tools.typescript7.cli,
    job.admission.tools.typescript7.packageJson,
    job.admission.tools.playwright.packageJson,
  ])
    await pinned(tool);
  assert.equal(pkg.config, undefined, "No package config lifecycle fields are admitted");
  await validateFinalWorkerEnvironment(job, ref, ambient, pkg);
  const admissionFile = path.join(job.ownedRoot, "admission.json"),
    callerFile = path.join(job.ownedRoot, "caller.json");
  assert.notEqual(file, admissionFile);
  assert.notEqual(file, callerFile);
  for (const output of [callerFile, admissionFile]) {
    await fs.lstat(output).then(
      () => assert.fail("Repeated final worker output"),
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }
  ambient.ASKR_FINAL18_ADMISSION = admissionFile;
  const pairs = Object.entries(ambient)
    .filter((row): row is [string, string] => row[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const witness: ParentWitness = {
    schemaVersion: 1,
    boundary: "REVIEWED_FINAL16_FINITE_PARENT",
    finiteEnvironmentReviewed: true,
    platform: job.admission.platform,
    phase: job.admission.phase,
    manifestSha256: job.admission.manifest.sha256,
    callerCommit: cli.commit,
    callerTree: cli.tree,
    cwd,
    environmentSha256: digest(
      Buffer.from(
        JSON.stringify(pairs.filter(([name]) => name !== "ASKR_FINAL18_ADMISSION_SHA256")),
      ),
    ),
    environmentKeys: pairs.map(([name]) => name),
    nodeExecutable: job.nodeExecutable,
    terminationTool: job.terminationTool,
  };
  const callerRaw = Buffer.from(JSON.stringify(witness, null, 2) + "\n");
  assert(job.admission.registry);
  const admission: FinalAdmission = {
    ...job.admission,
    registry: job.admission.registry,
    caller: { file: callerFile, sha256: digest(callerRaw) },
  };
  validateAdmission(admission, manifest);
  const admissionRaw = Buffer.from(JSON.stringify(admission, null, 2) + "\n");
  const finalRef = { file: admissionFile, sha256: digest(admissionRaw) };
  ambient.ASKR_FINAL18_ADMISSION_SHA256 = finalRef.sha256;
  validateParentWitness(witness, admission, manifest, ambient, cwd, finalRef);
  await fs.writeFile(callerFile, callerRaw, { flag: "wx", mode: 0o600 });
  await fs.writeFile(admissionFile, admissionRaw, { flag: "wx", mode: 0o600 });
  return { job, admission, witness, finalRef };
}
// Only the final parent sets this input. Ordinary/preliminary scripts have no setup.
if (process.env.ASKR_FINAL18_ADMISSION && process.env.VITEST)
  await prepareFinalWorker(
    process.env.ASKR_FINAL18_ADMISSION,
    process.env.ASKR_FINAL18_ADMISSION_SHA256!,
  );
