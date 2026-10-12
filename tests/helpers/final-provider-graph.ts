import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { request } from "node:http";
import semver from "semver";
import { inspectKnownViteOwnedDiagnostic } from "./preliminary-archives";

export const finalNames = [
  "askr",
  "auth",
  "charts",
  "cli",
  "fetch",
  "i18n",
  "logos",
  "lucide",
  "monaco",
  "node",
  "orm",
  "otel",
  "schema",
  "server",
  "testing",
  "themes",
  "ui",
  "vite",
].map((name) => `@askrjs/${name}`);
const forbiddenSDKs = [
  "@auth0/auth0-spa-js",
  "auth0-js",
  "@azure/msal-browser",
  "@azure/msal-node",
  "@azure/msal-common",
  "google-auth-library",
  "apple-signin-auth",
];
export interface Ref {
  file: string;
  sha256: string;
}
export interface ArchiveFile {
  path: string;
  mode: number;
  sha256: string;
  size: number;
}
export interface ArchiveRecord {
  name: string;
  archive: string;
  archiveSha512: string;
  packageJsonSha256: string;
  files: ArchiveFile[];
}
export interface FinalManifest {
  schemaVersion: number;
  release: string;
  complete: boolean;
  toolchain: { node: string; npm: string };
  packages: {
    name: string;
    repo: string;
    commit: string;
    tree: string;
    packageJsonSha256: string;
    lockSha256: string;
    archiveSha512: string;
  }[];
}
export interface FinalAdmission {
  schemaVersion: number;
  boundary: string;
  approvedForExecution: boolean;
  platform: string;
  phase: "native" | "all";
  manifest: Ref;
  rootReadback: Ref;
  independentReview: Ref;
  publicHelperReadback: Ref;
  caller: Ref;
  helper: { commit: string; tree: string };
  registry: { url: string; id: string };
  archives: ArchiveRecord[];
  tools: {
    npmCli: Ref;
    openssl: { executable: Ref; version: string };
    typescript6: { cli: Ref; packageJson: Ref; version: string };
    typescript7: { cli: Ref; packageJson: Ref; version: string };
    playwright: {
      packageJson: Ref;
      version: string;
      browsers: { name: string; executable: Ref; rootExecutable: Ref }[];
    };
  };
}
export const digest = (raw: Uint8Array, algorithm = "sha256") =>
  createHash(algorithm).update(raw).digest("hex");
