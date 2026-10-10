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
  it.each([
    ["exported declaration", "export const request = {};"],
    ["shorthand export", "const request = {}; export { request };"],
    ["renamed export", "const request = {}; export { request as shared };"],
  ])("should treat %s of a request object as an escape", async (_name, declaration) => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any;
        const client = createClient(api);
        ${declaration}
        export function Records() { return createQuery({ key: "records", fetch: () => client.records(request) }); }
      `,
    });
    expect(
      (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/data-cancellation"),
    ).toEqual([]);
  });

  it.each([
    ["late unknown options", "fetch: () => client.records(), ...options", "", 0],
    ["explicit loader after unknown options", "...options, fetch: () => client.records()", "", 1],
    [
      "last explicit loader",
      "fetch: () => client.records(), fetch: (ctx) => client.records({ signal: ctx.signal })",
      "",
      0,
    ],
    ["late computed option", "fetch: () => client.records(), [key]: value", "", 0],
    [
      "mutable loader",
      "fetch: loader",
      "let loader = () => client.records(); loader = (ctx) => client.records({ signal: ctx.signal });",
      0,
    ],
    ["const loader", "fetch: loader", "const loader = () => client.records();", 1],
  ] as const)(
    "should honor %s when resolving cancellation loaders",
    async (_name, options, declarations, expected) => {
      const root = await fixture({
        "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any, options: any, key: string, value: any;
        const client = createClient(api);
        ${declarations}
        export function Records() { return createQuery({ key: "records", ${options} }); }
      `,
      });
      expect(
        (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/data-cancellation"),
      ).toHaveLength(expected);
    },
  );

  it.each([8, 9])(
    "should bound signal, context, request and client aliases at %i const links",
    async (depth) => {
      const aliases = (prefix: string, initial: string) =>
        Array.from(
          { length: depth },
          (_, index) =>
            `const ${prefix}${index + 1} = ${index === 0 ? initial : `${prefix}${index}`};`,
        ).join("\n");
      const root = await fixture({
        "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any;
        const client = createClient(api);
        ${aliases("c", "client")}
        export function Records() {
          createQuery({ key: "client", fetch: () => c${depth}.records() });
          createQuery({ key: "signal", fetch: (ctx) => { ${aliases("s", "ctx.signal")} return client.records({ signal: s${depth} }); } });
          createQuery({ key: "context", fetch: (ctx) => { ${aliases("x", "ctx")} return client.records({ signal: x${depth}.signal }); } });
          createQuery({ key: "input", fetch: (ctx) => { ${aliases("i", "{}")} return client.records(i${depth}); } });
        }
      `,
      });
      const found = (await diagnostics(root)).filter(
        (entry) => entry.ruleId === "askr/data-cancellation",
      );
      expect(found).toHaveLength(depth === 8 ? 2 : 0);
      if (depth === 8)
        expect(found.map((entry) => entry.message)).toEqual([
          expect.stringContaining("c8.records()"),
          expect.stringContaining("client.records()"),
        ]);
    },
  );

  it("should skip cyclic const provenance without treating it as missing cancellation", async () => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any;
        const client = createClient(api);
        const a = b, b = a;
        export function Records() {
          createQuery({ key: "client", fetch: () => a.records() });
          createQuery({ key: "signal", fetch: (ctx) => client.records({ signal: a }) });
          createQuery({ key: "context", fetch: (ctx) => client.records({ signal: a.signal }) });
          createQuery({ key: "input", fetch: (ctx) => client.records(a) });
        }
      `,
    });
    expect(
      (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/data-cancellation"),
    ).toEqual([]);
  });

  it("should distinguish unbound undefined from dynamic shadowed request input", async () => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any, input: any;
        const client = createClient(api);
        export function Records() {
          createQuery({ key: "global", fetch: () => client.records(undefined) });
          createQuery({ key: "local", fetch: () => { let undefined = input; return client.records(undefined); } });
        }
      `,
    });
    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/data-cancellation",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(7);
  });

  it.each([
    ["missing typed input", "() => client.records()", 1],
    ["query signal", "({ signal }) => client.records({ signal })", 0],
    ["signal alias", "({ signal: cancellation }) => client.records({ signal: cancellation })", 0],
    ["context member", "(context) => client.records({ signal: context.signal })", 0],
    ["rest context parameter", "({ ...context }) => client.records({ signal: context.signal })", 0],
    [
      "rest context alias",
      "(context) => { const { ...copy } = context; return client.records({ signal: copy.signal }); }",
      0,
    ],
    ["computed context member", "(context) => client.records({ signal: context['signal'] })", 0],
    [
      "computed destructure",
      "(context) => { const { ['signal']: own } = context; return client.records({ signal: own }); }",
      0,
    ],
    [
      "composed signal",
      "(context) => client.records({ signal: AbortSignal.any([context.signal, foreign.signal]) })",
      0,
    ],
    [
      "mutable signal",
      "(context) => { let signal = context.signal; return client.records({ signal }); }",
      0,
    ],
    ["opaque signal", "(context) => client.records({ signal: service(context.signal) })", 0],
    [
      "filled request object",
      "(context) => { const request = {}; request.signal = context.signal; return client.records(request); }",
      0,
    ],
    [
      "overwritten request object",
      "(context) => { const request = { signal: context.signal }; request.signal = foreign.signal; return client.records(request); }",
      0,
    ],
    [
      "escaped request object",
      "(context) => { const request = {}; service(request, context.signal); return client.records(request); }",
      0,
    ],
    [
      "mutated request alias",
      "(context) => { const request = {}; const alias = request; alias.signal = context.signal; return client.records(request); }",
      0,
    ],
    [
      "local shorthand signal",
      "(context) => { const signal = context.signal; return client.records({ signal }); }",
      0,
    ],
    [
      "local signal alias",
      "(context) => { const own = context.signal; return client.records({ signal: own }); }",
      0,
    ],
    [
      "local context alias",
      "(context) => { const own = context; return client.records({ signal: own.signal }); }",
      0,
    ],
    [
      "local destructure",
      "(context) => { const { signal: own } = context; return client.records({ signal: own }); }",
      0,
    ],
    [
      "foreign same spelling",
      "(context) => { const signal = foreign.signal; return client.records({ signal }); }",
      1,
    ],
    ["wrong binding", "({ signal }) => client.records({ signal: foreign.signal })", 1],
    ["comment exemption", "() => { /* signal */ return client.records(); }", 1],
    ["two requests", "({ signal }) => { client.records({ signal }); return client.records(); }", 1],
    ["unknown spread", "({ signal }) => client.records({ ...input })", 0],
    [
      "wrong after spread",
      "({ signal }) => client.records({ ...input, signal: foreign.signal })",
      1,
    ],
    [
      "unknown after wrong",
      "({ signal }) => client.records({ signal: foreign.signal, ...input })",
      0,
    ],
    ["forwarded after spread", "({ signal }) => client.records({ ...input, signal })", 0],
    ["unknown input", "({ signal }) => client.records(input)", 0],
    ["uninvoked helper", "({ signal }) => { const later = () => client.records(); return 1; }", 0],
    [
      "shadowed client",
      "({ signal }) => { const client = unknownClient; return client.records(); }",
      0,
    ],
    ["raw own binding", "({ signal: own }) => fetch('/api', { signal: own })", 0],
    ["raw wrong binding", "({ signal }) => fetch('/api', { signal: foreign.signal })", 1],
    ["raw comment", "() => { /* signal */ return fetch('/api'); }", 1],
    ["shadowed raw fetch", "() => { const fetch = service; return fetch('/api'); }", 0],
    [
      "local input alias",
      "({ signal }) => { const request = { signal }; return client.records(request); }",
      0,
    ],
    [
      "local missing input alias",
      "({ signal }) => { const request = {}; return client.records(request); }",
      1,
    ],
    ["dynamic getter", "({ signal }) => client.records({ get signal() { return signal; } })", 0],
  ] as const)("should resolve cancellation for %s", async (_name, loader, expected) => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        declare const api: any, foreign: any, input: any, unknownClient: any, service: any;
        const client = createClient(api);
        export function Records() { return createQuery({ key: "records", fetch: ${loader} }); }
      `,
    });
    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/data-cancellation",
    );
    expect(found).toHaveLength(expected);
    for (const entry of found) {
      expect(entry.severity).toBe("warning");
      expect(entry.file).toBe("src/records.ts");
      expect(entry.message).toContain("cancellation signal");
    }
  });

  it("should recognize aliased and namespaced fetch factories, clients and named operation callbacks", async () => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery as query, createMutation as mutation } from "@askrjs/askr/data";
        import { createClient as makeClient, createFetch as makeFetch } from "@askrjs/fetch";
        import * as Typed from "@askrjs/fetch";
        declare const api: any;
        const factory = makeClient;
        const initial = factory(api);
        const client = initial;
        const request = makeFetch();
        const namespaceClient = Typed.createClient(api);
        const namespaceFetch = Typed.createFetch();
        function missing() { return client.records(); }
        function forwarded(context: any) { return namespaceClient.records({ signal: context.signal }); }
        export function Records() {
          query({ key: "one", fetch: missing });
          query({ key: "two", fetch: forwarded });
          query({ key: "three", fetch: () => request({ url: "/api" }) });
          query({ key: "four", fetch: ({ signal }) => namespaceFetch({ url: "/api", signal }) });
          mutation({ action: (input, { signal: own }) => client.records({ ...input, signal: own }) });
          mutation({ action: ({ signal }, context) => client.records({ signal }) });
        }
      `,
    });
    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/data-cancellation",
    );
    expect(found).toHaveLength(3);
    expect(found.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("client.records()"),
        expect.stringContaining("request()"),
      ]),
    );
  });

  it("should skip unresolved clients, other modules, computed endpoints and shadowed canonical names", async () => {
    const root = await fixture({
      "src/records.ts": `
        import { createQuery } from "@askrjs/askr/data";
        import { createClient } from "@askrjs/fetch";
        import { createClient as otherClient } from "another-library";
        import { service } from "./service";
        declare const api: any, endpoint: string, imported: any;
        const unknown = imported;
        const other = otherClient(api);
        const client = createClient(api);
        export function Records() {
          createQuery({ key: "one", fetch: () => unknown.records() });
          createQuery({ key: "two", fetch: () => other.records() });
          createQuery({ key: "three", fetch: () => client[endpoint]() });
          createQuery({ key: "four", fetch: () => service() });
          const createClient = (value: any) => value;
          const local = createClient(api);
          createQuery({ key: "five", fetch: () => local.records() });
          function nested(createQuery: any) { createQuery({ key: "six", fetch: () => client.records() }); }
        }
      `,
      "src/service.ts": "export function service() { return 1; }",
    });
    expect(
      (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/data-cancellation"),
    ).toEqual([]);
  });

  it("preserves nested reads and setter calls and refreshes facts after a source rewrite", async () => {
    const root = await fixture({
      "src/page.tsx": [
        'import { state as cell } from "@askrjs/askr";',
        "export function Page() {",
        "  const [count, setCount] = cell(0);",
        "  function nested() { return count; }",
        "  return <button onClick={() => setCount()}>{count}</button>;",
        "}",
      ].join("\n"),
    });
    const first = (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/state-access");
    expect(first.map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 4, message: "State getter 'count' is used as a value instead of being called." },
      { line: 5, message: "State setter 'setCount' is called without a value or updater." },
      { line: 5, message: "State getter 'count' is used as a value instead of being called." },
    ]);

    await fs.writeFile(
      path.join(root, "src/page.tsx"),
      [
        'import * as Askr from "@askrjs/askr";',
        "export function Page() {",
        "  const [value, update] = Askr.state(0);",
        "  return <button onClick={() => update(1)}>{value()}</button>;",
        "}",
      ].join("\n"),
    );
    const second = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/state-access",
    );
    expect(second).toEqual([]);
    expect(first).toHaveLength(3);
  });

  it("preserves unused exclusion patterns behind a prior match", async () => {
    const root = await fixture(
      { "src/page.ts": `export const token = "--ak-color-text";` },
      {
        manifest: { name: "fixture", askr: { analyze: { exclude: ["**", "x".repeat(65537)] } } },
      },
    );
    expect(await diagnostics(root)).toEqual([]);
  });

  it("preserves direct state declarations while excluding calls nested in other initializers", async () => {
    const root = await fixture({
      "src/page.ts": `
        import { state as cell } from "@askrjs/askr";
        import * as Askr from "@askrjs/askr";
        function wrap<T>(value: T): T { return value; }
        export function Page() {
          const [count] = cell(0);
          const value = Askr.state(1);
          const [wrapped] = wrap(cell(2));
          return [count, value, wrapped];
        }
      `,
    });
    const found = (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/state-access");
    expect(found).toHaveLength(2);
    expect(found.every((entry) => entry.file === "src/page.ts")).toBe(true);
  });

  it("applies brace dot and single-character exclusions to configured and discovered sources", async () => {
    const source = `export const token = "--ak-color-text";`;
    const root = await fixture(
      {
        "src/visible.ts": source,
        "src/vendor/dropped.ts": source,
        "src/.cache/dropped.ts": source,
        "extra/visible.ts": source,
        "extra/skip-a.ts": source,
        "extra/skip-long.ts": source,
      },
      {
        manifest: {
          name: "fixture",
          askr: { analyze: { exclude: ["**/{vendor,.cache}/**", "**/skip-?.[tj]s", "# comment"] } },
        },
        tsconfig: {
          compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ES2022" },
          include: ["src"],
          files: ["extra/skip-a.ts", "extra/skip-long.ts"],
        },
      },
    );
    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(found.map((entry) => entry.file).sort()).toEqual([
      "extra/skip-long.ts",
      "extra/visible.ts",
      "src/visible.ts",
    ]);
  });

  it("should recognize canonical aliased and namespace imports without matching unrelated functions", async () => {
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

  it("should report unstable render calls and invalid state reads and writes", async () => {
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

  it("should report state getters in value positions while preserving declaration and call syntax", async () => {
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

  it("should follow state bindings and allow callable accessor references", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        import { watch } from "@askrjs/askr/resources";
        interface Adapter { isAuthenticated(): boolean; user(): string | null; }
        export function Page() {
          const isAuthenticated = state(false);
          const user = state<string | null>(null);
          const otp = state("");
          const mutation = {
            action: ({ otp: code, token }: { otp: string; token: string }) => code + token,
          };
          const adapter: Adapter = { isAuthenticated, user };
          watch(isAuthenticated, () => {});
          watch([isAuthenticated, user] as const, () => {});
          return <div>{mutation.action({ otp: otp(), token: adapter.user() ?? "" })}</div>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/state-access")).toEqual([]);
  });

  it("should only allow state accessors passed to the imported watch binding", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        import { watch } from "@askrjs/askr/resources";
        export function Page() {
          const value = state("state");
          function Shadowed() {
            const watch = (source: () => string) => source;
            watch(value);
            return <span>{value()}</span>;
          }
          return <Shadowed />;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/state-access")).toHaveLength(1);
  });

  it("should scope every state-sensitive rule to the bound accessor symbols", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { For, state } from "@askrjs/askr";
        import { resource, task } from "@askrjs/askr/resources";
        export function Page() {
          const [items, setItems] = state([{ id: "state" }]);
          const [query, setQuery] = state("state");
          function Shadowed() {
            const items = () => [{ id: "local" }];
            const query = () => "local";
            const setQuery = (_value: string) => {};
            const snapshot = query();
            setQuery("render");
            resource(() => query(), []);
            task(async () => {
              const response = await fetch("/api/value");
              setQuery(await response.text());
            });
            return <main>
              {items().map((item) => <span>{item.id}</span>)}
              <For each={items()} by={(item) => item.id}>
                {() => <span>{query()}{snapshot}</span>}
              </For>
            </main>;
          }
          return <Shadowed />;
        }
      `,
    });

    const found = await diagnostics(root);
    for (const ruleId of [
      "askr/state-access",
      "askr/state-render-write",
      "askr/prefer-for",
      "askr/exhaustive-dependencies",
      "askr/for-row-closure-capture",
      "askr/no-effect-data-loading",
    ]) {
      expect(
        found.filter((entry) => entry.ruleId === ruleId),
        ruleId,
      ).toEqual([]);
    }
  });

  it("should validate statically known For key strategies without rejecting dynamic values", async () => {
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

  it("should check resource cancellation and stable dependencies while accepting forwarded signals", async () => {
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

  it("should check For contracts, positional keys, and only reactive JSX map calls", async () => {
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

  it("should report async components, bad boot wiring, and SSR browser globals", async () => {
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

  it("should check route registry ownership, route syntax, controls, and data cancellation", async () => {
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

  it("should follow synchronous registry factory parameters across modules", async () => {
    const root = await fixture({
      "src/factory.ts": `
        import { createRouteRegistry, group } from "@askrjs/askr/router";
        export function withLayout(define: () => void) {
          return createRouteRegistry(() => group({}, () => define()));
        }
        export function directRegistry(define: () => void) {
          return createRouteRegistry(define);
        }
        export function forwardedRegistry(define: () => void) {
          return directRegistry(define);
        }
      `,
      "src/routes.ts": `
        import { createRouteRegistry, route } from "@askrjs/askr/router";
        import { withLayout, directRegistry, forwardedRegistry } from "./factory";
        withLayout(() => route("/wrapped", () => null));
        const define = () => route("/named", () => null);
        directRegistry(define);
        forwardedRegistry(() => route("/forwarded", () => null));
        function recursiveSection() { if (false) recursiveSection(); route("/recursive", () => null); }
        createRouteRegistry(() => recursiveSection());
      `,
    });
    expect(
      (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/route-registry"),
    ).toEqual([]);
  });

  it("should resolve workspace factory imports through a symlinked project root", async () => {
    const root = await fixture({
      "src/factory.ts": `
        import { createRouteRegistry } from "@askrjs/askr/router";
        export function registry(define: () => void) { return createRouteRegistry(define); }
      `,
      "src/routes.ts": `
        import { route } from "@askrjs/askr/router";
        import { registry } from "./factory";
        registry(() => route("/", () => null));
      `,
    });
    const aliases = await fixture({});
    const alias = path.join(aliases, "linked-project");
    await fs.symlink(root, alias, "junction");
    expect(
      (await diagnostics(alias)).filter((entry) => entry.ruleId === "askr/route-registry"),
    ).toEqual([]);
  });

  it("should avoid definite registry errors for unresolved callable definitions and factories", async () => {
    const root = await fixture({
      "src/routes.ts": `
        import { createRouteRegistry, route } from "@askrjs/askr/router";
        import { externalRegistry } from "external-package";
        declare const dynamicRegistry: (define: () => void) => unknown;
        declare const definition: () => void;
        const namedDefinition = () => route("/named-external", () => null);
        function localWrapper(define: () => void) { return externalRegistry(define); }
        function on(define: () => void) { return externalRegistry(define); }
        createRouteRegistry(definition);
        externalRegistry(() => route("/external", () => null));
        externalRegistry(namedDefinition);
        localWrapper(() => route("/wrapped-external", () => null));
        on(() => route("/custom-on", () => null));
        dynamicRegistry(() => route("/dynamic", () => null));
      `,
    });
    expect(
      (await diagnostics(root)).filter((entry) => entry.ruleId === "askr/route-registry"),
    ).toEqual([]);
  });

  it("should keep module-scope, deferred factory, timer and event registrations invalid", async () => {
    const root = await fixture({
      "src/routes.ts": `
        import { createRouteRegistry, route } from "@askrjs/askr/router";
        route("/outside", () => null);
        createRouteRegistry(() => {
          setTimeout(() => route("/timer", () => null), 0);
          document.addEventListener("click", () => route("/event", () => null));
          const neverCalled = () => route("/uninvoked", () => null);
        });
        function deferredRegistry(define: () => void) {
          return createRouteRegistry(() => setTimeout(() => define(), 0));
        }
        deferredRegistry(() => route("/deferred", () => null));
        createRouteRegistry(async () => {
          await Promise.resolve();
          route("/after-await", () => null);
        });
      `,
    });
    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/route-registry",
    );
    expect(found.filter((entry) => /outside/.test(entry.message))).toHaveLength(5);
    expect(found.filter((entry) => /async definition/.test(entry.message))).toHaveLength(1);
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

  it("should reject class overrides on every fully themed floating layer", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import {
          AlertDialogContent,
          AlertDialogOverlay,
          AlertDialogTrigger,
          DialogContent,
          DialogOverlay,
          DropdownContent,
          HoverCardContent,
          MenuContent,
          MenubarContent,
          MenubarSubContent,
          PopoverContent,
          SelectContent,
          TooltipContent,
        } from "@askrjs/ui";
        declare const overlayProps: Record<string, unknown>;
        export function Page() {
          return <>
            <AlertDialogOverlay class="dialog-overlay" />
            <AlertDialogContent class="dialog-content" />
            <DialogOverlay class="dialog-overlay" />
            <DialogContent class="dialog-content" />
            <DropdownContent class="floating" />
            <HoverCardContent class="floating" />
            <MenuContent class="floating" />
            <MenubarContent class="floating" />
            <MenubarSubContent class="floating" />
            <PopoverContent class="floating" />
            <SelectContent class="floating" />
            <TooltipContent class="floating" />
            <DialogOverlay className="named-overlay" />
            <DialogOverlay />
            <AlertDialogTrigger className="trigger" />
            <DialogOverlay class="ignored" {...overlayProps} />
          </>;
        }
      `,
    });

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-slot-style-override",
    );
    expect(found).toHaveLength(13);
    expect(found.every((entry) => entry.severity === "error")).toBe(true);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/AlertDialogOverlay/);
    expect(found.map((entry) => entry.message).join("\n")).toMatch(/TooltipContent/);
    expect(found.every((entry) => entry.message.includes("data-slot"))).toBe(true);
    expect(found.every((entry) => entry.remediation?.includes("theme tokens"))).toBe(true);
  });

  it("should warn when Block combines class and flex-layout prop authority", async () => {
    const staticRoot = await fixture({
      "src/page.tsx": `
        import { Block } from "@askrjs/themes/components";
        export const Page = () => <Block className="domain-section-header" direction="row" />;
      `,
    });
    const responsiveRoot = await fixture({
      "src/page.tsx": `
        import { Block as LayoutBlock } from "@askrjs/themes/components";
        export const Page = () => (
          <LayoutBlock class="domain-section-header" direction={{ base: "column", sm: "row" }} gap="sm" />
        );
      `,
    });
    const safeRoot = await fixture({
      "src/page.tsx": `
        import { Block } from "@askrjs/themes/components";
        declare const props: Record<string, unknown>;
        export const Page = () => <>
          <Block className="panel" padding="sm" />
          <Block direction="row" />
          <Block className="panel" />
          <Block className="panel" direction="row" {...props} />
        </>;
      `,
    });

    const staticFound = (await diagnostics(staticRoot)).filter(
      (entry) => entry.ruleId === "askr/block-layout-authority-conflict",
    );
    const responsiveFound = (await diagnostics(responsiveRoot)).filter(
      (entry) => entry.ruleId === "askr/block-layout-authority-conflict",
    );
    const safeFound = (await diagnostics(safeRoot)).filter(
      (entry) => entry.ruleId === "askr/block-layout-authority-conflict",
    );

    expect(staticFound).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringMatching(/className.*layout props \(direction\)/),
      }),
    ]);
    expect(responsiveFound).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringMatching(/class.*direction, gap/),
      }),
    ]);
    expect(safeFound).toEqual([]);
  });

  it("should report state writes during render but accepts event-handler writes", async () => {
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

  it("should preserve same-named state ownership across sibling components", async () => {
    const root = await fixture({
      "src/page.tsx": `
        import { state } from "@askrjs/askr";
        export function First() {
          const count = state(0);
          count.set(1);
          return <div>{count()}</div>;
        }
        export function Second() {
          const count = state(0);
          count.set(2);
          return <div>{count()}</div>;
        }
      `,
    });

    const found = await diagnostics(root);
    expect(found.filter((entry) => entry.ruleId === "askr/state-render-write")).toHaveLength(2);
  });

  it("should report malformed source and analyze JavaScript without a tsconfig", async () => {
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

  it("should keep dependency declaration graphs out of analysis programs", async () => {
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

  it("should exempt test color fixtures without exempting production paths or other rules", async () => {
    const exempt = [
      "src/palette.test.ts",
      "src/palette.tests.tsx",
      "src/palette.spec.jsx",
      "src/palette.tests.mts",
      "src/palette.tests.cts",
      "src/palette.tests.mjs",
      "src/palette.tests.cjs",
      "src/tests/palette.ts",
      "src/test/palette.js",
      "src/__tests__/nested/palette.ts",
      "src/fixtures\\tests\\palette.ts",
    ];
    const production = [
      "src/contest.ts",
      "src/testimonials/palette.ts",
      "src/tests-utils/palette.ts",
      "src/palette.tests-helper.ts",
      "src/palette.test.config.ts",
    ];
    const root = await fixture({
      ...Object.fromEntries(
        [...exempt, ...production].map((file) => [file, 'export const color = "#5c2d91";']),
      ),
      "src/tests/tokens.ts": 'export const token = "--ak-color-text";',
      "src/tests/cancellation.ts": `
        import { createQuery } from "@askrjs/askr/data";
        export function Page() {
          createQuery({ key: "private", fetch: () => fetch("/private") });
          return null;
        }
      `,
    });
    const report = await runAnalysis({ cwd: root, workspacePatterns: [], check: true });
    const found = report.diagnostics.filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(found.map((entry) => entry.file).sort()).toEqual(
      [...production, "src/tests/tokens.ts"].sort(),
    );
    expect(found.every((entry) => entry.severity === "warning")).toBe(true);
    expect(
      report.diagnostics.some(
        (entry) =>
          entry.ruleId === "askr/data-cancellation" && entry.file === "src/tests/cancellation.ts",
      ),
    ).toBe(true);
    expect(report.schemaVersion).toBe(1);
    expect(report.appliedFixes).toEqual([]);
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

  it("should honor root and nested gitignore rules including negation", async () => {
    const root = await fixture(
      {
        ".gitignore": ["legacy/*/", "ignored/*.ts", "!ignored/kept.ts", "/ignored-root.ts"].join(
          "\n",
        ),
        "src/page.ts": `export const token = "--ak-color-text";`,
        "legacy/framework/src/foreign.ts": `export const token = "--ak-color-surface";`,
        "ignored/dropped.ts": `export const token = "--ak-color-border";`,
        "ignored/kept.ts": `export const token = "--ak-color-primary";`,
        "ignored-root.ts": `export const token = "--ak-color-danger";`,
        "nested/.gitignore": ["*.ts", "!kept.ts"].join("\n"),
        "nested/dropped.ts": `export const token = "--ak-color-warning";`,
        "nested/kept.ts": `export const token = "--ak-color-success";`,
      },
      {
        tsconfig: {
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            target: "ES2022",
          },
          include: ["src", "legacy", "ignored", "nested", "ignored-root.ts"],
        },
      },
    );

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(found.map((entry) => entry.file)).toEqual([
      "ignored/kept.ts",
      "nested/kept.ts",
      "src/page.ts",
    ]);
  });

  it("should apply project-root gitignore rules to nested workspaces", async () => {
    const root = await fixture(
      {
        ".gitignore": "packages/app/ignored.ts\n",
        "packages/app/package.json": JSON.stringify({
          name: "@fixture/app",
          dependencies: { "@askrjs/askr": "^0.0.70" },
        }),
        "packages/app/src/page.ts": `export const token = "--ak-color-text";`,
        "packages/app/ignored.ts": `export const token = "--ak-color-surface";`,
      },
      {
        manifest: {
          name: "fixture-root",
          private: true,
          workspaces: ["packages/*"],
        },
        tsconfig: null,
      },
    );

    const found = (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );
    expect(found).toEqual([
      expect.objectContaining({ workspace: "@fixture/app", file: "src/page.ts" }),
    ]);
  });

  it("should honor exclusions and rule severity configuration", async () => {
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

  it("should report lifecycle, stream, data, invalidation, and island contract violations", async () => {
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

  it("should report mixed execution models, action defects, discarded submits, and render allocations", async () => {
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

  it("should accept valid contracts and ignore similarly named unrelated APIs", async () => {
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

  it("should cover the static-analysis backlog with conservative positive and negative cases", async () => {
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
        import { For, createQueryCollection, createQuery as query, resource, state as cell, type QueryDefinition } from "@askrjs/askr";
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
      "src/conditional-controls.tsx": `
        import { Case, For, Match, Show } from "@askrjs/askr/control";
        export function Conditional(props: { open: boolean; items: readonly { id: string }[] }) {
          return <>
            {props.open ? <For each={props.items} by={(item) => item.id}>{(item) => <span>{item.id}</span>}</For> : null}
            {props.open ? <Show when={true}>visible</Show> : null}
            {props.items.map((item) => <Case key={item.id}><Match when={true}>{item.id}</Match></Case>)}
          </>;
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
    expect(
      found.filter(
        (entry) =>
          entry.file === "src/conditional-controls.tsx" &&
          entry.ruleId === "askr/stable-control-boundary",
      ),
    ).toEqual([]);
    expect(
      found.filter(
        (entry) =>
          entry.file === "src/backlog.tsx" && entry.ruleId === "askr/stable-control-boundary",
      ),
    ).toHaveLength(1);
    expect(found.find((entry) => entry.ruleId === "askr/import-subpath")?.fix).toMatchObject({
      safe: true,
    });
    expect(
      found.find((entry) => entry.ruleId === "askr/route-scope-structure" && entry.fix)?.fix,
    ).toMatchObject({ safe: true });
  });
});
