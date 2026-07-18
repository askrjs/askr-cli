import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/bin/cli";
import { parseOpenApiArgs, runOpenApiCli, serializeOpenApi } from "../src/bin/openapi";

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

async function fixture(source: string): Promise<{ root: string; entry: string; output: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-openapi-"));
  const entry = path.join(root, "api.ts");
  const output = path.join(root, "openapi.yml");
  await fs.writeFile(entry, source, "utf8");
  return { root, entry, output };
}

const validModule = `
const api = {
  toOpenApiDocument() {
    return { openapi: "3.1.2", info: { title: "Fixture API", version: "1.0.0" }, paths: {} };
  },
};
export default api;
`;

describe("OpenAPI CLI", () => {
  it("parses defaults and overrides", () => {
    expect(parseOpenApiArgs([])).toEqual({
      entry: "./src/api.ts",
      output: "./openapi.yml",
      check: false,
      help: false,
      json: false,
    });
    expect(parseOpenApiArgs(["--entry", "api.ts", "--output", "contract.yml", "--check"])).toEqual({
      entry: "api.ts",
      output: "contract.yml",
      check: true,
      help: false,
      json: false,
    });
  });

  it("serializes exact ordered YAML without aliases and with one newline", () => {
    const shared = { type: "string" };
    expect(
      serializeOpenApi({
        openapi: "3.1.2",
        info: { title: "Fixture API", version: "1.0.0" },
        paths: {},
        components: { schemas: { A: shared, B: shared } },
      }),
    ).toBe(`openapi: 3.1.2
info:
  title: Fixture API
  version: 1.0.0
paths: {}
components:
  schemas:
    A:
      type: string
    B:
      type: string
`);
  });

  it("loads TypeScript and atomically generates the artifact", async () => {
    const item = await fixture(validModule);
    try {
      const result = io();
      expect(
        await runOpenApiCli(["--entry", item.entry, "--output", item.output], result.value),
      ).toBe(0);
      expect(result.errors).toEqual([]);
      expect(await fs.readFile(item.output, "utf8")).toBe(`openapi: 3.1.2
info:
  title: Fixture API
  version: 1.0.0
paths: {}
`);
      expect((await fs.readdir(item.root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it("awaits asynchronous document exporters", async () => {
    const item = await fixture(`
      export default {
        async toOpenApiDocument() {
          return { openapi: "3.1.2", info: { title: "Async", version: "1" }, paths: {} };
        },
      };
    `);
    try {
      expect(
        await runOpenApiCli(["--entry", item.entry, "--output", item.output], io().value),
      ).toBe(0);
      expect(await fs.readFile(item.output, "utf8")).toContain("title: Async");
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it("prints machine-readable generation results", async () => {
    const item = await fixture(validModule);
    try {
      const result = io();
      expect(
        await runOpenApiCli(
          ["--entry", item.entry, "--output", item.output, "--json"],
          result.value,
        ),
      ).toBe(0);
      expect(JSON.parse(result.logs[0])).toMatchObject({
        status: "ok",
        action: "generated",
        output: item.output,
      });
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it("checks fresh, stale, and missing artifacts without writing", async () => {
    const item = await fixture(validModule);
    try {
      const writes = vi.fn(async () => undefined);
      const fresh = io();
      await fs.writeFile(
        item.output,
        serializeOpenApi({
          openapi: "3.1.2",
          info: { title: "Fixture API", version: "1.0.0" },
          paths: {},
        }),
      );
      expect(
        await runOpenApiCli(
          ["--entry", item.entry, "--output", item.output, "--check"],
          fresh.value,
          { writeFile: writes },
        ),
      ).toBe(0);
      expect(fresh.logs.join("\n")).toMatch(/is current/);

      await fs.writeFile(item.output, "stale\n");
      const stale = io();
      expect(
        await runOpenApiCli(
          ["--entry", item.entry, "--output", item.output, "--check"],
          stale.value,
          { writeFile: writes },
        ),
      ).toBe(1);
      expect(stale.errors.join("\n")).toMatch(/is stale/);

      await fs.rm(item.output);
      const missing = io();
      expect(
        await runOpenApiCli(
          ["--entry", item.entry, "--output", item.output, "--check"],
          missing.value,
          { writeFile: writes },
        ),
      ).toBe(1);
      expect(missing.errors.join("\n")).toMatch(/is missing/);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["invalid default export", "export default {};", /default export with toOpenApiDocument/],
    [
      "invalid document",
      "export default { toOpenApiDocument: () => null };",
      /must return an OpenAPI document object/,
    ],
    [
      "unsupported OpenAPI version",
      'export default { toOpenApiDocument: () => ({ openapi: "2.0", info: { title: "x", version: "1" }, paths: {} }) };',
      /supported openapi/,
    ],
    [
      "missing info",
      'export default { toOpenApiDocument: () => ({ openapi: "3.1.0", paths: {} }) };',
      /info object/,
    ],
    [
      "definition error",
      "export default { toOpenApiDocument: () => { throw new Error('invalid definition') } };",
      /invalid definition/,
    ],
  ])("reports %s", async (_name, source, expected) => {
    const item = await fixture(source);
    try {
      const result = io();
      expect(
        await runOpenApiCli(["--entry", item.entry, "--output", item.output], result.value),
      ).toBe(1);
      expect(result.errors.join("\n")).toMatch(expected);
      await expect(fs.stat(item.output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it("routes the top-level openapi command", async () => {
    const item = await fixture(validModule);
    try {
      const result = io();
      expect(
        await runCli(["openapi", "--entry", item.entry, "--output", item.output], result.value),
      ).toBe(0);
      expect(await fs.readFile(item.output, "utf8")).toMatch(/^openapi: 3\.1\.2/m);
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });

  it("uses a temporary sibling before rename", async () => {
    const events: string[] = [];
    const result = io();
    const cwd = path.resolve(path.sep, "work");
    const output = path.join(cwd, "openapi.yml");
    expect(
      await runOpenApiCli([], result.value, {
        cwd: () => cwd,
        importModule: async () => ({
          default: {
            toOpenApiDocument: () => ({
              openapi: "3.1.2",
              info: { title: "Fixture", version: "1" },
              paths: {},
            }),
          },
        }),
        mkdir: async () => {
          events.push("mkdir");
        },
        writeFile: async (file) => {
          events.push(`write:${file}`);
        },
        rename: async (from, to) => {
          events.push(`rename:${from}:${to}`);
        },
        temporarySuffix: () => "fixed",
      }),
    ).toBe(0);
    expect(events).toEqual([
      "mkdir",
      `write:${output}.fixed.tmp`,
      `rename:${output}.fixed.tmp:${output}`,
    ]);
  });

  it("refuses to overwrite the source entry", async () => {
    const item = await fixture(validModule);
    try {
      const result = io();
      expect(
        await runOpenApiCli(["--entry", item.entry, "--output", item.entry], result.value),
      ).toBe(1);
      expect(result.errors.join("\n")).toMatch(/must not overwrite/);
      expect(await fs.readFile(item.entry, "utf8")).toBe(validModule);
    } finally {
      await fs.rm(item.root, { recursive: true, force: true });
    }
  });
});
