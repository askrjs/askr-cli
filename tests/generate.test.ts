import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
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
      Unused: { type: "string" },
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
  it("should type-check schema references given a generated client", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-generated-types-"));
    const output = join(root, "generated");
    await writeGenerated(output, generateFiles(document), false);
    const fetchTypes = join(root, "fetch.d.ts");
    await writeFile(
      fetchTypes,
      [
        'declare module "@askrjs/fetch" {',
        "  export interface ClientOptions {}",
        "  export interface Descriptor {",
        "    params<T>(value: unknown): Descriptor;",
        "    query<T>(value: unknown): Descriptor;",
        "    returns(value: unknown): Descriptor;",
        "    errors(value: unknown): Descriptor;",
        "    security(value: unknown): Descriptor;",
        "  }",
        "  export function defineApi(value: unknown, options: unknown): unknown;",
        "  export function createClient(value: unknown, options?: ClientOptions): unknown;",
        "  export function get(path: string): Descriptor;",
        "  export function json<T>(): unknown;",
        "}",
      ].join("\n"),
    );
    const program = ts.createProgram({
      rootNames: [
        fetchTypes,
        ...["schemas.ts", "operations.ts", "api.ts", "index.ts"].map((file) => join(output, file)),
      ],
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        strict: true,
        skipLibCheck: true,
        noUnusedLocals: true,
        noEmit: true,
      },
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

    expect(errors).toEqual([]);
  });
  it("should include an exact pointer given an unsupported operation when rendering", () => {
    const invalid: any = structuredClone(document);
    invalid.paths["/users/{id}"].get.callbacks = {};
    expect(() => generateFiles(invalid)).toThrow(
      /getUser: Callbacks are unsupported at #\/paths\/.*\/get\/callbacks/,
    );
  });
  it("should render OpenAPI 3.1 type arrays given nullable schemas", () => {
    const nullable: any = structuredClone(document);
    nullable.components.schemas.Maybe = { type: ["string", "null"] };
    nullable.components.schemas.Numeric = { type: ["integer", "number", "null"] };
    const files = generateFiles(nullable);
    expect(files["schemas.ts"]).toContain("export type Maybe = string | null;");
    expect(files["schemas.ts"]).toContain("export type Numeric = number | null;");
  });
  it("should let operation parameters override path parameters by name and location", () => {
    const overridden: any = structuredClone(document);
    overridden.paths["/users/{id}"].parameters = [
      { in: "path", name: "id", required: true, schema: { type: "number" } },
      { in: "query", name: "include", schema: { type: "number" } },
    ];
    overridden.paths["/users/{id}"].get.parameters = [
      { in: "path", name: "id", required: true, schema: { type: "string" } },
      { in: "query", name: "include", schema: { type: "boolean" } },
    ];
    const operations = generateFiles(overridden)["operations.ts"];
    expect(operations).toContain('"id": string;');
    expect(operations).not.toContain('"id": number;');
    expect(operations).toContain('"include"?: boolean;');
    expect(operations.match(/"include"\?/g)).toHaveLength(1);
  });
  it.each([
    ["missing declaration", [], /is not declared/],
    [
      "optional declaration",
      [{ in: "path", name: "id", required: false, schema: { type: "string" } }],
      /must be required/,
    ],
    [
      "extraneous declaration",
      [
        { in: "path", name: "id", required: true, schema: { type: "string" } },
        { in: "path", name: "other", required: true, schema: { type: "string" } },
      ],
      /not present in the path template/,
    ],
  ])("should reject %s given invalid path parameters", (_label, parameters, expected) => {
    const invalid: any = structuredClone(document);
    invalid.paths["/users/{id}"].get.parameters = parameters;
    expect(() => generateFiles(invalid)).toThrow(expected);
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
  it("should preserve a file mistakenly supplied as the output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-output-file-"));
    const output = join(root, "contract.json");
    await writeFile(output, "keep");
    await expect(writeGenerated(output, generateFiles(document), false)).rejects.toThrow(
      /must be a directory/,
    );
    expect(await readFile(output, "utf8")).toBe("keep");
  });
  it("should preserve generated output when its backup rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-stale-backup-"));
    const output = join(root, "generated");
    const backup = `${output}.backup-${process.pid}`;
    await mkdir(output);
    await writeFile(join(output, ".askr-generated.json"), "original manifest\n");
    await writeFile(join(output, "schemas.ts"), "original schema\n");
    await mkdir(backup);
    await writeFile(join(backup, "stale.txt"), "stale backup\n");

    await expect(writeGenerated(output, generateFiles(document), false)).rejects.toThrow();

    expect(await readFile(join(output, ".askr-generated.json"), "utf8")).toBe(
      "original manifest\n",
    );
    expect(await readFile(join(output, "schemas.ts"), "utf8")).toBe("original schema\n");
    expect(await readFile(join(backup, "stale.txt"), "utf8")).toBe("stale backup\n");
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
  it("should reject output that contains the input document without mutating it", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-contained-input-"));
    const input = join(root, "openapi.json");
    await writeFile(input, JSON.stringify(document));
    expect(await runGenerateCli([input, "--output", root], { log() {}, error() {} })).toBe(1);
    expect(JSON.parse(await readFile(input, "utf8"))).toMatchObject({ openapi: "3.1.0" });
  });
  it("should print machine-readable output given json mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-cli-generate-json-"));
    const input = join(root, "openapi.json");
    const output = join(root, "generated");
    await writeFile(input, JSON.stringify(document));
    const logs: string[] = [];
    expect(
      await runGenerateCli([input, "--output", output, "--json"], {
        log: (message) => logs.push(message),
        error: (message) => logs.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(logs[0])).toEqual({ status: "ok", action: "generated", output });
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
  it("should reject local references escaping the specification directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "askr-openapi-boundary-"));
    const root = join(parent, "spec");
    await mkdir(root);
    await writeFile(join(parent, "outside.yaml"), "type: string");
    await writeFile(
      join(root, "openapi.yaml"),
      [
        "openapi: 3.1.0",
        "info: { title: Boundary, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    Escape: { $ref: '../outside.yaml' }",
      ].join("\n"),
    );
    await expect(loadOpenApi(join(root, "openapi.yaml"))).rejects.toThrow(
      "escapes the specification directory",
    );
  });
  it("should reject symlink and remote-to-file reference pivots", async () => {
    const parent = await mkdtemp(join(tmpdir(), "askr-openapi-pivot-"));
    const root = join(parent, "spec");
    await mkdir(root);
    await writeFile(join(parent, "outside.yaml"), "type: string");
    await symlink(join(parent, "outside.yaml"), join(root, "linked.yaml"));
    const writeRoot = async (ref: string) =>
      writeFile(
        join(root, "openapi.yaml"),
        [
          "openapi: 3.1.0",
          "info: { title: Pivot, version: '1' }",
          "paths: {}",
          "components:",
          "  schemas:",
          `    Escape: { $ref: '${ref}' }`,
        ].join("\n"),
      );
    await writeRoot("./linked.yaml");
    await expect(loadOpenApi(join(root, "openapi.yaml"))).rejects.toThrow(
      "escapes the specification directory",
    );
    await writeRoot(pathToFileURL(join(parent, "outside.yaml")).href);
    await expect(loadOpenApi(join(root, "openapi.yaml"))).rejects.toThrow(
      "escapes the specification directory",
    );
  });
  it("should enforce bounded reference depth and response size", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-openapi-limits-"));
    await writeFile(
      join(root, "deep.yaml"),
      [
        "openapi: 3.1.0",
        "info: { title: Deep, version: '1' }",
        "paths: {}",
        "components:",
        "  schemas:",
        "    A: { $ref: './b.yaml' }",
      ].join("\n"),
    );
    await writeFile(join(root, "b.yaml"), "{ $ref: './c.yaml' }");
    await writeFile(join(root, "c.yaml"), "type: string");
    await expect(loadOpenApi(join(root, "deep.yaml"), { maxDepth: 1 })).rejects.toThrow(
      "reference depth exceeds",
    );
    await expect(loadOpenApi(join(root, "deep.yaml"), { maxBytes: 10 })).rejects.toThrow(
      "exceeds 10 bytes",
    );
  });
  it("should strictly validate remote reference origins and numeric limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-openapi-options-"));
    const input = join(root, "openapi.yaml");
    await writeFile(input, "openapi: 3.1.0\ninfo: { title: Options, version: '1' }\npaths: {}\n");
    for (const origin of [
      "http://example.com",
      "https://user@example.com",
      "https://example.com/path",
      "https://example.com/?query=1",
      "https://example.com/#fragment",
    ]) {
      await expect(loadOpenApi(input, { allowedReferenceOrigins: [origin] })).rejects.toThrow(
        "must be an HTTPS origin",
      );
    }
    for (const options of [
      { timeoutMs: 0 },
      { maxBytes: -1 },
      { maxDepth: Number.MAX_SAFE_INTEGER + 1 },
      { maxRedirects: 1.5 },
    ]) {
      await expect(loadOpenApi(input, options)).rejects.toThrow("positive safe integer");
    }
  });
  it("should accept and validate all bounded-reference CLI flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "askr-openapi-cli-limits-"));
    const input = join(root, "openapi.yaml");
    const output = join(root, "generated");
    await writeFile(input, "openapi: 3.1.0\ninfo: { title: Options, version: '1' }\npaths: {}\n");
    const io = { log() {}, error() {} };
    expect(
      await runGenerateCli(
        [
          input,
          "-o",
          output,
          "--ref-timeout-ms",
          "1000",
          "--ref-max-bytes",
          "10000",
          "--ref-max-depth",
          "8",
          "--ref-max-redirects",
          "2",
        ],
        io,
      ),
    ).toBe(0);
    expect(await runGenerateCli([input, "-o", output, "--ref-max-bytes", "0"], io)).toBe(1);
  });
  it("should reject unknown and missing options given invalid CLI arguments when parsing", async () => {
    const io = { log() {}, error() {} };
    expect(await runGenerateCli(["x", "--wat", "-o", "y"], io)).toBe(1);
    expect(await runGenerateCli(["x"], io)).toBe(1);
    expect(await runGenerateCli(["x", "y", "-o", "z"], io)).toBe(1);
  });
});
