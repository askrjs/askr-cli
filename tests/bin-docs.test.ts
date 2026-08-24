import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsCli } from "../src/bin/docs";

const roots: string[] = [];

function io() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    value: {
      log: (...values: unknown[]) => logs.push(values.join(" ")),
      error: (...values: unknown[]) => errors.push(values.join(" ")),
    },
    logs,
    errors,
  };
}

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-bin-docs-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@fixture/docs", exports: { ".": { types: "./dist/index.d.ts" } } }),
  );
  await fs.writeFile(
    path.join(root, "dist/index.d.ts"),
    "/** A documented value. */\nexport declare const value: string;\n",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("docs CLI entry", () => {
  it("should expose help and reject unknown subcommands", async () => {
    const help = io();
    await expect(runDocsCli(["--help"], help.value)).resolves.toBe(0);
    expect(help.logs.join("\n")).toContain("askr docs check|snapshot");

    const unknown = io();
    await expect(runDocsCli(["unknown"], unknown.value)).resolves.toBe(1);
    expect(unknown.errors).toEqual(["Unknown docs command: unknown"]);
  });

  it("should emit deterministic JSON and write an explicit snapshot", async () => {
    const root = await fixture();
    const checked = io();
    await expect(runDocsCli(["check", "--root", root, "--json"], checked.value)).resolves.toBe(0);
    expect(JSON.parse(checked.logs[0]!)).toEqual([]);

    const snapshot = io();
    await expect(
      runDocsCli(
        ["snapshot", `--root=${root}`, "--output", "audit/docs.json", "--json"],
        snapshot.value,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(snapshot.logs[0]!)).toMatchObject({ symbols: 1, diagnostics: 0 });
    await expect(fs.readFile(path.join(root, "audit/docs.json"), "utf8")).resolves.toContain(
      '"name": "value"',
    );
  });

  it("should report inspection failures in human and JSON modes", async () => {
    const missing = path.join(os.tmpdir(), `askr-missing-docs-${process.pid}`);
    const human = io();
    await expect(runDocsCli(["check", "--root", missing], human.value)).resolves.toBe(1);
    expect(human.errors.join("\n")).toContain("Documentation check failed:");

    const json = io();
    await expect(runDocsCli(["check", `--root=${missing}`, "--json"], json.value)).resolves.toBe(1);
    expect(JSON.parse(json.logs[0]!)).toMatchObject({ error: expect.any(String) });
  });
});
