import fs from "node:fs/promises";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";

const [target, fault] = process.argv.slice(2);
const rename = fs.rename.bind(fs);
const writeFile = fs.writeFile.bind(fs);
const rm = fs.rm.bind(fs);
const readdir = fs.readdir.bind(fs);
const stat = fs.stat.bind(fs);
const lstat = fs.lstat.bind(fs);
let backup = "";
let stage = "";
let injected = false;
const failure = (code: string) => Object.assign(new Error(`injected ${fault}`), { code });
async function checkpoint(phase: string) {
  if (fault !== phase) return;
  process.send!({ phase, backup, stage });
  await new Promise<void>((resolve) => process.once("message", () => resolve()));
}
fs.rename = async (from, to) => {
  if (String(from) === target) {
    backup = String(to);
    await checkpoint("prepared");
    if (fault === "original-rename-failure") {
      injected = true;
      throw failure("EIO");
    }
  }
  if (fault === "rollback-failure" && String(to) === target) {
    injected = true;
    throw failure("EIO");
  }
  if (fault === "create-publish-failure" && String(to) === target) {
    injected = true;
    throw failure("EIO");
  }
  await rename(from, to);
  if (String(from) === target) await checkpoint("backed-up");
  else if (String(to) === target) await checkpoint("published");
};
fs.writeFile = async (name, ...args) => {
  if (path.basename(String(name)) === "schemas.ts" && path.dirname(String(name)) !== target) {
    stage = path.dirname(String(name));
    if (fault === "partial-stage-write" || fault === "stage-cleanup-failure") {
      injected = true;
      await writeFile(name, "partial");
      throw failure("ENOSPC");
    }
  }
  return writeFile(name, ...args);
};
fs.rm = async (name, ...args) => {
  if (fault === "partial-backup-cleanup" && String(name) === backup && !injected) {
    injected = true;
    await rm(path.join(backup, "schemas.ts"));
    throw failure("EACCES");
  }
  if (fault === "stage-cleanup-failure" && String(name) === stage) throw failure("EACCES");
  return rm(name, ...args);
};
fs.readdir = (async (...args: Parameters<typeof fs.readdir>) => {
  if (fault === "target-read-denied" && String(args[0]) === target) {
    injected = true;
    throw failure("EACCES");
  }
  return readdir(...args);
}) as typeof fs.readdir;
fs.stat = (async (...args: Parameters<typeof fs.stat>) => {
  if (fault === "target-stat-denied" && String(args[0]) === target) {
    injected = true;
    throw failure("EACCES");
  }
  return stat(...args);
}) as typeof fs.stat;
fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
  if (fault === "target-stat-denied" && String(args[0]) === target) {
    injected = true;
    throw failure("EACCES");
  }
  return lstat(...args);
}) as typeof fs.lstat;
// The generator currently imports named built-ins. Exercise their real Node
// bindings, including on the immutable pre-fix implementation.
syncBuiltinESMExports();
const { writeGenerated } = await import("../../src/generate/generator");
let error: { message: string; code?: string; causes?: string[] } | undefined;
let logs: string[] | undefined;
let commandCode: number | undefined;
try {
  if (fault.startsWith("create-")) {
    childProcess.spawnSync = (() => {
      if (fault !== "create-publish-failure") injected = true;
      return {
        pid: 0,
        output: [],
        stdout: null,
        stderr: null,
        status: fault === "create-publish-failure" ? 0 : 1,
        signal: null,
        error:
          fault === "create-install-timeout"
            ? failure("ETIMEDOUT")
            : fault === "create-install-missing"
              ? failure("ENOENT")
              : undefined,
      };
    }) as unknown as typeof childProcess.spawnSync;
    syncBuiltinESMExports();
    const { runCreateCli } = await import("../../src/bin/create");
    logs = [];
    commandCode = await runCreateCli(["spa", "test-app", "--dir", target, "--no-skills"], {
      log: (message) => {
        logs!.push(message);
      },
      error: (message) => {
        logs!.push(message);
      },
    });
  } else {
    await writeGenerated(
      target,
      { ".askr-generated.json": "new manifest", "schemas.ts": "new schema" },
      false,
    );
  }
} catch (caught) {
  const value = caught as NodeJS.ErrnoException;
  error = {
    message: value.message,
    code: value.code,
    causes:
      caught instanceof AggregateError ? caught.errors.map((item) => item.message) : undefined,
  };
}
process.send!({ done: true, error, backup, stage, injected, logs, commandCode });
process.disconnect!();
