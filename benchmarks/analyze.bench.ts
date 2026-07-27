import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, bench, describe, expect } from "vite-plus/test";
import { createWorkspaceAnalysisContext, readAnalyzeConfiguration } from "../src/analyze/project";
import { ANALYZE_RULES } from "../src/analyze/rules";
import { runAnalysis } from "../src/analyze/runner";
import { discoverWorkspaceProject } from "../src/update/discovery";
import { uncoveredAnalyzeRuleIds } from "./analyze-workloads";

const roots: string[] = [];
const benchOptions = {
  iterations: 8,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
} as const;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function componentSource(index: number): string {
  return `
    import { For, derive, resource, state } from "@askrjs/askr";

    export function Page${index}() {
      const [items] = state([{ id: ${index}, label: "Item ${index}" }]);
      const count = derive(() => items().length);
      const status = resource(({ signal }) =>
        fetch("/api/items/${index}", { signal }), [count()]);
      return <main data-count={count()} data-pending={status.pending}>
        <For each={items()} by={(item) => item.id}>
          {(item) => <span>{item.label}</span>}
        </For>
      </main>;
    }
  `;
}

async function createWorkspace(
  root: string,
  relativeDirectory: string,
  name: string,
  sourceCount: number,
): Promise<void> {
  const directory = path.join(root, relativeDirectory);
  await writeJson(path.join(directory, "package.json"), {
    name,
    dependencies: { "@askrjs/askr": "^0.0.70" },
  });
  await writeJson(path.join(directory, "tsconfig.json"), {
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "@askrjs/askr",
      module: "ESNext",
      moduleResolution: "Bundler",
      target: "ES2022",
    },
    include: ["src"],
  });
  await fs.mkdir(path.join(directory, "src"), { recursive: true });
  await fs.mkdir(path.join(directory, ".askr", "client", "assets"), { recursive: true });
  await fs.writeFile(
    path.join(directory, ".askr", "client", "assets", "generated.js"),
    "export function BundledPage() { const value = new Set(); return value.size; }\n",
  );
  await Promise.all(
    Array.from({ length: sourceCount }, (_, index) =>
      fs.writeFile(
        path.join(directory, "src", `page-${String(index).padStart(4, "0")}.tsx`),
        componentSource(index),
      ),
    ),
  );
}

async function createSingleWorkspaceFixture(sourceCount: number): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-bench-single-"));
  roots.push(root);
  await createWorkspace(root, ".", "single-app", sourceCount);
  return root;
}

async function createMonorepoFixture(
  workspaceCount: number,
  sourcesPerWorkspace: number,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-bench-monorepo-"));
  roots.push(root);
  await writeJson(path.join(root, "package.json"), {
    name: "bench-root",
    workspaces: ["packages/*"],
  });
  await Promise.all(
    Array.from({ length: workspaceCount }, (_, index) =>
      createWorkspace(
        root,
        path.join("packages", `app-${index}`),
        `app-${index}`,
        sourcesPerWorkspace,
      ),
    ),
  );
  return root;
}

