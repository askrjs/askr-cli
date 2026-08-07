import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAnalysis } from "../src/analyze/runner";
import { parseAnalyzeArgs, runAnalyzeCli } from "../src/bin/analyze";
import { runCli } from "../src/bin/cli";
import { writeFileChanges } from "../src/file-changes";

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

async function workspaceFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-cli-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "root", workspaces: ["packages/*"] }, null, 2)}\n`,
  );
  for (const name of ["a", "b"]) {
    const directory = path.join(root, "packages", name);
    await fs.mkdir(path.join(directory, "src"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "package.json"),
      `${JSON.stringify({ name, dependencies: { "@askrjs/askr": "^0.0.70" } }, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(directory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            jsx: "react-jsx",
            jsxImportSource: "@askrjs/askr",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(directory, "src", "page.tsx"),
      `import { state } from "@askrjs/askr";\nconst ${name} = state(0);\n`,
    );
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("analyze CLI", () => {
  it("should parse repeated workspace filters and command options", () => {
    expect(
      parseAnalyzeArgs([
        "--cwd",
        "./fixture",
        "--workspace=a*",
        "--workspace",
        "b",
        "--json",
        "--check",
      ]),
    ).toMatchObject({
      cwd: path.resolve("./fixture"),
      workspacePatterns: ["a*", "b"],
      json: true,
      check: true,
    });
    expect(() => parseAnalyzeArgs(["--workspace"])).toThrow(/requires a value/);
    expect(() => parseAnalyzeArgs(["--unknown"])).toThrow(/unknown option/i);
  });

  it("should scan all workspaces by default and filter repeated selections deterministically", async () => {
    const root = await workspaceFixture();
    const all = await runAnalysis({ cwd: root, workspacePatterns: [], check: true });
    const selected = await runAnalysis({ cwd: root, workspacePatterns: ["b"], check: true });

    expect(all.discoveredWorkspaces).toEqual(["root", "a", "b"]);
    expect(all.selectedWorkspaces).toEqual(["root", "a", "b"]);
    expect(all.diagnostics.map((entry) => entry.workspace)).toEqual(["a", "b"]);
    expect(selected.selectedWorkspaces).toEqual(["b"]);
    expect(selected.diagnostics.map((entry) => entry.workspace)).toEqual(["b"]);
  });

  it("should emit deterministic JSON and a blocking exit code", async () => {
    const root = await workspaceFixture();
    const output = io();
    expect(await runAnalyzeCli(["--cwd", root, "--json", "--check"], output.value)).toBe(1);
    expect(output.errors).toEqual([]);
    const report = JSON.parse(output.logs[0]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      selectedWorkspaces: ["root", "a", "b"],
      summary: { errors: 2, diagnostics: 2 },
    });
    expect(output.logs[0]).toBe(JSON.stringify(report));
  });

  it("should dispatch through the unified CLI and print human diagnostics", async () => {
    const root = await workspaceFixture();
    const output = io();
    expect(
      await runCli(["analyze", "--cwd", root, "--workspace", "a", "--check"], output.value),
    ).toBe(1);
    expect(output.logs.join("\n")).toContain("a:src/page.tsx:2");
    expect(output.logs.at(-1)).toMatch(/Analyzed 1 workspace/);
  });

  it("should keep check mode immutable and apply a safe config fix transactionally by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-fix-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        { name: "fixture", dependencies: { "@askrjs/askr": "^0.0.70" } },
        null,
        2,
      )}\n`,
    );
    const tsconfigPath = path.join(root, "tsconfig.json");
    const before = `${JSON.stringify(
      {
        compilerOptions: { jsx: "react-jsx", module: "ESNext", moduleResolution: "Bundler" },
        include: ["src"],
      },
      null,
      2,
    )}\n`;
    await fs.writeFile(tsconfigPath, before);
    await fs.writeFile(
      path.join(root, "src", "page.tsx"),
      "export function Page() { return <main />; }\n",
    );

    const checked = await runAnalysis({ cwd: root, workspacePatterns: [], check: true });
    expect(checked.skippedFixes).toEqual([
      expect.objectContaining({
        ruleId: "askr/framework-config",
        reason: expect.stringMatching(/check/),
      }),
    ]);
    expect(await fs.readFile(tsconfigPath, "utf8")).toBe(before);

    const fixed = await runAnalysis({ cwd: root, workspacePatterns: [], check: false });
    expect(fixed.appliedFixes).toEqual([
      expect.objectContaining({ ruleId: "askr/framework-config" }),
    ]);
    expect(fixed.diagnostics).toEqual([]);
    expect(JSON.parse(await fs.readFile(tsconfigPath, "utf8"))).toMatchObject({
      compilerOptions: { jsx: "react-jsx", jsxImportSource: "@askrjs/askr" },
    });
  });

  it("should apply safe route path fixes but leaves semantic collection findings unresolved", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-semantic-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "fixture" }, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            jsx: "react-jsx",
            jsxImportSource: "@askrjs/askr",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    );
    const filePath = path.join(root, "src", "routes.tsx");
    await fs.writeFile(
      filePath,
      `
        import { state } from "@askrjs/askr";
        import { createRouteRegistry, route } from "@askrjs/askr/router";
        export const registry = createRouteRegistry(() => {
          route("/users/:id", Page);
        });
        function Page() {
          const [items] = state([1, 2]);
          return <main>{items().map((item) => <i>{item}</i>)}</main>;
        }
      `,
    );

    const report = await runAnalysis({ cwd: root, workspacePatterns: [], check: false });
    expect(report.appliedFixes).toEqual([
      expect.objectContaining({ ruleId: "askr/route-path-syntax" }),
    ]);
    expect(report.diagnostics).toEqual([expect.objectContaining({ ruleId: "askr/prefer-for" })]);
    expect(await fs.readFile(filePath, "utf8")).toContain('route("/users/{id}", Page)');
  });

  it("should not mutate files when transactional writing fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-rollback-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        { name: "fixture", dependencies: { "@askrjs/askr": "^0.0.70" } },
        null,
        2,
      )}\n`,
    );
    const tsconfigPath = path.join(root, "tsconfig.json");
    const before = '{"compilerOptions":{"jsx":"react-jsx"},"include":["src"]}\n';
    const routePath = path.join(root, "src", "routes.tsx");
    const routeBefore = `
      import { createRouteRegistry, route } from "@askrjs/askr/router";
      export const registry = createRouteRegistry(() => route("/users/:id", () => null));
    `;
    await fs.writeFile(tsconfigPath, before);
    await fs.writeFile(routePath, routeBefore);
    let replacements = 0;
    const writer = vi.fn(async (changes: Parameters<typeof writeFileChanges>[0]) => {
      await writeFileChanges(changes, {
        async replace(temporaryPath, filePath) {
          replacements += 1;
          if (replacements === 2) throw new Error("injected replacement failure");
          await fs.rename(temporaryPath, filePath);
        },
      });
    });

    await expect(
      runAnalysis({ cwd: root, workspacePatterns: [], check: false, writer }),
    ).rejects.toThrow("completed changes were rolled back");
    expect(await fs.readFile(tsconfigPath, "utf8")).toBe(before);
    expect(await fs.readFile(routePath, "utf8")).toBe(routeBefore);
  });
});
