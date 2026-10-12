import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const scripts = {
  defaults: "test:templates:final",
  "providers-native": "test:provider-starters",
  "providers-all": "test:provider-starters",
};
const bodies = {
  defaults:
    "vp test run -c vitest.integration.config.ts tests/integration/final-packed-templates.test.ts",
  "providers-native":
    "vp test run -c vitest.integration.config.ts tests/integration/provider-starters.test.ts",
  "providers-all":
    "vp test run -c vitest.integration.config.ts tests/integration/provider-starters.test.ts",
};
const digest = (raw, algorithm = "sha256") => createHash(algorithm).update(raw).digest("hex");
async function pin(ref, cap = 32 * 1024 * 1024) {
  assert(ref && path.isAbsolute(ref.file) && /^[a-f0-9]{64}$/.test(ref.sha256));
  const info = await fs.lstat(ref.file);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= cap);
  const raw = await fs.readFile(ref.file);
  assert.equal(raw.length, info.size);
  assert.equal(digest(raw), ref.sha256);
  return raw;
}
function validateManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.release, "0.5.0");
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.toolchain, { node: "24.21.0", npm: "12.0.1" });
  assert.deepEqual(
    manifest.packages.map((row) => row.name).sort(),
    [
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
    ]
      .map((name) => "@askrjs/" + name)
      .sort(),
  );
  for (const row of manifest.packages) {
    assert.match(row.commit, /^[a-f0-9]{40}$/);
    assert.match(row.tree, /^[a-f0-9]{40}$/);
    assert.match(row.packageJsonSha256, /^[a-f0-9]{64}$/);
    assert.match(row.lockSha256, /^[a-f0-9]{64}$/);
    assert.match(row.archiveSha512, /^[a-f0-9]{128}$/);
  }
}
async function physical(file, directory = false) {
  assert(path.isAbsolute(file) && path.resolve(file) === file);
  const info = await fs.lstat(file);
  assert(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()));
  assert.equal(await fs.realpath(file), file, "Symlink ancestors are forbidden");
  return info;
}
async function ownedDirectory(root) {
  const info = await physical(root, true);
  if (process.getuid) {
    assert.equal(info.uid, process.getuid());
    assert.equal(info.mode & 0o777, 0o700);
  }
}
async function runtimeJson(root, name) {
  const file = path.join(root, name),
    info = await physical(file);
  assert(info.size <= 32 * 1024 * 1024, "H20 metadata cap");
  if (process.getuid) assert.equal(info.uid, process.getuid());
  return JSON.parse(await fs.readFile(file, "utf8"));
}
export async function resolveFinalJob(template, file, runner, source) {
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
  function locate(value) {
    if (value === "@source") return source;
    if (value === "@node") return process.execPath;
    const roots = {
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
    return path.join(roots[prefix], ...parts);
  }
  const job = structuredClone(template);
  job.source.root = locate(template.source.root);
  job.ownedRoot = locate(template.ownedRoot);
  const refs = [
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
  const manifest = JSON.parse((await pin(job.admission.manifest)).toString());
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
    assembly.proof.map((row) => row.name).sort(),
    manifest.packages.map((row) => row.name).sort(),
  );
  for (const entry of manifest.packages) {
    const recorded = catalog[entry.name],
      proof = assembly.proof.find((row) => row.name === entry.name),
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
    const packageRaw = await pin({
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
function environment(job, ref) {
  const root = job.ownedRoot;
  const home = path.join(root, "home"),
    temp = path.join(root, "tmp");
  const env = {
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
    assert(path.win32.isAbsolute(windows) && !/[\r\n;]/u.test(windows));
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
    if (job.admission.platform === "darwin")
      env.__CF_USER_TEXT_ENCODING = `0x${process.getuid().toString(16).toUpperCase()}:0x0:0x0`;
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
export async function main(operation, file, expected) {
  assert.equal(process.version, "v24.21.0");
  assert.equal(process.execArgv.length, 0);
  assert(Object.hasOwn(scripts, operation), "Closed final operation required");
  const ref = { file, sha256: expected };
  const template = JSON.parse((await pin(ref)).toString());
  for (const [name, value] of Object.entries(process.env))
    if (value)
      assert(
        !/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|BASH_ENV|ENV|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|npm_config_script_shell|npm_config_node_options|LD_.*|DYLD_.*)$/iu.test(
          name,
        ),
        `Ambient injector/proxy forbidden: ${name}`,
      );
  const runner = process.env.RUNNER_TEMP;
  assert(runner && path.isAbsolute(runner));
  const job = await resolveFinalJob(template, file, runner, process.cwd());
  assert.equal(job.schemaVersion, 1);
  assert.equal(job.boundary, "CLI_FINAL18_REVIEWED_JOB_INPUT");
  assert.equal(job.approvedForExecution, true);
  assert.equal(job.operation, operation);
  assert.equal(job.admission.approvedForExecution, true);
  assert.equal(job.admission.platform, process.platform);
  assert.equal(job.admission.phase, operation === "providers-all" ? "all" : "native");
  if (operation === "providers-all") assert.equal(process.platform, "linux");
  for (const root of [job.source.root, job.ownedRoot])
    assert(path.isAbsolute(root) && path.resolve(root) === root);
  assert(
    !(
      path.relative(job.source.root, job.ownedRoot) === "" ||
      !path.relative(job.source.root, job.ownedRoot).startsWith(".." + path.sep)
    ),
    "Owned outputs must be outside source",
  );
  assert.equal(await fs.realpath(job.source.root), job.source.root);
  assert.equal(await fs.realpath(job.nodeExecutable.file), await fs.realpath(process.execPath));
  await pin(job.nodeExecutable, 256 * 1024 * 1024);
  await pin(job.admission.tools.npmCli);
  const manifest = JSON.parse((await pin(job.admission.manifest)).toString());
  const cli = manifest.packages.find((row) => row.name === "@askrjs/cli");
  assert.equal(job.source.commit, cli.commit);
  assert.equal(job.source.tree, cli.tree);
  const pkgRaw = await pin({
    file: path.join(job.source.root, "package.json"),
    sha256: cli.packageJsonSha256,
  });
  await pin({ file: path.join(job.source.root, "package-lock.json"), sha256: cli.lockSha256 });
  const inventory = JSON.parse((await pin(job.source.inventory)).toString());
  assert(inventory.length > 0 && inventory.length <= 4096);
  assert.equal(new Set(inventory.map((row) => row.path)).size, inventory.length);
  for (const row of inventory) {
    assert(
      row.path &&
        !path.isAbsolute(row.path) &&
        !row.path.includes("\\") &&
        row.path
          .split("/")
          .every((part) => part && ![".", "..", ".git", "node_modules"].includes(part)),
    );
    assert(["100644", "100755"].includes(row.mode));
    const target = path.join(job.source.root, row.path),
      info = await physical(target);
    assert.equal(info.size, row.size);
    await pin({ file: target, sha256: row.sha256 });
    if (process.platform !== "win32")
      assert.equal(info.mode & 0o111 ? "100755" : "100644", row.mode);
  }
  for (const authority of [
    job.admission.rootReadback,
    job.admission.independentReview,
    job.admission.publicHelperReadback,
  ])
    await pin(authority);
  for (const tool of [
    job.admission.tools.openssl.executable,
    job.admission.tools.typescript6.cli,
    job.admission.tools.typescript6.packageJson,
    job.admission.tools.typescript7.cli,
    job.admission.tools.typescript7.packageJson,
    job.admission.tools.playwright.packageJson,
    ...job.admission.tools.playwright.browsers.flatMap((row) => [
      row.executable,
      row.rootExecutable,
    ]),
  ])
    await pin(tool, 256 * 1024 * 1024);
  if (job.terminationTool) {
    assert.equal(
      await fs.realpath(job.terminationTool.file),
      await fs.realpath(path.join(job.systemRoot, "System32", "taskkill.exe")),
    );
    await pin(job.terminationTool);
  } else assert.notEqual(process.platform, "win32");
  const pkg = JSON.parse(pkgRaw.toString());
  assert.equal(pkg.name, "@askrjs/cli");
  assert.equal(pkg.version, "0.5.0");
  assert.equal(pkg.scripts[scripts[operation]], bodies[operation]);
  // The existing hosted job timeout owns lifetime; no collector deadline or retry is introduced.
  await fs.mkdir(job.ownedRoot, { mode: 0o700 });
  const env = environment(job, ref);
  for (const dir of new Set(
    [
      env.HOME,
      env.TMPDIR,
      env.XDG_CONFIG_HOME,
      env.XDG_CACHE_HOME,
      env.XDG_DATA_HOME,
      env.VP_HOME,
      env.NPM_CONFIG_CACHE,
      env.NPM_CONFIG_PREFIX,
      env.APPDATA,
      env.LOCALAPPDATA,
    ].filter(Boolean),
  ))
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const name of ["user.npmrc", "global.npmrc", "openssl.cnf"])
    await fs.writeFile(path.join(job.ownedRoot, name), "", { flag: "wx", mode: 0o600 });
  const argv = [job.admission.tools.npmCli.file, "run", scripts[operation]];
  await fs.writeFile(
    path.join(job.ownedRoot, "parent-command.json"),
    JSON.stringify(
      {
        operation,
        input: ref,
        executable: job.nodeExecutable,
        args: argv,
        cwd: job.source.root,
        environmentKeys: Object.keys(env).sort(),
        environmentSha256: digest(
          Buffer.from(JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)))),
        ),
        jobTimeoutOwnsLifetime: true,
        releaseQualification: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const result = spawnSync(job.nodeExecutable.file, argv, {
    cwd: job.source.root,
    env,
    shell: false,
    windowsHide: true,
    stdio: "inherit",
  });
  await fs.writeFile(
    path.join(job.ownedRoot, "parent-exit.json"),
    JSON.stringify(
      {
        status: result.status,
        signal: result.signal,
        error: result.error ? { name: result.error.name, code: result.error.code } : null,
        processExitOnly: true,
        releaseQualification: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      "Final operation failed; preserve job logs, owned receipts and original fixtures",
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5);
  main(...process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