async function createDiagnosticFixture(): Promise<string> {
  const root = await createSingleWorkspaceFixture(0);
  await writeJson(path.join(root, "package.json"), {
    name: "diagnostic-heavy",
    dependencies: {
      "@askrjs/askr": "^0.0.70",
      "@askrjs/vite": "^0.0.6",
    },
  });
  await fs.writeFile(
    path.join(root, "src", "app.tsx"),
    `
      import { Case, For, Match, Show, derive, resource, state } from "@askrjs/askr";
      import { action, ActionForm, defineAction } from "@askrjs/askr/actions";
      import { createIsland, createSPA } from "@askrjs/askr/boot";
      import {
        createMutation,
        createQuery,
        invalidate,
        invalidateOnInterval,
        queryScope,
      } from "@askrjs/askr/data";
      import { on, stream, task, timer } from "@askrjs/askr/resources";
      import { createRouteRegistry, route } from "@askrjs/askr/router";
      declare const schema: unknown;
      declare const root: Element;
      const moduleState = state(0);
      const save = defineAction({ id: "", input: schema, invalidates: [""] });
      route("/outside/:id", () => <div />);
      export const registry = createRouteRegistry(async () => {
        route("/inside/:id", async () => <div />);
      });
      export async function AsyncPage() {
        return <div />;
      }
      export function EarlyControl(props: { skip: boolean }) {
        if (props.skip) return null;
        return <For each={["a"]} by={(item) => item}>{(item) => <span>{item}</span>}</For>;
      }
      export function Page(props: { enabled: boolean; items: Array<{ id: string }> }) {
        const [count, setCount] = state(0);
        if (props.enabled) derive(() => count());
        setCount();
        resource(() => fetch("/api"), [{}]);
        createQuery({ key: "users", fetch: () => fetch("/api") });
        createQuery(null);
        createMutation({ action: () => fetch("/api", { method: "POST" }) });
        on(null, "", 1);
        timer(0, "invalid");
        task();
        stream("invalid", { deps: {} });
        invalidate("");
        queryScope(" ");
        invalidateOnInterval("", { intervalMs: 0 });
        const handle = setInterval(() => setCount(1), 1000);
        new Map();
        action(save).submit({});
        return <main>
          {count}
          {props.items.map((item) => <span>{item.id}</span>)}
          <For each={props.items} by={(item, index) => index} />
          <Show><Match>outside case</Match></Show>
          <ActionForm />
        </main>;
      }
      void moduleState;
      void createSPA({ root, routes: [] });
      createIsland({ routes: [] });
    `,
  );
  await fs.writeFile(
    path.join(root, "src", "entry-server.tsx"),
    `
      import { renderToString } from "@askrjs/askr/ssr";
      export const html = renderToString(() => <main>{document.title}</main>);
    `,
  );
  await fs.writeFile(path.join(root, "src", "broken.ts"), "export function broken( {");
  await fs.writeFile(
    path.join(root, "vite.config.ts"),
    'import { defineConfig } from "vite"; export default defineConfig({ plugins: [] });\n',
  );
  return root;
}

async function createDeepGraphFixture(depth: number, callCount: number): Promise<string> {
  const root = await createSingleWorkspaceFixture(0);
  const hooks = [
    'import { createQuery } from "@askrjs/askr/data";',
    `export function hook0() {
      if (false) hook${depth}();
      return createQuery({ key: "deep", fetch: async () => [] });
    }`,
    ...Array.from({ length: depth }, (_, index) => {
      const current = index + 1;
      const previous = current - 1;
      return `export function hook${current}() { return hook${previous}(); }`;
    }),
  ].join("\n");
  await fs.writeFile(path.join(root, "src", "hooks.ts"), hooks);
  let previous = "./hooks";
  for (let index = 0; index < 12; index += 1) {
    const current = `barrel-${index}`;
    await fs.writeFile(
      path.join(root, "src", `${current}.ts`),
      `export * from ${JSON.stringify(previous)};\n`,
    );
    previous = `./${current}`;
  }
  await fs.writeFile(
    path.join(root, "src", "page.tsx"),
    `
      import { hook${depth} } from ${JSON.stringify(previous)};
      export function Page(props: { enabled: boolean }) {
        ${Array.from(
          { length: callCount },
          (_, index) => `const result${index} = props.enabled ? hook${depth}() : null;`,
        ).join("\n")}
        return <main>{String(result0)}</main>;
      }
    `,
  );
  return root;
}

async function createLifecycleFixture(count: number): Promise<string> {
  const root = await createSingleWorkspaceFixture(0);
  await fs.writeFile(
    path.join(root, "src", "page.tsx"),
    `
      import { state, task } from "@askrjs/askr";
      export function Page() {
        const [, setNow] = state(Date.now());
        ${Array.from({ length: count }, (_, index) =>
          index % 2 === 0
            ? `task(() => {
                const handle${index} = setInterval(() => setNow(Date.now()), 1000);
                return () => clearInterval(handle${index});
              });`
            : `task(() => {
                const handle${index} = setTimeout(() => setNow(Date.now()), 1000);
                return () => clearInterval(handle${index});
              });`,
        ).join("\n")}
        return <div />;
      }
    `,
  );
  return root;
}

