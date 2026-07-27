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

  it("reports conditional calls through local render-owned API wrappers", async () => {
    const root = await fixture({
      "src/data.ts": `
        import { createMutation, createQuery as query } from "@askrjs/askr/data";
        import * as Askr from "@askrjs/askr";

        export function createRowsQuery() {
          return query({ key: "rows", fetch: async () => [] });
        }
        export const createNestedRowsQuery = () => createRowsQuery();
        export function createSaveMutation() {
          return createMutation({ action: async () => ({}) });
        }
        export function cyclicResourceA() {
          return cyclicResourceB();
        }
        function cyclicResourceB() {
          if (false) cyclicResourceA();
          return Askr.resource(async () => [], []);
        }
        export function ordinaryHelper() {
          return "ordinary";
        }
      `,
      "src/page.tsx": `
        import {
          createNestedRowsQuery,
          createSaveMutation as save,
          cyclicResourceA,
          ordinaryHelper,
        } from "./data";

        export function Page(props: { enabled: boolean }) {
          const stable = createNestedRowsQuery();
          const stableCycle = cyclicResourceA();
          const rows = props.enabled ? createNestedRowsQuery() : null;
          const mutation = props.enabled && save();
          if (props.enabled) cyclicResourceA();
          const ordinary = props.enabled ? ordinaryHelper() : "safe";
          return <div>{String(stable && stableCycle && rows && mutation && ordinary)}</div>;
        }

        export const nestedComponentBody = (props: { enabled: boolean }) => {
          if (!props.enabled) return <div>disabled</div>;
          const rows = createNestedRowsQuery();
          return <div>{String(rows)}</div>;
        }
      `,
    });

    const found = await diagnostics(root);
    const unstable = found.filter((entry) => entry.ruleId === "askr/stable-render-call");
    expect(unstable).toHaveLength(4);
    expect(unstable.map((entry) => entry.line)).toEqual([12, 13, 14, 21]);
    expect(unstable.every((entry) => /transitively calls/.test(entry.message))).toBe(true);
  });

  it("distinguishes unconditional wrappers with conditional render-owned internals", async () => {
    const root = await fixture({
      "src/data.ts": `
        import { createQuery } from "@askrjs/askr/data";
        export function createOptionalRows(enabled: boolean) {
          if (enabled) {
            return createQuery({ key: "rows", fetch: async () => [] });
          }
          return null;
        }
      `,
      "src/page.tsx": `
        import { createOptionalRows } from "./data";
        export function Page(props: { enabled: boolean }) {
          const rows = createOptionalRows(props.enabled);
          return <main>{String(rows)}</main>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-render-call")).toEqual([
      expect.objectContaining({
        file: "src/page.tsx",
        line: 4,
        message: expect.stringContaining("contains conditionally executed render-owned Askr APIs"),
        remediation: expect.stringContaining("unconditional inside the wrapper"),
      }),
    ]);
  });

  it("reports unmanaged render side effects through wrappers and requires task cleanup", async () => {
    const root = await fixture({
      "src/effects.ts": `
        export function startClock(setNow: (value: number) => void) {
          window.setInterval(() => setNow(Date.now()), 1000);
        }
        export const startNestedClock = (setNow: (value: number) => void) =>
          startClock(setNow);
        export function startClockWithCleanup(setNow: (value: number) => void) {
          const handle = window.setInterval(() => setNow(Date.now()), 1000);
          return () => window.clearInterval(handle);
        }
        export function managedTimerTask() {
          const handle = setInterval(() => {}, 1000);
          return () => clearInterval(handle);
        }
        export function unmanagedTimerTask() {
          setTimeout(() => {}, 1000);
        }
        export function startObserverCycle() {
          return observerCycle();
        }
        function observerCycle() {
          if (false) startObserverCycle();
          return new MutationObserver(() => {});
        }
        export const ordinaryHelper = {
          subscribe() {},
          addEventListener() {},
        };
      `,
      "src/page.tsx": `
        import { state, task } from "@askrjs/askr";
        import {
          managedTimerTask,
          ordinaryHelper,
          startClockWithCleanup,
          startNestedClock,
          startObserverCycle,
          unmanagedTimerTask,
        } from "./effects";
        declare const unrelatedHandle: ReturnType<typeof setTimeout>;
        declare const otherObserver: { disconnect(): void };

        export function Page() {
          const [, setNow] = state(Date.now());
          startNestedClock(setNow);
          startObserverCycle();
          task(() => {
            setTimeout(() => setNow(Date.now()), 1000);
          });
          task(() => {
            const handle = setInterval(() => setNow(Date.now()), 1000);
            return () => clearInterval(handle);
          });
          task(() => {
            window.addEventListener("resize", setNow);
            return () => window.removeEventListener("resize", setNow);
          });
          task(() => {
            window.addEventListener("scroll", setNow);
          });
          task(() => startClockWithCleanup(setNow));
          task(() => {
            const observer = new ResizeObserver(() => {});
            observer.observe(document.body);
            return () => observer.disconnect();
          });
          task(() => {
            const handle = setInterval(() => setNow(Date.now()), 1000);
            return () => clearTimeout(handle);
          });
          task(() => {
            const handle = setTimeout(() => setNow(Date.now()), 1000);
            return () => clearTimeout(unrelatedHandle);
          });
          task(() => {
            const observer = new MutationObserver(() => {});
            observer.observe(document.body);
            return () => otherObserver.disconnect();
          });
          task(managedTimerTask);
          task(unmanagedTimerTask);
          ordinaryHelper.subscribe();
          ordinaryHelper.addEventListener();
          const onClick = () => setTimeout(() => setNow(Date.now()), 1000);
          return <button onClick={onClick}>tick</button>;
        }
      `,
    });

    const found = await diagnostics(root);
    const sideEffects = found.filter((entry) => entry.ruleId === "askr/render-side-effect");
    expect(sideEffects).toHaveLength(9);
    expect(
      sideEffects.filter((entry) => entry.file === "src/page.tsx").map((entry) => entry.line),
    ).toEqual([16, 17, 19, 30, 32, 39, 43, 47]);
    expect(sideEffects.filter((entry) => entry.file === "src/effects.ts")).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(
          /task starts timer side effects without returning matching cleanup/,
        ),
      }),
    ]);
    expect(sideEffects.some((entry) => /cleanup/.test(entry.remediation ?? ""))).toBe(true);
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

  it("checks For contracts, positional keys, and direct JSX map calls", async () => {
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
    expect(found.filter((entry) => entry.ruleId === "askr/prefer-for")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/for-contract")).toHaveLength(2);
    expect(found.filter((entry) => entry.ruleId === "askr/stable-key")).toHaveLength(1);
  });

  it("reports eager controls behind changing conditionals but accepts scoped components", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { For, Show, state } from "@askrjs/askr";
        function Dialog({ items }: { items: string[] }) {
          return <ul>
            <For each={items} by={(item) => item}>{(item) => <li>{item}</li>}</For>
          </ul>;
        }
        export function Page(props: { visible: boolean }) {
          const [open] = state(false);
          return <main>
            {open() ? <For each={["a"]} by={(item) => item}>{(item) => <p>{item}</p>}</For> : null}
            {open() && <Show when={true}>visible</Show>}
            {open() ? <Dialog items={["b"]} /> : null}
            {props.visible ? <For each={["c"]} by={(item) => item}>{(item) => <p>{item}</p>}</For> : null}
            {true ? <For each={["constant"]} by={(item) => item}>{(item) => <p>{item}</p>}</For> : null}
            {<For each={["always"]} by={(item) => item}>{(item) => <p>{item}</p>}</For> && open()}
            {<For each={["condition"]} by={(item) => item}>{(item) => <p>{item}</p>}</For> ? <p>yes</p> : null}
            <Show when={open()}><For each={["d"]} by={(item) => item}>{(item) => <p>{item}</p>}</For></Show>
          </main>;
        }
      `,
    });

    const found = await diagnostics(root);
    const unstable = found.filter((entry) => entry.ruleId === "askr/stable-render-call");
    expect(unstable).toHaveLength(3);
    expect(unstable.map((entry) => entry.line)).toEqual([11, 12, 14]);
    expect(unstable.every((entry) => /<Show>/.test(entry.remediation ?? ""))).toBe(true);
    expect(unstable[1]?.remediation).toMatch(/Mount <Show> unconditionally/);
  });

  it("reports eager controls reached after conditional early returns", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { Case, For, Show } from "@askrjs/askr";

        export function ForPage(props: { skip: boolean }) {
          if (props.skip) return null;
          return <For each={["a"]} by={(item) => item}>{(item) => <p>{item}</p>}</For>;
        }
        export function ShowPage(props: { skip: boolean }) {
          if (props.skip) return <div>skipped</div>;
          return <Show when={true}>shown</Show>;
        }
        export function CasePage(props: { skip: boolean }) {
          if (props.skip) return null;
          return <Case>matched</Case>;
        }
        export function ConstantEarlyReturn() {
          if (false) return null;
          return <For each={["a"]} by={(item) => item}>{(item) => <p>{item}</p>}</For>;
        }
        export function ReturnAfterControl(props: { skip: boolean }) {
          const control = <Show when={true}>shown</Show>;
          if (props.skip) return null;
          return control;
        }
        export function NestedReturn(props: { skip: boolean }) {
          const helper = () => {
            if (props.skip) return null;
            return "ready";
          };
          helper();
          return <For each={["a"]} by={(item) => item}>{(item) => <p>{item}</p>}</For>;
        }
        export function OrdinaryJsx(props: { skip: boolean }) {
          if (props.skip) return null;
          return <div>ordinary</div>;
        }
      `,
    });

    const found = await diagnostics(root);
    const unstable = found.filter((entry) => entry.ruleId === "askr/stable-render-call");
    expect(unstable).toHaveLength(3);
    expect(unstable.map((entry) => entry.line)).toEqual([6, 10, 14]);
    expect(unstable.every((entry) => /early return/.test(entry.message))).toBe(true);
  });

  it("reports map arrays rendered as JSX children but accepts data transformations", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { For } from "@askrjs/askr";
        export function Page({ items }: { items: Array<{ id: string; label: string }> }) {
          const labels = items.map((item) => item.label);
          return <main data-labels={items.map((item) => item.label)}>
            {items.map((item) => <p key={item.id}>{item.label}</p>)}
            {items.map((item) => item.label) && <p>always</p>}
            {items.map((item) => <p>{item.label}</p>) ?? null}
            {null ?? items.map((item) => <p>{item.label}</p>)}
            {items.map((item) => item.label).join(", ")}
            <For each={items.map((item) => item.id)} by={(item) => item}>
              {(item) => <span>{item}</span>}
            </For>
            <output>{labels.join(", ")}</output>
          </main>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(
      found.filter((entry) => entry.ruleId === "askr/prefer-for").map((entry) => entry.line),
    ).toEqual([6, 8, 9]);
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
