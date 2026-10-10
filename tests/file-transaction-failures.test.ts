import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileChanges } from "../src/file-changes";
import { writeManifestEdits } from "../src/update/writer";

const roots: string[] = [];
const original = '{"dependencies":{"foo":"1.0.0"}}\n';
const replacement = '{"dependencies":{"foo":"1.1.0"}}\n';
type Replace = (from: string, to: string) => Promise<void>;

const writers = [
  {
    name: "file changes",
    async write(files: string[], replace: Replace) {
      await writeFileChanges(
        files.map((filePath) => ({ filePath, content: replacement, expectedContent: original })),
        { replace },
      );
    },
  },
  {
    name: "manifest edits",
    async write(files: string[], replace: Replace) {
      await writeManifestEdits(
        files.map((manifestPath) => ({
          manifestPath,
          section: "dependencies" as const,
          package: "foo",
          currentSpecification: "1.0.0",
          proposedSpecification: "1.1.0",
        })),
        { replace },
      );
    },
  },
];

async function fixture(): Promise<{ root: string; files: string[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-file-failure-"));
  roots.push(root);
  const files = [path.join(root, "a.json"), path.join(root, "b.json")];
  await Promise.all(files.map((file) => fs.writeFile(file, original)));
  return { root, files };
}

// Inject the same disk-write fault through either Node filesystem API, retaining
// real exclusive creation, partial bytes and file-handle cleanup.
function failOnePartialWrite(pattern: RegExp): () => number {
  let failures = 0;
  const writeFile = fs.writeFile.bind(fs);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "writeFile").mockImplementation(async (...args) => {
    if (failures === 0 && pattern.test(String(args[0]))) {
      await writeFile(args[0], "partial", args[2]);
      failures += 1;
      throw Object.assign(new Error("injected full disk"), { code: "ENOSPC" });
    }
    return writeFile(...args);
  });
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (pattern.test(String(args[0]))) {
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, "writeFile").mockImplementation(async (...writeArgs) => {
        if (failures === 0) {
          await write("partial");
          failures += 1;
          throw Object.assign(new Error("injected full disk"), { code: "ENOSPC" });
        }
        return write(...writeArgs);
      });
    }
    return handle;
  });
  return () => failures;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe.each(writers)("$name filesystem failure recovery", ({ write }) => {
  it("retains the original recovery copy and names it when rollback rename fails", async () => {
    const { root, files } = await fixture();
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(from).includes(".askr-rollback-")) {
        throw Object.assign(new Error("injected restore failure"), { code: "EACCES" });
      }
      await rename(from, to);
    });
    let replacements = 0;
    const failure = await write(files, async (from, to) => {
      if (++replacements === 2) throw new Error("injected second replacement failure");
      await rename(from, to);
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const recovery = (await fs.readdir(root)).filter((name) => name.includes(".askr-rollback-"));
    expect(recovery).toHaveLength(1);
    expect(await fs.readFile(path.join(root, recovery[0]), "utf8")).toBe(original);
    expect((failure as Error).message).toContain(JSON.stringify(path.join(root, recovery[0])));
    expect((failure as Error).message).toContain(JSON.stringify(files[0]));
    expect(await fs.readFile(files[0], "utf8")).toBe(replacement);
    expect(await fs.readFile(files[1], "utf8")).toBe(original);
    expect(
      (await fs.readdir(root)).some((name) => /\.askr-(?:change|update|lock)/.test(name)),
    ).toBe(false);
  });

  it("aborts before replacements when writing an original recovery copy fails", async () => {
    const { root, files } = await fixture();
    const failures = failOnePartialWrite(/\.askr-rollback-/);
    let replacements = 0;
    const rename = fs.rename.bind(fs);
    await expect(
      write(files, async (from, to) => {
        if (++replacements === 2) throw new Error("injected second replacement failure");
        await rename(from, to);
      }),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(failures()).toBe(1);
    expect(replacements).toBe(0);
    expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual([
      original,
      original,
    ]);
    expect((await fs.readdir(root)).sort()).toEqual(["a.json", "b.json"]);
  });

  it("cleans partially written replacement files without changing either target", async () => {
    const { root, files } = await fixture();
    const failures = failOnePartialWrite(/\.askr-(?:change|update)-/);
    await expect(write(files, fs.rename)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(failures()).toBe(1);
    expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual([
      original,
      original,
    ]);
    expect((await fs.readdir(root)).sort()).toEqual(["a.json", "b.json"]);
  });

  it.skipIf(process.platform === "win32").each([false, true])(
    "preserves existing permissions under a restrictive umask (rollback: %s)",
    async (rollback) => {
      const { files } = await fixture();
      await Promise.all(files.map((file) => fs.chmod(file, 0o660)));
      const previousUmask = process.umask(0o077);
      let replacements = 0;
      try {
        const operation = write(files, async (from, to) => {
          if (rollback && ++replacements === 2) throw new Error("injected replacement failure");
          await fs.rename(from, to);
        });
        if (rollback) await expect(operation).rejects.toThrow("rolled back");
        else await operation;
        expect(
          await Promise.all(files.map(async (file) => (await fs.stat(file)).mode & 0o777)),
        ).toEqual([0o660, 0o660]);
      } finally {
        process.umask(previousUmask);
      }
    },
  );

  it("preserves an unrelated file when exclusive stage creation collides", async () => {
    const { root, files } = await fixture();
    const open = fs.open.bind(fs);
    let collision: string | undefined;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (!collision && /\.askr-change-/.test(String(args[0]))) {
        collision = String(args[0]);
        await fs.writeFile(collision, "unrelated");
      }
      return open(...args);
    });
    await expect(write(files, fs.rename)).rejects.toMatchObject({ code: "EEXIST" });
    expect(collision).toBeDefined();
    expect(await fs.readFile(collision!, "utf8")).toBe("unrelated");
    expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual([
      original,
      original,
    ]);
    expect((await fs.readdir(root)).sort()).toEqual([
      path.basename(collision!),
      "a.json",
      "b.json",
    ]);
  });
});