async function analysisContext(root: string) {
  const project = await discoverWorkspaceProject({ cwd: root, workspacePatterns: [] });
  const workspace = project.selectedWorkspaces[0]!;
  return (
    await createWorkspaceAnalysisContext(
      project.root,
      workspace,
      readAnalyzeConfiguration(workspace.manifest),
    )
  ).context;
}

let mediumWorkspace: string;
let largeWorkspace: string;
let monorepo: string;
let diagnosticWorkspace: string;
let deepGraphWorkspace: string;
let lifecycleWorkspace: string;
let diagnosticContext: Awaited<ReturnType<typeof analysisContext>>;
let deepGraphContext: Awaited<ReturnType<typeof analysisContext>>;
let lifecycleContext: Awaited<ReturnType<typeof analysisContext>>;

beforeAll(async () => {
  [
    mediumWorkspace,
    largeWorkspace,
    monorepo,
    diagnosticWorkspace,
    deepGraphWorkspace,
    lifecycleWorkspace,
  ] = await Promise.all([
    createSingleWorkspaceFixture(50),
    createSingleWorkspaceFixture(250),
    createMonorepoFixture(5, 50),
    createDiagnosticFixture(),
    createDeepGraphFixture(200, 100),
    createLifecycleFixture(100),
  ]);
  [diagnosticContext, deepGraphContext, lifecycleContext] = await Promise.all([
    analysisContext(diagnosticWorkspace),
    analysisContext(deepGraphWorkspace),
    analysisContext(lifecycleWorkspace),
  ]);
  const registered = ANALYZE_RULES.map((rule) => rule.id);
  expect(uncoveredAnalyzeRuleIds(registered)).toEqual({ missing: [], stale: [] });
  const diagnosticReport = await runAnalysis({
    cwd: diagnosticWorkspace,
    workspacePatterns: [],
    check: true,
  });
  expect(new Set(diagnosticReport.diagnostics.map((entry) => entry.ruleId))).toEqual(
    new Set(registered),
  );
});

afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function analyzeFixture(root: string, expectedFiles: number): Promise<void> {
  const report = await runAnalysis({
    cwd: root,
    workspacePatterns: [],
    check: true,
  });
  expect(report.summary.diagnostics).toBe(0);
  expect(report.workspaces.reduce((sum, workspace) => sum + workspace.files, 0)).toBe(
    expectedFiles,
  );
}

describe("askr analyze", () => {
  bench("50-file workspace", () => analyzeFixture(mediumWorkspace, 50), benchOptions);
  bench("250-file workspace", () => analyzeFixture(largeWorkspace, 250), benchOptions);
  bench("5-workspace monorepo with 250 files", () => analyzeFixture(monorepo, 250), benchOptions);
  bench(
    "diagnostic-heavy registered-rule sweep",
    () => {
      const count = ANALYZE_RULES.reduce(
        (sum, rule) => sum + rule.analyze(diagnosticContext).length,
        0,
      );
      expect(count).toBeGreaterThan(ANALYZE_RULES.length);
    },
    benchOptions,
  );
  bench(
    "deep cyclic wrapper graph through barrels",
    () => {
      const rule = ANALYZE_RULES.find((candidate) => candidate.id === "askr/stable-render-call")!;
      expect(rule.analyze(deepGraphContext)).toHaveLength(100);
    },
    benchOptions,
  );
  bench(
    "deep cyclic wrapper full analysis",
    async () => {
      const report = await runAnalysis({
        cwd: deepGraphWorkspace,
        workspacePatterns: [],
        check: true,
      });
      expect(
        report.diagnostics.filter((entry) => entry.ruleId === "askr/stable-render-call"),
      ).toHaveLength(100);
    },
    benchOptions,
  );
  bench(
    "lifecycle cleanup matching",
    () => {
      const rule = ANALYZE_RULES.find((candidate) => candidate.id === "askr/render-side-effect")!;
      expect(rule.analyze(lifecycleContext)).toHaveLength(50);
    },
    benchOptions,
  );
  bench(
    "realistic shipped startkit workspace",
    async () => {
      const report = await runAnalysis({
        cwd: path.resolve("templates/startkit"),
        workspacePatterns: [],
        check: true,
      });
      expect(report.summary.diagnostics).toBe(0);
      expect(report.workspaces[0]?.files).toBeGreaterThan(20);
    },
    benchOptions,
  );
});
