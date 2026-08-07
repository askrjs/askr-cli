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

  it("reports state getters in value positions while preserving declaration and call syntax", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        const [count, setCount] = state(0);
        const doubled = count + 1;
        send(count);
        const object = { value: count };
        const template = \`count: \${count}\`;
        const receiver = count.toString();
        const property = object.count;
        type Snapshot = typeof count;
        export { count };
        count();
        setCount(2);
        function send(value: number) { return value; }
        function AccessorView(props: { value: () => number }) { return <div>{props.value()}</div>; }
        function OptionalAccessorView(props: { value?: () => number }) { return <div>{props.value?.()}</div>; }
        function Label(props: { text: number }) { return <div>{props.text}</div>; }
        export function Page() { return <main>
          <div data-count={count} count={count} />
          <AccessorView value={count} />
          <OptionalAccessorView value={count} />
          <Label text={count} />
        </main>; }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/state-access")).toHaveLength(7);
  });

  it("validates statically known For key strategies without rejecting dynamic values", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { For } from "@askrjs/askr";
        declare const items: number[];
        declare const dynamicBy: unknown;
        declare const dynamicIndex: boolean;
        declare const optionalIndex: boolean | undefined;
        declare const maybeFn: (() => string) | number;
        declare const optionalFn: (() => string) | undefined;
        export function Page() { return <main>
          <For each={items} by>{(item) => <span>{item}</span>}</For>
          <For each={items} by="id">{(item) => <span>{item}</span>}</For>
          <For each={items} byIndex={false}>{(item) => <span>{item}</span>}</For>
          <For each={items} by={maybeFn}>{(item) => <span>{item}</span>}</For>
          <For each={items} by={optionalFn}>{(item) => <span>{item}</span>}</For>
          <For each={items} byIndex={}>{(item) => <span>{item}</span>}</For>
          <For each={items} by={(item) => item}>{(item) => <span>{item}</span>}</For>
          <For each={items} byIndex>{(item) => <span>{item}</span>}</For>
          <For each={items} byIndex={optionalIndex}>{(item) => <span>{item}</span>}</For>
          <For each={items} by={dynamicBy as any} byIndex={dynamicIndex}>{(item) => <span>{item}</span>}</For>
        </main>; }
      `,
    });

    const found = await diagnostics(root);
    const contracts = found.filter((entry) => entry.ruleId === "askr/for-contract");
    expect(contracts).toHaveLength(5);
    expect(contracts.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        "<For> by must be a function.",
        "<For> byIndex must be true.",
        "<For> accepts either by or byIndex, not both.",
      ]),
    );
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

  it("should enforce the complete runtime route-path contract", async () => {
    const root = await fixture({
      "src/routes.tsx": `
        import { createRouteRegistry, group, page, route } from "@askrjs/askr/router";
        const View = () => <div />;
        export const registry = createRouteRegistry(() => {
          route("users/{id}", View);
          route("/users//{id}", View);
          route("/users/{id}suffix", View);
          route("/users/{}", View);
          route("/users/{*}", View);
          route("/users/{**}", View);
          route("/users/{*rest}/edit", View);
          route("/users/{id}/posts/{id}", View);
          page("", View, () => {});
          page("/users/{userId}", View, () => {
            route("posts/{postId}", View);
            group({}, () => route("settings", View));
          });
          route("/*", View);
          route("/files/{*path}", View);
        });
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/route-path-syntax",
    );
    expect(found).toHaveLength(9);
    expect(found.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must begin with/i),
        expect.stringMatching(/consecutive slashes/i),
        expect.stringMatching(/complete \{name\} interpolation/i),
        expect.stringMatching(/parameter name cannot be empty/i),
        expect.stringMatching(/splat parameter name cannot be empty/i),
        expect.stringMatching(/named splat parameter name cannot be "\*"/i),
        expect.stringMatching(/named splat parameters must be the final segment/i),
        expect.stringMatching(/duplicate parameter name "id"/i),
        expect.stringMatching(/page\(\).*non-empty path/i),
      ]),
    );
    expect(found.filter((entry) => entry.fix)).toHaveLength(2);
  });

  it("should track page scope structure through groups and named route definitions", async () => {
    const root = await fixture({
      "src/routes.tsx": `
        import { createRouteRegistry, group, index, page, route } from "@askrjs/askr/router";
        const View = () => <div />;
        const groupedChildren = () => {
          index(View);
          route("/absolute-child", View);
          page("/nested", View, () => {});
        };
        const pageChildren = () => {
          index(View);
          group({}, groupedChildren);
        };
        export const invalid = createRouteRegistry(() => {
          page("/users", View, pageChildren);
        });
        export const valid = createRouteRegistry(() => {
          page("/projects", View, () => {
            index(View);
            group({}, () => route("settings", View));
          });
          page("/teams", View, () => index(View));
        });
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/route-scope-structure",
    );
    expect(found).toHaveLength(3);
    expect(found.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/more than one index/i),
        expect.stringMatching(/absolute inside a page scope/i),
        expect.stringMatching(/page\(\) cannot be nested/i),
      ]),
    );
    expect(found.find((entry) => /absolute/.test(entry.message))?.fix).toBeDefined();
  });

  it("should report render-required APIs at module scope and in non-render callbacks", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { ErrorBoundary, defineScope, getSignal, readScope } from "@askrjs/askr";
        import { routeData } from "@askrjs/askr/router";
        import { resource, task } from "@askrjs/askr/resources";
        const Scope = defineScope("default");
        readScope(Scope);
        getSignal();
        routeData();
        ErrorBoundary({ fallback: null, children: null });
        export function Page() {
          readScope(Scope);
          getSignal();
          routeData();
          ErrorBoundary({ fallback: null, children: null });
          resource(() => readScope(Scope), []);
          task(() => readScope(Scope));
          setTimeout(() => getSignal(), 0);
          queueMicrotask(() => routeData());
          Promise.resolve().then(() => ErrorBoundary({ fallback: null, children: null }));
          return <button onClick={() => {
            readScope(Scope);
            getSignal();
            routeData();
            ErrorBoundary({ fallback: null, children: null });
          }}>Save</button>;
        }
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/render-scope-required",
    );
    expect(found).toHaveLength(12);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/readScope/);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/getSignal/);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/routeData/);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/ErrorBoundary/);
  });

  it("should report missing parameters in workspace route destinations", async () => {
    const root = await fixture({
      "src/routes.tsx": `
        import { route } from "@askrjs/askr/router";
        const View = () => <div />;
        export const UserPost = route("/users/{id}/posts/{postId}", View);
        export const Files = route("/files/{*path}", View);
        export const About = route("/about", View);
      `,
      "src/page.tsx": `
        import { Link, to } from "@askrjs/askr/router";
        import { About, Files, UserPost } from "./routes";
        declare const dynamicParams: { id: string; postId: string };
        declare const extra: { postId: string };
        export function Page() {
          return <>
            <Link to={to(UserPost, { id: "1" })} />
            <Link to={to(Files, {})} />
            <Link to={to(UserPost, { id: "1", postId: "2" })} />
            <Link to={to(About, {})} />
            <Link to={to(UserPost, dynamicParams)} />
            <Link to={to(UserPost, { id: "1", ...extra })} />
          </>;
        }
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/link-contract",
    );
    expect(found).toHaveLength(2);
    expect(found.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/missing route parameter "postId"/i),
        expect.stringMatching(/missing route parameter "path"/i),
      ]),
    );
  });

  it("should ignore unnamed wildcard routes when validating static destinations", async () => {
    const root = await fixture({
      "src/routes.tsx": `
        import { route } from "@askrjs/askr/router";
        const View = () => <div />;
        export const Files = route("/files/*", View);
      `,
      "src/page.tsx": `
        import { Link, to } from "@askrjs/askr/router";
        import { Files } from "./routes";
        export function Page() {
          return <Link to={to(Files, {})} />;
        }
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/link-contract",
    );
    expect(found).toHaveLength(0);
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

  it("should report hardcoded theme tokens in runtime literals and template segments", async () => {
    const root = await fixture({
      "src/theme.tsx": `
        const value = "red";
        const other = "blue";
        const stringValue = "var(--ak-color-text)";
        const templateValue = \`--ak-space-md\`;
        const interpolated = \`--ak-before \${value} middle --ak-middle \${other} --ak-after\`;
        export const view = <div data-token="--ak-color-surface" />;
      `,
      "src/extra.js": `export const token = "--ak-color-border";`,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(found).toHaveLength(7);
    expect(found.every((entry) => entry.severity === "warning")).toBe(true);
    expect(found.every((entry) => /semantic class|data-\*/.test(entry.message))).toBe(true);
    expect(found.map((entry) => entry.file)).toEqual(
      expect.arrayContaining(["src/theme.tsx", "src/extra.js"]),
    );
  });

  it("should ignore comments and nonliteral token flow", async () => {
    const root = await fixture({
      "src/theme.ts": `
        // --ak-color-text belongs in CSS.
        /* --ak-color-surface is also only a comment. */
        declare function resolveToken(): string;
        const tokenName = resolveToken();
        document.body.style.setProperty(tokenName, "red");
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/no-hardcoded-theme-token")).toEqual([]);
  });

  it("should honor exclusions and exempt only the exact theme owner workspace", async () => {
    const excludedRoot = await fixture(
      {
        "src/page.ts": `export const token = "--ak-color-text";`,
        "vendor/ignored.ts": `export const token = "--ak-color-surface";`,
      },
      {
        manifest: {
          name: "fixture",
          askr: { analyze: { exclude: ["vendor/**"] } },
        },
      },
    );
    const ownerRoot = await fixture(
      { "src/theme.ts": `export const token = "--ak-color-text";` },
      { manifest: { name: "@askrjs/themes" } },
    );
    const similarlyNamedRoot = await fixture(
      { "src/theme.ts": `export const token = "--ak-color-text";` },
      { manifest: { name: "@askrjs/themes-app" } },
    );

    const excluded = (await diagnostics(excludedRoot)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(excluded).toEqual([expect.objectContaining({ file: "src/page.ts" })]);
    expect(
      (await diagnostics(ownerRoot)).filter(
        (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
      ),
    ).toEqual([]);
    expect(
      (await diagnostics(similarlyNamedRoot)).filter(
        (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
      ),
    ).toEqual([expect.objectContaining({ file: "src/theme.ts" })]);
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

  it("covers the static-analysis backlog with conservative positive and negative cases", async () => {
    const root = await fixture({
      "src/backlog.tsx": `
        import { Case, For, Match, Show, defineScope, state } from "@askrjs/askr";
        import { createQuery, queryScope } from "@askrjs/askr/data";
        import { Link, index, lazy, page, route } from "@askrjs/askr/router";
        import { resource, task } from "@askrjs/askr/resources";
        import { dispatch } from "@askrjs/askr/testing";
        declare const expect: (value: unknown) => { toBe(value: unknown): void };
        export function Page(props: { enabled: boolean }) {
          const [count, setCount] = state(0);
          const snapshot = count();
          if (props.enabled) {
            <Show when={true}>conditional</Show>;
            defineScope();
          }
          resource(() => count(), []);
          task(async () => setCount(await fetch("/api").then((value) => value.status)));
          const Deferred = lazy(() => import("./deferred"));
          setTimeout(() => resource(() => 1, []), 0);
          return <main>
            <Case>invalid<Match when={true}>ok</Match></Case>
            <For each={[]} byIndex>{() => <span>{snapshot}</span>}</For>
            <Link href="javascript:alert(1)" />
            <Deferred />
          </main>;
        }
        createQuery({ key: Math.random(), fetch: async () => ({}) });
        createQuery({ key: {}, fetch: async () => ({}) });
        queryScope(Symbol("scope"));
        page("/users", () => {
          index(() => null);
          index(() => null);
          route("/settings", () => null);
        });
        function testInteraction() {
          dispatch(document.body, "click");
          expect(true).toBe(true);
        }
      `,
      "src/imports.ts": `
        import { For, createQuery as query, resource, state as cell } from "@askrjs/askr";
        void [For, query, resource, cell];
      `,
      "src/valid.tsx": `
        import { For, state } from "@askrjs/askr";
        import { Link, lazy } from "@askrjs/askr/router";
        import { resource } from "@askrjs/askr/resources";
        const Deferred = lazy(() => import("./deferred"));
        export function Valid() {
          const [count] = state(0);
          resource(() => count(), [count()]);
          return <><For each={[]} byIndex>{() => <span data-value={() => count()} />}</For>
            <Link href="sms:+15551234567" /><Deferred /></>;
        }
      `,
      "src/deferred.tsx": "export default function Deferred() { return <div />; }",
    });

    const found = await diagnostics(root);
    const ids = new Set(found.map((entry) => entry.ruleId));
    for (const id of [
      "askr/stable-control-boundary",
      "askr/exhaustive-dependencies",
      "askr/for-row-closure-capture",
      "askr/render-scope-required",
      "askr/stable-module-identity",
      "askr/route-scope-structure",
      "askr/link-contract",
      "askr/query-key-contract",
      "askr/import-subpath",
      "askr/no-effect-data-loading",
      "askr/testing-contract",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(
      found.filter(
        (entry) =>
          entry.file === "src/valid.tsx" &&
          [
            "askr/exhaustive-dependencies",
            "askr/for-row-closure-capture",
            "askr/link-contract",
            "askr/stable-module-identity",
          ].includes(entry.ruleId),
      ),
    ).toEqual([]);
    expect(found.find((entry) => entry.ruleId === "askr/import-subpath")?.fix).toMatchObject({
      safe: true,
    });
    expect(
      found.find((entry) => entry.ruleId === "askr/route-scope-structure" && entry.fix)?.fix,
    ).toMatchObject({ safe: true });
  });
});