it("rejects a stat permission error instead of treating an existing file as absent", async () => {
  const { files } = await fixture();
  vi.spyOn(fs, "stat").mockRejectedValueOnce(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  await expect(
    writeFileChanges([{ filePath: files[0], content: replacement }]),
  ).rejects.toMatchObject({ code: "EACCES" });
  expect(await fs.readFile(files[0], "utf8")).toBe(original);
});

it("preserves an unrelated manifest edit made after the planning read", async () => {
  const { root, files } = await fixture();
  const changed = '{"name":"changed","dependencies":{"foo":"1.0.0"}}\n';
  const readFile = fs.readFile.bind(fs);
  let changedAfterRead = false;
  vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
    const contents = await readFile(...args);
    if (String(args[0]) === files[0] && !changedAfterRead) {
      changedAfterRead = true;
      await fs.writeFile(files[0], changed);
    }
    return contents;
  });
  await expect(writers[1].write(files, fs.rename)).rejects.toThrow("File changed before writing");
  expect(changedAfterRead).toBe(true);
  expect(await fs.readFile(files[0], "utf8")).toBe(changed);
  expect(await fs.readFile(files[1], "utf8")).toBe(original);
  expect((await fs.readdir(root)).sort()).toEqual(["a.json", "b.json"]);
});

it.skipIf(process.platform === "win32")(
  "honors the current umask when creating a new file",
  async () => {
    const { root } = await fixture();
    const created = path.join(root, "created.ts");
    const previousUmask = process.umask(0o077);
    try {
      await writeFileChanges([{ filePath: created, content: "new" }]);
      expect((await fs.stat(created)).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
    }
  },
);

it("reports a newly created file when rollback cannot remove it and restores existing files", async () => {
  const { root, files } = await fixture();
  const created = path.join(root, "0-created.ts");
  const remove = fs.rm.bind(fs);
  vi.spyOn(fs, "rm").mockImplementation(async (...args) => {
    if (String(args[0]) === created) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return remove(...args);
  });
  let replacements = 0;
  await expect(
    writeFileChanges(
      [
        { filePath: created, content: "new" },
        ...files.map((filePath) => ({ filePath, content: replacement })),
      ],
      {
        replace: async (from, to) => {
          if (++replacements === 3) throw new Error("injected replacement failure");
          await fs.rename(from, to);
        },
      },
    ),
  ).rejects.toThrow(`Remove the newly created file ${JSON.stringify(created)}`);
  expect(await fs.readFile(created, "utf8")).toBe("new");
  expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual([
    original,
    original,
  ]);
  expect((await fs.readdir(root)).sort()).toEqual(["0-created.ts", "a.json", "b.json"]);
});

it("retains complete originals after process termination and permits a recovered retry", async () => {
  const { root, files } = await fixture();
  const worker = fileURLToPath(
    new URL("./fixtures/file-transaction-crash-worker.ts", import.meta.url),
  );
  const child = fork(worker, files, { execArgv: ["--import", "tsx"], silent: true });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const checkpoint = new Promise<unknown>((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`Crash worker exited before checkpoint: ${stderr}`)));
  });
  try {
    expect(await checkpoint).toBe("first-replacement");
    expect(child.kill("SIGKILL")).toBe(true);
    const [code, signal] = await exited;
    expect(code !== 0 || signal !== null).toBe(true);
    expect(await fs.readFile(files[0], "utf8")).toBe(replacement);
    expect(await fs.readFile(files[1], "utf8")).toBe(original);
    const recovery = (await fs.readdir(root)).filter((name) => name.includes(".askr-rollback-"));
    expect(recovery).toHaveLength(2);
    for (const file of files) {
      const backup = recovery.find((name) =>
        name.startsWith(`.${path.basename(file)}.askr-rollback-`),
      );
      expect(backup).toBeDefined();
      expect(await fs.readFile(path.join(root, backup!), "utf8")).toBe(original);
      await fs.rename(path.join(root, backup!), file);
    }
    const abandoned = (await fs.readdir(root)).filter((name) => name.includes(".askr-change-"));
    expect(abandoned).toHaveLength(1);
    expect(await fs.readFile(path.join(root, abandoned[0]), "utf8")).toBe(replacement);
    await fs.rm(path.join(root, abandoned[0]));
    await writers[1].write(files, fs.rename);
    expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual([
      replacement,
      replacement,
    ]);
    expect((await fs.readdir(root)).sort()).toEqual(["a.json", "b.json"]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}, 10_000);