// The new matrix never forwards the caller's credentials, shell hooks, proxies,
// package configuration or ASKR_* authority to a generated product child.
export function ownedEnvironment(
  ambient: NodeJS.ProcessEnv,
  platform: string,
  root: string,
  nodeExecutable: string,
  opensslExecutable: string,
): Record<string, string> {
  const paths = platform === "win32" ? path.win32 : path.posix;
  for (const value of [root, nodeExecutable, opensslExecutable])
    assert(paths.isAbsolute(value), "Owned environment paths must be absolute");
  for (const [name, value] of Object.entries(ambient))
    if (value)
      assert(
        !/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|BASH_ENV|ENV|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|npm_config_script_shell|npm_config_node_options|LD_.*|DYLD_.*)$/iu.test(
          name,
        ),
        `Ambient injector/proxy is forbidden for final16: ${name}`,
      );
  const home = paths.join(root, "owned-home"),
    temp = paths.join(root, "owned-temp");
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    USER: "owned-final16",
    LOGNAME: "owned-final16",
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    XDG_CONFIG_HOME: paths.join(home, "config"),
    XDG_CACHE_HOME: paths.join(home, "cache"),
    XDG_DATA_HOME: paths.join(home, "data"),
    NPM_CONFIG_USERCONFIG: paths.join(root, "owned.npmrc"),
    NPM_CONFIG_GLOBALCONFIG: paths.join(root, "empty.npmrc"),
    NPM_CONFIG_CACHE: paths.join(root, "npm-cache"),
    NPM_CONFIG_IGNORE_SCRIPTS: "false",
    OPENSSL_CONF: paths.join(root, "owned-openssl.cnf"),
    NO_COLOR: "1",
    CI: "1",
    LANG: "C.UTF-8",
    TZ: "UTC",
  };
  let system: string[];
  if (platform === "win32") {
    const roots = Object.entries(ambient).filter(([name]) => /^SystemRoot$/iu.test(name));
    assert.equal(roots.length, 1, "Exactly one platform SystemRoot is required");
    const windows = roots[0]![1]!;
    assert(paths.isAbsolute(windows) && !/[\r\n;]/u.test(windows));
    env.SystemRoot = windows;
    env.WINDIR = windows;
    env.ComSpec = paths.join(windows, "System32", "cmd.exe");
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    env.APPDATA = paths.join(home, "AppData", "Roaming");
    env.LOCALAPPDATA = paths.join(home, "AppData", "Local");
    system = [paths.join(windows, "System32"), windows];
  } else {
    assert(["linux", "darwin"].includes(platform));
    system = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  }
  env.PATH = [
    ...new Set([paths.dirname(nodeExecutable), paths.dirname(opensslExecutable), ...system]),
  ].join(platform === "win32" ? ";" : ":");
  return env;
}
export interface ParentWitness {
  schemaVersion: number;
  boundary: string;
  finiteEnvironmentReviewed: boolean;
  platform: string;
  phase: string;
  manifestSha256: string;
  callerCommit: string;
  callerTree: string;
  cwd: string;
  environmentSha256: string;
  environmentKeys: string[];
  nodeExecutable: Ref;
  terminationTool: Ref | null;
}
export function validateParentWitness(
  witness: ParentWitness,
  input: FinalAdmission,
  manifest: FinalManifest,
  ambient: NodeJS.ProcessEnv,
  cwd: string,
  verifiedAdmission: Ref,
) {
  assert.equal(witness.schemaVersion, 1);
  assert.equal(witness.boundary, "REVIEWED_FINAL16_FINITE_PARENT");
  assert.equal(witness.finiteEnvironmentReviewed, true);
  assert.equal(witness.platform, input.platform);
  assert.equal(witness.phase, input.phase);
  assert.equal(witness.manifestSha256, input.manifest.sha256);
  const cli = manifest.packages.find((row) => row.name === "@askrjs/cli")!;
  assert.equal(witness.callerCommit, cli.commit);
  assert.equal(witness.callerTree, cli.tree);
  assert.equal(witness.cwd, cwd);
  assert(path.isAbsolute(verifiedAdmission.file));
  assert.match(verifiedAdmission.sha256, /^[a-f0-9]{64}$/);
  assert.equal(ambient.ASKR_FINAL18_ADMISSION, verifiedAdmission.file);
  assert.equal(ambient.ASKR_FINAL18_ADMISSION_SHA256, verifiedAdmission.sha256);
  assert.equal(
    ambient.VP_HOME,
    path.join(path.dirname(input.caller.file), "home", "data", "vite-plus"),
  );
  const pairs = Object.entries(ambient)
    .filter((row): row is [string, string] => row[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const allowed =
    /^(?:HOME|USERPROFILE|USER|LOGNAME|TMPDIR|TMP|TEMP|XDG_CONFIG_HOME|XDG_CACHE_HOME|XDG_DATA_HOME|VP_HOME|PATH|PWD|SHLVL|_|SystemRoot|WINDIR|ComSpec|PATHEXT|APPDATA|LOCALAPPDATA|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|LANG|LC_ALL|TZ|CI|NO_COLOR|FORCE_COLOR|NODE|NODE_ENV|OPENSSL_CONF|ASKR_FINAL18_ADMISSION|ASKR_FINAL18_ADMISSION_SHA256|ASKR_PROVIDER_EVIDENCE|ASKR_PROVIDER_PHASE|VITEST|VITEST_MODE|VITEST_POOL_ID|VITEST_WORKER_ID|TEST|FORCE_TTY|JS_RUNTIME_NAME|JS_RUNTIME_VERSION|NODE_PACKAGE_MANAGER|VP_VERSION|BASE_URL|MODE|DEV|PROD|SSR|COLOR|EDITOR|INIT_CWD|npm_execpath|npm_node_execpath|npm_lifecycle_event|npm_lifecycle_script|npm_command|npm_package_json|npm_package_name|npm_package_version|npm_package_bin_askr|npm_package_engines_node|npm_config_(?:user_agent|local_prefix|prefix|global_prefix|userconfig|globalconfig|cache|ignore_scripts|registry|update_notifier|metrics_registry|node_gyp|npm_version|allow_scripts|global_ignore_file|init_module|noproxy))$/iu;
  for (const [name, value] of pairs) {
    if (name === "__CF_USER_TEXT_ENCODING") {
      assert.equal(input.platform, "darwin");
      assert.equal(process.platform, "darwin");
      assert.equal(typeof process.getuid, "function");
      assert.equal(value, `0x${process.getuid!().toString(16).toUpperCase()}:0x0:0x0`);
    } else {
      assert(
        allowed.test(name),
        `Unexpected parent environment key is not an admitted finite boundary: ${name}`,
      );
    }
  }
  assert.deepEqual(
    witness.environmentKeys,
    pairs.map(([name]) => name),
  );
  assert.equal(
    witness.environmentSha256,
    // The admission pins this witness, so its separately verified digest cannot hash itself.
    // The digest key remains in environmentKeys and its actual value is checked above.
    digest(
      Buffer.from(
        JSON.stringify(pairs.filter(([name]) => name !== "ASKR_FINAL18_ADMISSION_SHA256")),
      ),
    ),
    "Actual parent environment must equal its separately reviewed hash; values are never retained",
  );
  assert(witness.nodeExecutable && witness.nodeExecutable.sha256);
  if (input.platform === "win32") assert(witness.terminationTool);
  else assert.equal(witness.terminationTool, null);
}
export async function pinned(ref: Ref): Promise<Buffer> {
  assert(ref && path.isAbsolute(ref.file), "An admitted absolute file is required");
  assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  const info = await fs.lstat(ref.file);
  assert(info.isFile() && !info.isSymbolicLink());
  const raw = await fs.readFile(ref.file);
  assert.equal(digest(raw), ref.sha256, ref.file);
  return raw;
}
export function validateManifest(value: FinalManifest) {
  assert.deepEqual(
    Object.keys(value).sort(),
    ["schemaVersion", "release", "complete", "toolchain", "packages"].sort(),
  );
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.release, "0.5.0");
  assert.equal(value.complete, true);
  assert.deepEqual(value.toolchain, { node: "24.21.0", npm: "12.0.1" });
  assert.deepEqual(value.packages.map((row) => row.name).sort(), [...finalNames].sort());
  for (const row of value.packages) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ["name", "repo", "commit", "tree", "packageJsonSha256", "lockSha256", "archiveSha512"].sort(),
    );
    assert.equal(
      row.repo,
      row.name === "@askrjs/askr" ? "askrjs/askr" : `askrjs/askr-${row.name.slice(8)}`,
    );
    assert.match(row.commit, /^[a-f0-9]{40}$/);
    assert.match(row.tree, /^[a-f0-9]{40}$/);
    assert.match(row.packageJsonSha256, /^[a-f0-9]{64}$/);
    assert.match(row.lockSha256, /^[a-f0-9]{64}$/);
    assert.match(row.archiveSha512, /^[a-f0-9]{128}$/);
  }
}
export function validateAdmission(input: FinalAdmission, manifest: FinalManifest) {
  validateManifest(manifest);
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.boundary, "CLI_PROVIDER_STARTERS_FINAL18");
  assert(
    input.caller && path.isAbsolute(input.caller.file),
    "Reviewed finite parent witness required; product child env alone does not own taskkill/library children",
  );
  assert.match(input.caller.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    input.approvedForExecution,
    true,
    "Final18 execution requires independent admission",
  );
  assert(["linux", "darwin", "win32"].includes(input.platform));
  assert(["native", "all"].includes(input.phase));
  if (input.phase === "all") assert.equal(input.platform, "linux");
  assert.match(input.helper.commit, /^[a-f0-9]{40}$/);
  assert.match(input.helper.tree, /^[a-f0-9]{40}$/);
  const registry = new URL(input.registry.url);
  assert.equal(registry.protocol, "http:");
  assert.equal(registry.hostname, "127.0.0.1");
  assert(
    registry.port &&
      registry.pathname === "/" &&
      !registry.search &&
      !registry.hash &&
      !registry.username &&
      !registry.password,
  );
  assert.match(input.registry.id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.deepEqual(input.archives.map((row) => row.name).sort(), [...finalNames].sort());
  for (const row of input.archives) {
    const coordinate = manifest.packages.find((item) => item.name === row.name)!;
    assert.equal(row.archiveSha512, coordinate.archiveSha512);
    assert.equal(row.packageJsonSha256, coordinate.packageJsonSha256);
    assert(path.isAbsolute(row.archive));
    assert(row.files.length > 0);
    assert.equal(new Set(row.files.map((file) => file.path)).size, row.files.length);
    for (const file of row.files) {
      assert(file.path && !path.isAbsolute(file.path) && !file.path.includes("\\"));
      assert(file.path.split("/").every((part) => part && part !== "." && part !== ".."));
      assert([0o644, 0o755].includes(file.mode));
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert(Number.isSafeInteger(file.size) && file.size >= 0);
    }
    assert.equal(
      row.files.find((file) => file.path === "package.json")?.sha256,
      coordinate.packageJsonSha256,
    );
  }
  assert.equal(input.tools.typescript6.version, "6.0.2");
  assert.equal(input.tools.typescript7.version, "7.0.2");
  assert(typeof input.tools.openssl.version === "string" && input.tools.openssl.version.length > 0);
  assert.equal(input.tools.playwright.version, "1.63.0");
  assert.deepEqual(
    input.tools.playwright.browsers.map((row) => row.name).sort(),
    input.phase === "all" ? ["chromium", "firefox", "webkit"] : [],
  );
}
export function validateRanges(manifest: Record<string, unknown>) {
  let count = 0;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const entries = (manifest[field] ?? {}) as Record<string, string>;
    for (const [name, range] of Object.entries(entries)) {
      if (!name.startsWith("@askrjs/")) continue;
      assert(finalNames.includes(name), `Unknown declared Askr dependency ${name}`);
      assert(
        semver.validRange(range) && semver.satisfies("0.5.0", range),
        `Original emitted range does not admit final18: ${name}=${range}`,
      );
      count++;
    }
  }
  assert(count > 0, "Generated product must declare its original Askr dependencies");
}
export async function graphRequest(registry: string, pathname: string) {
  const url = new URL(pathname, registry);
  assert.equal(url.origin, new URL(registry).origin);
  return new Promise<{ status: number; raw: Buffer }>((resolve, reject) => {
    let settled = false;
    let response: import("node:http").IncomingMessage | undefined;
    const req = request(url, { agent: false, headers: { connection: "close" } });
    const timer = setTimeout(
      () => finish(new Error("Owned graph request absolute deadline")),
      2000,
    );
    function finish(error?: Error, result?: { status: number; raw: Buffer }) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response?.destroy();
      req.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Missing graph response"));
    }
    req.on("error", finish);
    req.on("response", (res) => {
      response = res;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) finish(new Error("Graph response body cap"));
        else chunks.push(chunk);
      });
      res.on("error", finish);
      res.on("aborted", () => finish(new Error("Truncated graph response")));
      res.on("end", () =>
        finish(undefined, { status: res.statusCode!, raw: Buffer.concat(chunks) }),
      );
    });
    req.end();
  });
}
export async function loadFinalAdmission(file: string | undefined, expected: string | undefined) {
  assert(
    file && expected,
    "Explicit final18 admission file and SHA256 are required; preliminary13 is insufficient",
  );
  const input = JSON.parse((await pinned({ file, sha256: expected })).toString()) as FinalAdmission;
  const manifestRaw = await pinned(input.manifest);
  const manifest = JSON.parse(manifestRaw.toString()) as FinalManifest;
  validateAdmission(input, manifest);
  const parent = JSON.parse((await pinned(input.caller)).toString()) as ParentWitness;
  validateParentWitness(parent, input, manifest, process.env, process.cwd(), {
    file,
    sha256: expected,
  });
  assert.equal(await fs.realpath(parent.nodeExecutable.file), await fs.realpath(process.execPath));
  await pinned(parent.nodeExecutable);
  if (process.platform === "win32") {
    const windows = Object.entries(process.env).find(([name]) => /^SystemRoot$/iu.test(name))?.[1];
    assert(windows && parent.terminationTool);
    assert.equal(
      await fs.realpath(parent.terminationTool.file),
      await fs.realpath(path.join(windows, "System32", "taskkill.exe")),
    );
    await pinned(parent.terminationTool);
    try {
      await fs.lstat(path.join(process.cwd(), "taskkill.exe"));
      assert.fail("Current-directory taskkill shadow is forbidden");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // These are separately reviewed public/helper/catalog/artifact authorities, not workflow success or self-adoption.
  for (const ref of [input.rootReadback, input.independentReview, input.publicHelperReadback])
    await pinned(ref);
  for (const row of input.archives) {
    const info = await fs.lstat(row.archive);
    assert(info.isFile() && !info.isSymbolicLink());
    assert.equal(digest(await fs.readFile(row.archive), "sha512"), row.archiveSha512);
  }
  for (const ref of [
    input.tools.npmCli,
    input.tools.openssl.executable,
    input.tools.typescript6.cli,
    input.tools.typescript6.packageJson,
    input.tools.typescript7.cli,
    input.tools.typescript7.packageJson,
    input.tools.playwright.packageJson,
  ])
    await pinned(ref);
  const health = await graphRequest(input.registry.url, "/__askr-health");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.raw.toString()).id, input.registry.id);
  const actual = await graphRequest(input.registry.url, "/__askr-candidate-graph.json");
  assert.equal(actual.status, 200);
  assert.equal(digest(actual.raw), input.manifest.sha256);
  assert.deepEqual(JSON.parse(actual.raw.toString()), manifest);
  assert.equal((await graphRequest(input.registry.url, "/@askrjs/not-in-final18")).status, 404);
  return { input, manifest, manifestRaw, parent };
}
export async function verifyInstalled(
  project: string,
  graph: Awaited<ReturnType<typeof loadFinalAdmission>>,
) {
  const lockRaw = await fs.readFile(path.join(project, "package-lock.json"));
  const lock = JSON.parse(lockRaw.toString()) as {
    lockfileVersion: number;
    packages: Record<
      string,
      { name?: string; version?: string; resolved?: string; integrity?: string; link?: boolean }
    >;
  };
  assert.equal(lock.lockfileVersion, 3);
  const found = new Set<string>(),
    lockOwners = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const packageName = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u.exec(key)?.[1];
    assert(
      !packageName || !forbiddenSDKs.includes(packageName),
      `Unexpected provider SDK ${packageName}`,
    );
    const match = /(?:^|\/)node_modules\/(@askrjs\/[^/]+)$/.exec(key);
    if (!match) continue;
    assert(
      !path.isAbsolute(key) &&
        !key.includes("\\") &&
        key.split("/").every((part) => part && part !== "." && part !== ".."),
      "Unsafe lock package path",
    );
    const row = graph.input.archives.find((candidate) => candidate.name === match[1]);
    assert(row, `Unknown Askr owner ${key}`);
    lockOwners.add(key);
    assert.equal(entry.link, undefined);
    assert.equal(entry.version, "0.5.0");
    assert.equal(
      entry.integrity,
      `sha512-${Buffer.from(row.archiveSha512, "hex").toString("base64")}`,
    );
    assert(entry.resolved);
    const resolved = new URL(entry.resolved);
    const archivePath = `/${row.name}/-/${row.name.slice(8)}-0.5.0.tgz`;
    assert(
      [new URL(graph.input.registry.url).origin, "https://registry.npmjs.org"].includes(
        resolved.origin,
      ),
    );
    assert.equal(resolved.pathname, archivePath);
    assert(!resolved.search && !resolved.hash);
    const directory = path.join(project, key);
    const info = await fs.lstat(directory);
    assert(info.isDirectory() && !info.isSymbolicLink());
    assert.equal(
      await fs.realpath(directory),
      path.resolve(project, key),
      "Installed package ancestors must not redirect through symlinks",
    );
    const present: string[] = [];
    async function walk(relative = "") {
      for (const child of await fs.readdir(path.join(directory, relative), {
        withFileTypes: true,
      })) {
        if (!relative && child.name === "node_modules") continue;
        const name = path.posix.join(relative, child.name);
        assert(!child.isSymbolicLink(), `${key}/${name}`);
        if (child.isDirectory()) await walk(name);
        else {
          assert(child.isFile());
          present.push(name);
        }
      }
    }
    await walk();
    assert.deepEqual(present.sort(), row.files.map((file) => file.path).sort(), key);
    for (const file of row.files) {
      const p = path.join(directory, file.path),
        info = await fs.lstat(p);
      assert.equal(info.size, file.size);
      assert.equal(digest(await fs.readFile(p)), file.sha256, `${key}/${file.path}`);
      if (process.platform !== "win32")
        assert.equal(info.mode & 0o777, file.mode, `${key}/${file.path} mode`);
    }
    found.add(row.name);
  }
  const physicalOwners = new Set<string>();
  async function modules(relative: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(project, relative), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".bin" || entry.name.startsWith(".")) continue;
      assert(
        !entry.isSymbolicLink(),
        "Installed package directory link is not an admitted archive",
      );
      if (!entry.isDirectory()) continue;
      const packagePaths = entry.name.startsWith("@")
        ? (await fs.readdir(path.join(project, relative, entry.name))).map((name) =>
            path.posix.join(relative, entry.name, name),
          )
        : [path.posix.join(relative, entry.name)];
      for (const name of packagePaths) {
        const packageName = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u.exec(name)?.[1];
        assert(
          !packageName || !forbiddenSDKs.includes(packageName),
          `Physical provider SDK ${packageName}`,
        );
        if (/(?:^|\/)node_modules\/@askrjs\/[^/]+$/u.test(name)) physicalOwners.add(name);
        await modules(path.posix.join(name, "node_modules"));
      }
    }
  }
  await modules("node_modules");
  assert.deepEqual(
    [...physicalOwners].sort(),
    [...lockOwners].sort(),
    "Every physical Askr package depth must be declared in the admitted lock",
  );
  assert(found.size > 0);
  return { lockRaw, installed: [...found].sort() };
}

