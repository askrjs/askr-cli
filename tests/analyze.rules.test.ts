import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceAnalysisContext, readAnalyzeConfiguration } from "../src/analyze/project";
import { runAnalysis } from "../src/analyze/runner";
import { discoverWorkspaceProject } from "../src/update/discovery";

const roots: string[] = [];

async function fixture(
  files: Record<string, string>,
  options: {
    manifest?: Record<string, unknown>;
    tsconfig?: Record<string, unknown> | null;
  } = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-rules-"));
  roots.push(root);
  const manifest = options.manifest ?? {
    name: "fixture",
    dependencies: { "@askrjs/askr": "^0.0.70" },
  };
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (options.tsconfig !== null) {
    const tsconfig = options.tsconfig ?? {
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "@askrjs/askr",
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
      },
      include: ["src"],
    };
    await fs.writeFile(path.join(root, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
  }
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(root, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return root;
}

async function diagnostics(
  root: string,
  check = true,
): Promise<Awaited<ReturnType<typeof runAnalysis>>["diagnostics"]> {
  return (await runAnalysis({ cwd: root, workspacePatterns: [], check })).diagnostics;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("analyzer rules", () => {
  it("recognizes canonical aliased and namespace imports without matching unrelated functions", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state as cell } from "@askrjs/askr";
        import * as Askr from "@askrjs/askr";
        import { state } from "./unrelated";
        const moduleCell = cell(0);
        const moduleResource = Askr.resource(async ({ signal }) => fetch("/api", { signal }), []);
        state();
      `,
      "src/unrelated.ts": "export function state() {}",
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-render-call")).toHaveLength(2);
    expect(found.every((entry) => entry.file === "src/page.tsx")).toBe(true);
  });

  it("reports unstable render calls and invalid state reads and writes", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state, derive } from "@askrjs/askr";
        export function Page(props: { enabled: boolean }) {
          const [count, setCount] = state(0);
          if (props.enabled) derive(() => count());
          setCount();
          return <button>{count}</button>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.map((entry) => entry.ruleId)).toEqual(
      expect.arrayContaining(["askr/stable-render-call", "askr/state-access", "askr/state-access"]),
    );
    expect(found.find((entry) => /conditionally/.test(entry.message))).toMatchObject({
      line: 5,
      severity: "error",
    });
  });

  it("checks resource cancellation and stable dependencies while accepting forwarded signals", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { resource } from "@askrjs/askr/resources";
        export function Bad() {
          resource(() => fetch("/api"), [{}]);
          return <div />;
        }
        export function Good() {
          resource(({ signal }) => fetch("/api", { signal }), ["users"]);
          return <div />;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/resource-cancellation")).toHaveLength(1);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-dependencies")).toHaveLength(1);
  });

  it("reports task-based data loading into component state", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        import { task } from "@askrjs/askr/resources";
        const [, setShared] = state(null);
        export function Users() {
          const [users, setUsers] = state(null);
          task(async () => {
            const response = await fetch("/api/users");
            setUsers(await response.json());
          });
          task(async () => {
            const response = await fetch("/api/audit");
            console.log(await response.text());
          });
          task(async () => {
            setUsers(await Promise.resolve([]));
          });
          task(async () => {
            await fetch("/api/shared");
            setShared([]);
          });
          return <div>{String(users())}</div>;
        }
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-effect-data-loading",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", file: "src/page.tsx" });
  });

  it("checks For contracts, positional keys, and only reactive JSX map calls", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { For, state } from "@askrjs/askr";
        const staticItems = [1, 2, 3].map((value) => value * 2);
        export function Page() {
          const [items] = state([{ id: "a" }]);
          return <main>
            {items().map((item) => <div>{item.id}</div>)}
            {staticItems.map((item) => <div>{item}</div>)}
            <For each={items()}>{(item) => <div>{item.id}</div>}</For>
            <For each={items()} by={(item, index) => index}>{(item) => <div>{item.id}</div>}</For>
            <For each={items()} by={(item) => item.id} byIndex>{(item) => <div>{item.id}</div>}</For>
          </main>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/prefer-for")).toHaveLength(1);
    expect(found.filter((entry) => entry.ruleId === "askr/for-contract")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-key")).toHaveLength(1);
  });

  it("reports async components, bad boot wiring, and SSR browser globals", async () => {
    const root = await fixture({
      "src/client.tsx": `
        import { createSPA } from "@askrjs/askr/boot";
        async function AsyncPage() { return <div />; }
        createSPA({ root: "#app", routes: [] });
      `,
      "src/entry-server.tsx": `
        import { renderToString } from "@askrjs/askr/ssr";
        export const html = renderToString(() => <main>
          {document.title}
          {typeof window === "undefined" ? null : window.location.href}
        </main>);
      `,
    });

    const found = await diagnostics(root);
    expect(found.some((entry) => entry.ruleId === "askr/no-async-component")).toBe(true);
    expect(found.filter((entry) => entry.ruleId === "askr/boot-registry")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/ssr-browser-global")).toHaveLength(1);
  });

  it("checks route registry ownership, route syntax, controls, and data cancellation", async () => {
    const root = await fixture({
      "src/routes.tsx": `
        import { Case, Match, Show } from "@askrjs/askr";
        import { createMutation, createQuery } from "@askrjs/askr/data";
        import { createRouteRegistry, route } from "@askrjs/askr/router";
        route("/outside", () => <div />);
        export const registry = createRouteRegistry(async () => {
          route("/users/:id", () => <Show><Match>user</Match></Show>);
        });
        export function Page() {
          createQuery({ key: "users", fetch: () => fetch("/api/users") });
          createMutation({ action: () => fetch("/api/users", { method: "POST" }) });
          return <Case><Match when={true}>ok</Match></Case>;
        }
        const namedDefinition = () => {
          route("/named", () => <div />);
          route("/async", async () => <div />);
        };
        export const namedRegistry = createRouteRegistry(namedDefinition);
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/route-registry")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/route-path-syntax")).toHaveLength(1);
    expect(found.filter((entry) => entry.ruleId === "askr/control-contract")).toHaveLength(3);
    expect(found.filter((entry) => entry.ruleId === "askr/data-cancellation")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/no-async-component")).toHaveLength(1);
  });

  it("reports state writes during render but accepts event-handler writes", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        export function Page() {
          const [count, setCount] = state(0);
          count.set(1);
          return <button onClick={() => setCount(2)}>{count()}</button>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/state-render-write")).toHaveLength(1);
  });

  it("reports malformed source and analyzes JavaScript without a tsconfig", async () => {
    const root = await fixture(
      {
        "src/broken.ts": "export function broken( {",
        "src/module.js": 'import { state } from "@askrjs/askr"; state(0);',
      },
      { tsconfig: null },
    );

    const found = await diagnostics(root);
    expect(found.some((entry) => entry.ruleId === "askr/parse-error")).toBe(true);
    expect(
      found.some(
        (entry) => entry.ruleId === "askr/stable-render-call" && entry.file === "src/module.js",
      ),
    ).toBe(true);
  });

  it("keeps dependency declaration graphs out of analysis programs", async () => {
    const root = await fixture({
      "src/page.ts": 'import type { Huge } from "huge-package"; export type Page = Huge;',
      "node_modules/huge-package/package.json": JSON.stringify({
        name: "huge-package",
        types: "index.d.ts",
      }),
      "node_modules/huge-package/index.d.ts":
        "export interface Huge { value: string; nested: Nested }",
    });
    const project = await discoverWorkspaceProject({ cwd: root, workspacePatterns: [] });
    const configuration = readAnalyzeConfiguration(project.workspaces[0].manifest);
    const { context } = await createWorkspaceAnalysisContext(
      root,
      project.workspaces[0],
      configuration,
    );

    expect(
      context.program
        .getSourceFiles()
        .map((sourceFile) => sourceFile.fileName)
        .filter((fileName) => fileName.includes("node_modules")),
    ).toEqual([]);
  });

  it("honors exclusions and rule severity configuration", async () => {
    const root = await fixture(
      {
        "src/page.ts": 'import { state } from "@askrjs/askr"; state(0);',
        "vendor/ignored.ts": 'import { state } from "@askrjs/askr"; state(0);',
      },
      {
        manifest: {
          name: "fixture",
          askr: {
            analyze: {
              exclude: ["vendor/**"],
              rules: { "askr/stable-render-call": "info" },
            },
          },
        },
      },
    );

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-render-call")).toEqual([
      expect.objectContaining({ file: "src/page.ts", severity: "info" }),
    ]);
  });

  it("reports lifecycle, stream, data, invalidation, and island contract violations", async () => {
    const root = await fixture({
      "src/contracts.tsx": `
        import { on, stream as live, task, timer } from "@askrjs/askr/resources";
        import * as Data from "@askrjs/askr/data";
        import { createIsland, createIslands } from "@askrjs/askr/boot";
        declare const schema: unknown;
        export function Page() {
          on(null, "", 1);
          timer(0, "no");
          timer(Infinity, () => {});
          task();
          live();
          live(() => 1, { deps: {} });
          live("source", []);
          Data.createQuery({});
          Data.createQuery(null);
          Data.createMutation({ action: 1 });
          Data.invalidate("");
          Data.queryScope(" ");
          Data.invalidateOnInterval("", { intervalMs: 0 });
          return <div />;
        }
        createIsland({ routes: [] });
        createIslands({ islands: [] });
        createIsland({ root: "#widget", component: async () => <div /> });
      `,
    });

    const found = await diagnostics(root);
    const count = (ruleId: string) => found.filter((entry) => entry.ruleId === ruleId).length;
    expect(count("askr/lifecycle-contract")).toBe(7);
    expect(count("askr/stream-contract")).toBe(5);
    expect(count("askr/data-contract")).toBe(4);
    expect(count("askr/invalidation-contract")).toBe(4);
    expect(count("askr/island-contract")).toBe(5);
    expect(
      found
        .filter((entry) => entry.ruleId.endsWith("-contract"))
        .every((entry) => entry.severity === "error"),
    ).toBe(true);
  });

  it("reports mixed execution models, action defects, discarded submits, and render allocations", async () => {
    const root = await fixture({
      "src/app.tsx": `
        import { state } from "@askrjs/askr";
        import { ActionForm, action as useAction, defineAction } from "@askrjs/askr/actions";
        import { createIsland, createSPA } from "@askrjs/askr/boot";
        declare const root: Element;
        declare const registry: unknown;
        declare const schema: unknown;
        const first = defineAction({ id: "save", input: schema });
        const duplicate = defineAction({ id: "save", input: schema });
        defineAction({ id: "", invalidates: ["", 3] });
        export function Page() {
          state(0);
          const command = useAction(first);
          command.submit({});
          new Intl.DateTimeFormat();
          new RegExp("x");
          new Map();
          new Set();
          return <ActionForm />;
        }
        void createSPA({ root, registry });
        createIsland({ root, component: Page });
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/execution-model")).toHaveLength(1);
    expect(found.filter((entry) => entry.ruleId === "askr/action-contract")).toHaveLength(6);
    expect(found.filter((entry) => entry.ruleId === "askr/action-promise")).toHaveLength(1);
    expect(found.filter((entry) => entry.ruleId === "askr/render-allocation")).toHaveLength(4);
    expect(
      found
        .filter((entry) => entry.ruleId === "askr/render-allocation")
        .every((entry) => entry.severity === "info"),
    ).toBe(true);
  });

  it("accepts valid contracts and ignores similarly named unrelated APIs", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { ActionForm, action, defineAction } from "@askrjs/askr/actions";
        import { createIslands } from "@askrjs/askr/boot";
        import { createMutation, createQuery, invalidate, invalidateOnInterval, queryScope } from "@askrjs/askr/data";
        import { on, stream, task, timer } from "@askrjs/askr/resources";
        import * as unrelated from "./unrelated";
        declare const target: EventTarget;
        declare const schema: unknown;
        const save = defineAction({ id: "save", input: schema, invalidates: ["users"] });
        export function Widget() {
          on(target, "click", () => {});
          timer(1000, () => {});
          task(async () => {});
          stream(async function* ({ signal }) {
            if (!signal.aborted) yield 1;
          }, { deps: ["feed"] });
          createQuery({ key: "users", fetch: async () => ({}) });
          createMutation({ action: async () => ({}) });
          invalidate("users");
          queryScope("admin");
          invalidateOnInterval("users", { intervalMs: 1000 });
          const command = action(save);
          void command.submit({});
          const click = () => new Map();
          unrelated.timer(0, null);
          unrelated.stream("source");
          return <ActionForm action={save} onClick={click} />;
        }
        createIslands({ islands: [{ root: "#widget", component: Widget }] });
      `,
      "src/unrelated.ts": `
        export function timer(...args: unknown[]) {}
        export function stream(...args: unknown[]) {}
      `,
    });

    const found = await diagnostics(root);
    const newRules = new Set([
      "askr/lifecycle-contract",
      "askr/stream-contract",
      "askr/data-contract",
      "askr/invalidation-contract",
      "askr/island-contract",
      "askr/execution-model",
      "askr/action-contract",
      "askr/action-promise",
      "askr/render-allocation",
    ]);
    expect(found.filter((entry) => newRules.has(entry.ruleId))).toEqual([]);
  });
});
