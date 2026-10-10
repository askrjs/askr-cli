import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAnalyzeConfiguration } from "../src/analyze/project";
import { runAnalysis } from "../src/analyze/runner";

const roots: string[] = [];
const identity = { file: "src/routes.ts", export: "reports" };
const rule = "askr/route-access-policy";

async function fixture(
  definition: string,
  analyze: Record<string, unknown> = { protectedRegistries: [identity] },
  extra: Record<string, string> = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-protected-registry-"));
  roots.push(root);
  const files = {
    "package.json": JSON.stringify({ name: "fixture", askr: { analyze } }),
    "src/routes.ts": `import { createRouteRegistry, route, group, page, index, fallback } from "@askrjs/askr/router";
      const View = () => null;
      const allow = () => ({ allowed: true as const });
      ${definition}`,
    ...extra,
  };
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

async function findings(root: string, workspacePatterns: string[] = []) {
  const report = await runAnalysis({ cwd: root, workspacePatterns, check: true });
  return report.diagnostics.filter((entry) => entry.ruleId === rule);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("explicit protected route registries", () => {
  it.each([
    ["missing leaf", 'route("/reports", View)', 1],
    ["direct auth", 'route("/reports", View, { auth: allow })', 0],
    ["direct policy", 'route("/reports", View, { policies: [allow] })', 0],
    ["empty policy", 'route("/reports", View, { policies: [] })', 1],
    ["undefined access", 'route("/reports", View, { auth: undefined, policies: undefined })', 1],
    ["group auth", 'group({ auth: allow }, () => route("/reports", View))', 0],
    ["group policy", 'group({ policies: [allow] }, () => route("/reports", View))', 0],
    [
      "nested inherited policy",
      'group({ policies: [allow] }, () => group({}, () => route("/reports", View)))',
      0,
    ],
    [
      "page auth",
      'page("/reports", View, { auth: allow }, () => { index(View); fallback(View); })',
      0,
    ],
    ["page without access", 'page("/reports", View, () => { index(View); fallback(View); })', 2],
    [
      "app metadata only",
      'route("/reports", View, { appMeta: { requiredGrants: ["reports"] } })',
      1,
    ],
    ["unknown options", 'route("/reports", View, options)', 0],
    [
      "late unknown spread",
      'route("/reports", View, { auth: undefined, policies: [], ...options })',
      0,
    ],
    [
      "explicit access after unknown spread",
      'route("/reports", View, { ...options, auth: undefined, policies: [] })',
      1,
    ],
    ["last auth property", 'route("/reports", View, { auth: allow, auth: undefined })', 1],
    ["literal spread", 'route("/reports", View, { ...{ auth: allow } })', 0],
    ["computed literal key", 'route("/reports", View, { ["auth"]: allow })', 0],
    ["dynamic key", 'route("/reports", View, { [key]: value })', 0],
    ["getter", 'route("/reports", View, { get auth() { return allow; } })', 0],
    ["dynamic policies", 'route("/reports", View, { policies: options })', 0],
    ["ignored callback", 'setTimeout(() => route("/later", View)); route("/reports", View)', 1],
    ["direct helper", 'const register = () => route("/reports", View); register()', 1],
    [
      "evaluated helper argument",
      'function consume(_ref: unknown) {} consume(route("/reports", View))',
      1,
    ],
    [
      "evaluated group options",
      'group({ auth: (route("/eager", View), allow) }, () => route("/reports", View, { auth: allow }))',
      1,
    ],
    [
      "evaluated page options",
      'page("/reports", View, { auth: (route("/eager", View), allow) }, () => index(View, { auth: allow }))',
      1,
    ],
    [
      "unconsumed generator helper",
      'function* register() { route("/not-registered", View); } register()',
      0,
    ],
    [
      "unconsumed generator expression",
      'const register = function* () { route("/not-registered", View); }; register()',
      0,
    ],
    [
      "inherited helper",
      'const register = () => route("/reports", View); group({ auth: allow }, register)',
      0,
    ],
    [
      "helper reused with different access",
      'const register = () => route("/reports", View); group({ auth: allow }, register); group({}, register); group({}, register)',
      1,
    ],
    ["shadowed route import", 'const route = () => {}; route("/reports", View)', 0],
    [
      "shadowed undefined",
      'const undefined = allow; route("/reports", View, { auth: undefined })',
      0,
    ],
    ["method requirement", 'route("/reports", View, { auth() { return { allowed: true }; } })', 0],
  ])("should classify %s", async (_name, body, expected) => {
    const root = await fixture(`export const reports = createRouteRegistry(() => { ${body}; });`);
    const found = await findings(root);
    expect(found).toHaveLength(expected);
    for (const entry of found) {
      expect(entry.severity).toBe("warning");
      expect(entry.file).toBe("src/routes.ts");
      expect(entry.message).toContain("reports");
      expect(entry.fix).toBeUndefined();
    }
  });

  it.each([{}, { protectedRegistries: [] }])(
    "should stay opt-in with %j",
    async (configuration) => {
      const root = await fixture(
        'export const reports = createRouteRegistry(() => route("/reports", View));',
        configuration,
      );
      expect(await findings(root)).toEqual([]);
    },
  );

  it("should preserve registry ownership for equal paths and a shared imported helper", async () => {
    const root = await fixture(
      `import { register } from "./helper";
      export const reports = createRouteRegistry(register);
      export const publicRoutes = createRouteRegistry(() => group({ auth: allow }, register));`,
      undefined,
      {
        "src/helper.ts":
          'import { route as add } from "@askrjs/askr/router"; export function register() { add("/same", () => null); }',
      },
    );
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe("src/helper.ts");
  });

  it.each([
    [
      'const selected = createRouteRegistry(() => route("/reports", View)); export { selected as reports };',
      "reports",
    ],
    ['export default createRouteRegistry(() => route("/reports", View));', "default"],
    [
      'import * as router from "@askrjs/askr/router"; export const reports = router.createRouteRegistry(() => router.route("/reports", View));',
      "reports",
    ],
  ])("should select an exact exported registry", async (source, exported) => {
    const root = await fixture(source, {
      protectedRegistries: [{ ...identity, export: exported }],
    });
    expect(await findings(root)).toHaveLength(1);
  });

  it.each(["warning", "error", "info", "off"])(
    "should preserve %s severity and deterministic read-only analysis",
    async (severity) => {
      const root = await fixture(
        'export const reports = createRouteRegistry(() => route("/reports", View));',
        {
          protectedRegistries: [identity],
          rules: { [rule]: severity },
        },
      );
      const before = await fs.readFile(path.join(root, "src/routes.ts"), "utf8");
      const first = await findings(root);
      expect(first).toHaveLength(severity === "off" ? 0 : 1);
      if (first.length) expect(first[0].severity).toBe(severity);
      expect(await findings(root)).toEqual(first);
      expect(await fs.readFile(path.join(root, "src/routes.ts"), "utf8")).toBe(before);
    },
  );

  it.each([
    null,
    {},
    [null],
    [{ file: "", export: "reports" }],
    [{ file: "../routes.ts", export: "reports" }],
    [{ file: "/routes.ts", export: "reports" }],
    [{ file: "C:\\routes.ts", export: "reports" }],
    [{ file: "src/*.ts", export: "reports" }],
    [{ file: "src/routes.ts", export: "" }],
    [identity, { file: "src/../src/routes.ts", export: "reports" }],
  ])("should reject malformed protected registry configuration %j", (value) => {
    expect(() =>
      readAnalyzeConfiguration({ askr: { analyze: { protectedRegistries: value } } }),
    ).toThrow(/protectedRegistries/);
  });

  it.each([
    "export const other = createRouteRegistry(() => {});",
    "export const reports = unknownFactory(() => {});",
    "export const reports = createRouteRegistry(dynamicDefinition);",
    "export let reports = createRouteRegistry(() => {});",
    "let define = () => {}; export const reports = createRouteRegistry(define);",
    "export const reports = createRouteRegistry(async () => {});",
    'function* define() { route("/not-registered", View); } export const reports = createRouteRegistry(define);',
    'export const reports = createRouteRegistry(function* () { route("/not-registered", View); });',
  ])("should reject an unprovable selected registry identity", async (source) => {
    const root = await fixture(source);
    await expect(findings(root)).rejects.toThrow(/protectedRegistries.*src\/routes.ts.*reports/);
  });

  it("should reject a selected missing source file", async () => {
    const root = await fixture("", {
      protectedRegistries: [{ file: "src/missing.ts", export: "reports" }],
    });
    await expect(findings(root)).rejects.toThrow(/protectedRegistries.*src\/missing.ts/);
  });

  it("should validate selected identities even when diagnostics are off", async () => {
    const root = await fixture("export const other = createRouteRegistry(() => {});", {
      protectedRegistries: [identity],
      rules: { [rule]: "off" },
    });
    await expect(findings(root)).rejects.toThrow(/protectedRegistries/);
  });

  it("should validate only identities owned by selected workspaces", async () => {
    const root = await fixture(
      "",
      {},
      {
        "package.json": JSON.stringify({
          name: "root",
          workspaces: ["packages/*"],
          askr: {
            analyze: {
              protectedRegistries: [{ file: "packages/private/src/routes.ts", export: "reports" }],
            },
          },
        }),
        "packages/private/package.json": JSON.stringify({ name: "private" }),
        "packages/public/package.json": JSON.stringify({ name: "public" }),
        "packages/public/src/view.ts": "export const value = 1;",
      },
    );
    expect(await findings(root, ["public"])).toEqual([]);
    await expect(findings(root, ["private"])).rejects.toThrow(/protectedRegistries/);
  });
});