export async function inventoryGeneratedSource(directory: string) {
  const rows: { path: string; sha256: string; mode: number }[] = [];
  async function walk(relative = "") {
    for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (
        ["node_modules", "dist", "package-lock.json", ".provider-types.json"].includes(entry.name)
      )
        continue;
      assert(!entry.isSymbolicLink());
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else {
        const full = path.join(directory, name);
        rows.push({
          path: name,
          sha256: digest(await fs.readFile(full)),
          mode: (await fs.stat(full)).mode & 0o777,
        });
      }
    }
  }
  await walk();
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export async function installFreshFinal(
  project: string,
  graph: Awaited<ReturnType<typeof loadFinalAdmission>>,
  npm: (args: string[], cwd: string) => Promise<string>,
) {
  const manifestRaw = await fs.readFile(path.join(project, "package.json"));
  await npm(["install"], project);
  const initial = await verifyInstalled(project, graph);
  await npm(["ci"], project);
  const fresh = await verifyInstalled(project, graph);
  assert(fresh.lockRaw.equals(initial.lockRaw), "Fresh ci must preserve the exact generated lock");
  assert((await fs.readFile(path.join(project, "package.json"))).equals(manifestRaw));
  return { initial, fresh };
}

// An exact known peer limitation is characterized, never relabelled as peer-clean.
// No preliminary request/projection is read; final graph admission stays at callers.
export async function finalNpmListing(
  project: string,
  evidence: string,
  graph: Awaited<ReturnType<typeof loadFinalAdmission>>,
  npm: (args: string[], cwd: string) => Promise<string>,
) {
  try {
    await npm(["ls", "--all", "--json"], project);
  } catch (error) {
    await inspectKnownViteOwnedDiagnostic(
      project,
      evidence,
      error,
      async (command, args, cwd) => {
        assert.equal(command, "npm");
        assert.deepEqual(args, ["ls", "--all", "--json"]);
        return npm(args, cwd);
      },
      graph.input.tools.npmCli.file,
    );
  }
}
