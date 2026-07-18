import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runGenerateCli } from "../src/bin/generate";
import { generateFiles, loadOpenApi, writeGenerated } from "../src/generate/generator";

const document = {
  openapi: "3.1.0",
  info: { title: "Users", version: "1" },
  servers: [{ url: "https://api.example.test" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: {
      User: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, parent: { $ref: "#/components/schemas/User" } },
      },
    },
  },
  paths: {
    "/users/{id}": {
      get: {
        operationId: "getUser",
        security: [{ bearer: [] }],
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "include",
            style: "form",
            explode: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "ok",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
          "404": {
            description: "missing",
            content: {
              "application/problem+json": {
                schema: { type: "object", properties: { title: { type: "string" } } },
              },
            },
          },
        },
      },
    },
  },
};

describe("askr generate", () => {
  it("should generate deterministic files given recursive OpenAPI 3.1 when rendering", () => {
    const first = generateFiles(document);
    const second = generateFiles(structuredClone(document));
    expect(second).toEqual(first);
    expect(first["schemas.ts"]).toContain('"parent"?: User');
    expect(first["api.ts"]).toContain('getUser: get("/users/{id}")');
    expect(first["api.ts"]).toContain(
      'params<GetUserPath>({ "id": { style: "simple", explode: false } })',
    );
    expect(first["api.ts"]).toContain(
      'query<GetUserQuery>({ "include": { style: "form", explode: true } })',
    );
    expect(first["api.ts"]).toContain("securitySchemes");
  });
  it("should include an exact pointer given an unsupported operation when rendering", () => {
    const invalid: any = structuredClone(document);
    invalid.paths["/users/{id}"].get.callbacks = {};
    expect(() => generateFiles(invalid)).toThrow(
      /getUser: Callbacks are unsupported at #\/paths\/.*\/get\/callbacks/,
    );
  });
  it("should require operation ids given an operation when rendering", () => {
    const invalid: any = structuredClone(document);
    delete invalid.paths["/users/{id}"].get.operationId;
    expect(() => generateFiles(invalid)).toThrow(/operationId is required/);
  });
  it("should refuse unowned output given a nonempty directory when writing", async () => {
    const output = await mkdtemp(join(tmpdir(), "askr-unowned-"));
    await writeFile(join(output, "mine.txt"), "keep");
    await expect(writeGenerated(output, generateFiles(document), false)).rejects.toThrow(
      /Refusing to overwrite/,
    );
    expect(await readFile(join(output, "mine.txt"), "utf8")).toBe("keep");
  });
  it("should detect stale and extra files without writes given check mode when checking", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-check-"));
    const output = join(root, "client");
    const files = generateFiles(document);
    await writeGenerated(output, files, false);
    await writeFile(join(output, "extra.ts"), "x");
    await expect(writeGenerated(output, files, true)).rejects.toThrow(/ownership differs/);
    expect((await readdir(output)).sort()).toContain("extra.ts");
  });
  it("should load JSON and route output given valid CLI arguments when generating", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-cli-generate-"));
    const input = join(root, "openapi.json");
    const output = join(root, "generated");
    await writeFile(input, JSON.stringify(document));
    const messages: string[] = [];
    expect(
      await runGenerateCli([input, "--output", output], {
        log: (m) => messages.push(m),
        error: (m) => messages.push(m),
      }),
    ).toBe(0);
    expect(await readdir(output)).toEqual(expect.arrayContaining(["api.ts", "schemas.ts"]));
    expect(await runGenerateCli([input, "-o", output, "--check"], { log() {}, error() {} })).toBe(
      0,
    );
  });
  it("should bundle repeated and recursive external schemas given a file reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-external-openapi-"));
    await writeFile(
      join(root, "models.yaml"),
      [
        "components:",
        "  schemas:",
        "    User:",
        "      type: object",
        "      required: [id]",
        "      properties:",
        "        id: { type: string }",
        "        parent: { $ref: '#/components/schemas/User' }",
      ].join("\n"),
    );
    await writeFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.1.0",
        "info: { title: External, version: '1' }",
        "paths:",
        "  /first:",
        "    get:",
        "      operationId: first",
        "      responses:",
        "        '200': { description: ok, content: { application/json: { schema: { $ref: './models.yaml#/components/schemas/User' } } } }",
        "  /second:",
        "    get:",
        "      operationId: second",
        "      responses:",
        "        '200': { description: ok, content: { application/json: { schema: { $ref: './models.yaml#/components/schemas/User' } } } }",
      ].join("\n"),
    );
    const bundled = await loadOpenApi(join(root, "openapi.yaml"));
    expect(bundled.paths["/first"].get.responses["200"].content["application/json"].schema).toEqual(
      { $ref: "#/components/schemas/User" },
    );
    expect(
      bundled.paths["/second"].get.responses["200"].content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/User" });
    expect(bundled.components.schemas.User.properties.parent).toEqual({
      $ref: "#/components/schemas/User",
    });
  });
  it("should reject unknown and missing options given invalid CLI arguments when parsing", async () => {
    const io = { log() {}, error() {} };
    expect(await runGenerateCli(["x", "--wat", "-o", "y"], io)).toBe(1);
    expect(await runGenerateCli(["x"], io)).toBe(1);
    expect(await runGenerateCli(["x", "y", "-o", "z"], io)).toBe(1);
  });
});
