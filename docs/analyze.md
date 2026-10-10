# analyze

`askr analyze` performs workspace-aware static checks for current Askr APIs.
It uses the TypeScript compiler API with each selected workspace's
`tsconfig.json`, when present, and also scans JavaScript and TypeScript source
files that are not listed by that config.

```bash
askr analyze
askr analyze --workspace "@example/web"
askr analyze --workspace "apps-*" --workspace "shared-*"
askr analyze --check
askr analyze --json --check
askr analyze --cwd ./apps/web
```

The command discovers the containing npm or pnpm workspace. It scans the root
and every declared workspace by default. Repeat `--workspace` to select workspace
names with minimatch patterns.

## Diagnostics

Every diagnostic has a stable rule ID, category, severity, message, workspace,
workspace-relative file, one-based line and column, and optional remediation.
Output is sorted by workspace, file, position, rule ID, and message.

The analyzer resolves named aliases and namespace imports from
`@askrjs/askr`, `@askrjs/ui`, `@askrjs/themes/components`, and their supported
public subpaths. A same-named function imported from another package or local
module is not treated as an Askr API.

### Correctness

- `askr/parse-error` reports malformed source before other results can be
  considered complete.
- `askr/no-hardcoded-theme-token` reports `--ak-*` token names in runtime
  JavaScript and TypeScript string, template, and JSX attribute literals. The
  exact `@askrjs/themes` workspace is exempt because it owns those declarations.
  The same rule reports runtime color literals outside framework and theme owner
  packages. Color fixtures are exempt in `test/`, `tests/`, and `__tests__/`
  directories and files ending in `.test`, `.tests`, or `.spec` with a supported
  JavaScript or TypeScript extension, including `.mjs`, `.cjs`, `.mts`, and `.cts`.
  Both `/` and `\\` path separators are recognized. This exemption applies only
  to color literals: token names, cancellation, and other rules still run in tests.
- `askr/stable-render-call` enforces stable top-level calls for state, derived
  values, selectors, resources, lifecycle operations, actions, queries, and
  mutations where the AST establishes a component render context.
- `askr/stable-control-boundary` reports statically resolved `defineScope()`
  calls created conditionally during rendering. `For`, `Show`, and `Case` are
  lazy controls and may be rendered conditionally.
- `askr/render-scope-required` reports render-owned primitives created in
  statically non-render callbacks such as handlers, timers, Promise
  continuations, and task bodies. It also reports module-scope or non-render
  calls to `readScope()`, `getSignal()`, `routeData()`, and `ErrorBoundary()`;
  `readScope()` remains valid in a `resource()` loader.
- `askr/exhaustive-dependencies` compares direct same-component reactive reads
  with literal `resource` and `stream` dependency arrays. Dynamic arrays,
  spreads, and uninvoked nested functions are deliberately skipped.
- `askr/for-row-closure-capture` reports direct reactive reads and one-hop
  snapshots captured by a `For` row renderer. Function-valued JSX props remain
  valid.
- `askr/state-access` reports state getters used without calling them and
  setters called without a value or updater.
- `askr/state-render-write` reports state mutation during the owning component's
  render while allowing updates in event callbacks.
- `askr/resource-cancellation` and `askr/data-cancellation` report fetch-based
  resource, query, and mutation loaders that do not forward their cancellation
  signal.

  `askr/data-cancellation` also recognizes direct, statically named calls on a
  canonical `createClient()` result and calls to a `createFetch()` result from
  `@askrjs/fetch`. Pass the query context's signal, or the mutation's second
  context parameter signal, in each request input:

  ```ts
  const records = createQuery({
    key: "records",
    fetch: ({ signal }) => client.records({ signal }),
  });
  ```

  Import aliases, namespace imports, function declarations and const local
  loaders retain their ownership. Const aliases of Fetch factories, clients,
  operation contexts, signals and request inputs are followed for up to eight
  links; cycles and longer chains remain unknown. Mutable loader variables are
  skipped. An unrelated variable named `signal` does not satisfy the rule, and
  forwarding to one request does not cover another request. Literal operation
  options and request inputs are evaluated in overwrite order. A later unknown
  options spread invalidates an earlier loader; a later explicit loader restores
  it. For request inputs:
  `{ ...input, signal: wrong }` reports, while `{ signal: wrong, ...input }`
  remains unknown and is accepted. Computed literal `context["signal"]` and
  signal destructuring are supported. Observed writes or escapes invalidate a
  const request object's initializer; mutable and opaque signal expressions
  (including composed signals) remain unknown. Unknown inputs, dynamic endpoints,
  unresolved clients/service calls and uninvoked nested callbacks are skipped.
  The rule does not follow a request into a service function or prove runtime
  cancellation. It reports one concrete offending request per loader and
  retains warning severity; `--check` exits unsuccessfully for warnings.

- `askr/for-contract` requires `each`, an item renderer, and exactly one of
  `by` or `byIndex`.
- `askr/control-contract` validates required `Show` and `Match` conditions and
  direct `Case`/`Match` structure; `Case` otherwise permits only null, false,
  and whitespace children.
- `askr/stable-module-identity` reports `lazy()` and `defineScope()` created
  directly during a proven component render.
- `askr/no-async-component` reports async JSX components.
- `askr/route-registry` keeps route DSL calls inside a synchronous
  `createRouteRegistry()` definition. It follows workspace function arguments
  through synchronous registry factories and directly invoked helpers, including
  local imports. Nested timers, event handlers, and uninvoked functions do not
  inherit registry ownership. Unresolved callable definitions and external
  factory flow remain uncertain rather than producing a definite misuse error;
  missing, statically non-callable, and async definitions still produce errors.
  Parameter forwarding is bounded to 16 steps and stops at cycles.
- `askr/route-path-syntax` mirrors the runtime's static path validation,
  including leading and duplicate slashes, complete `{name}` interpolation,
  non-empty unique parameter names, final named splats, and non-empty page
  paths.
- `askr/route-scope-structure` follows named definitions and groups to report
  nested pages, duplicate page indexes, and absolute child routes. A proven
  child-route leading slash has a safe fix.
- `askr/link-contract` requires one unambiguous destination, rejects the
  runtime's unsafe URL schemes, and checks static `to(routeRef, { ... })`
  parameter objects against workspace route declarations. Dynamic objects and
  spreads are deliberately skipped. Relative links plus `http`, `https`,
  `mailto`, `tel`, and `sms` remain valid.
- `askr/no-slot-style-override` rejects non-empty `class` and `className` props
  on fully themed floating-layer content and overlay components. Customize the
  owning theme tokens instead. Components with a spread are skipped because
  the analyzer cannot prove the final prop set.
- `askr/block-layout-authority-conflict` warns when `Block` combines a
  non-empty `class` or `className` with `direction`, `align`, `justify`, `gap`,
  or `wrap`. Choose either the class or the component props as the element's
  flex-layout authority. Components with a spread are skipped.
- `askr/query-key-contract` reports directly provable nondeterministic and
  Symbol query key/scope parts; dynamic values are left alone.
- `askr/import-subpath` groups named root imports by their owning public Askr
  subpath in one transactional fix per declaration while retaining aliases,
  type modifiers, and valid root specifiers. It routes lazy controls to
  `@askrjs/askr/control` and query APIs and types to `@askrjs/askr/data`.
- `askr/no-effect-data-loading` reports direct fetch-to-component-state flows
  in `task()` callbacks; arbitrary service-call inference is intentionally out
  of scope.
- `askr/testing-contract` requires a synchronous `flush()` or `result.flush()`
  between canonical testing `dispatch()` and the next assertion in a block.
- `askr/boot-registry` requires an explicit registry and an observed Promise for
  `createSPA()` and `hydrateSPA()`.
- `askr/ssr-browser-global` reports unguarded browser globals in SSR and SSG
  modules.

### Performance

- `askr/prefer-for` reports JSX `.map()` only when its receiver is proven to be
  an Askr state-backed reactive collection. Static array transforms remain
  valid.
- `askr/stable-key` reports index-returning `by` functions.
- `askr/stable-dependencies` reports object, array, function, and constructor
  allocations in resource dependency arrays.

### Configuration

- `askr/framework-config` validates the Askr JSX import source and detects a
  declared `@askrjs/vite` dependency that is absent from `vite.config.*`.

The rule catalog is intentionally extensible. Current concepts inventory
reactive state, lifecycle operations, queries, mutations, invalidation, control
flow, route DSL and registries, SPA and island boot, SSR, SSG, actions,
authorization, scopes, refs, and composition. Static analysis reports only
patterns it can establish from source and configuration; it does not run the
project's lint, tests, or build.

## Safe fixes

Without `--check`, the command applies only fixes whose intent is mechanical:

- convert route parameters such as `:id` to `{id}`;
- add a missing leading slash to a root route or collapse consecutive slashes;
- strip the leading slash from a statically proven child route;
- split misplaced named root imports into their documented public subpaths;
- add the Askr JSX runtime to a plain-JSON `tsconfig.json`.

All changed files are staged and replaced as one transaction. If any replacement
fails, completed replacements are rolled back. JSONC, inherited TypeScript
configuration, `.map()` to `<For>`, conditional render-scoped calls, invalid
keys, and other semantic changes are report-only.

`--check` performs no writes. Fixable diagnostics remain in the result and
appear under `skippedFixes` with a check-mode reason.

The command exits `1` while error or warning diagnostics remain, and `0` when
only informational or no diagnostics remain.

## Performance contract

The analyzer intentionally builds lightweight syntax programs: project source
and local path aliases are resolved, while standard-library and external
package declaration graphs are not loaded. Rules still distinguish canonical
Askr imports from unrelated local functions, but analysis does not pay the cost
of type-checking dependency declarations it never reports.

`npm run bench:analyze` runs the analyzer's Vitest benchmark suite. It covers a
50-file workspace, a 250-file workspace, and five workspaces containing 250
files in total. The benchmark reporter enforces mean-time budgets of 100 ms,
250 ms, and 300 ms respectively on the local profile. GitHub-hosted Ubuntu uses
an explicit 150/550/550 ms envelope: the pre-fix analyzer measured 104/459/426 ms
with the corrected harness in [baseline run 37943456683](https://github.com/askrjs/askr-cli/actions/runs/37943456683).
The old harness did not enforce these measurements. Both profiles reject missing,
failed, non-finite, and sample-free results; every fixture must produce its
expected source-file and diagnostic counts. Local targets remain unchanged.
The general `npm run bench` gate also checks a
cold installed-CLI scan of the 35-file startkit template against a 350 ms p95
budget.

## Configuration

Configure the analyzer in the workspace root `package.json`:

```json
{
  "askr": {
    "analyze": {
      "exclude": ["fixtures/**", "**/*.generated.ts"],
      "rules": {
        "askr/prefer-for": "error",
        "askr/stable-dependencies": "info",
        "askr/ssr-browser-global": "off"
      }
    }
  }
}
```

Rule values are `error`, `warning`, `info`, or `off`. Source discovery honors
`.gitignore` files from the project root through each selected workspace,
including nested rules and negation. `askr.analyze.exclude` adds analyzer-only
patterns relative to each workspace. The analyzer also always ignores dependency,
VCS, coverage, generated, and common build-output directories by default.

### Protected registries

Opt in to `askr/route-access-policy` for an exact exported route registry:

```json
{
  "askr": {
    "analyze": {
      "protectedRegistries": [{ "file": "src/pages/reports/_routes.ts", "export": "reportRoutes" }]
    }
  }
}
```

Paths name source files relative to the workspace root, without globs. Use a
named export or `"default"` for a canonical `createRouteRegistry()` call held by
a const binding or exported directly. Aliased exports and canonical import
aliases work. The definition must be a synchronous function authored in the
selected workspace; directly called same-workspace helpers are followed.
Generator and async definitions are unsupported. Call arguments are evaluated
in the caller's access scope; passing a function does not invoke its body.
Malformed, duplicate, missing or unsupported selected identities produce a
configuration error, including when diagnostics are off. Identities belonging
to unselected workspaces are left for their owning workspace's analysis.

The rule warns for each statically known `route()`, `index()` or `fallback()`
leaf without a callable `auth` requirement or non-empty `policies` array, either
on the leaf or inherited from a `group()` or `page()`. Equal paths in other
registries keep their own access scope. Public registries produce no findings
unless explicitly listed. Empty or absent configuration keeps this check off.

This is a check for authored policy presence. It does not assess policy strength,
evaluate grants or prove backend authorization. An allow-all policy still meets
this structural check. `appMeta.requiredGrants` is presentation metadata and
does not count as an access policy. Literal options respect overwrite order;
opaque options, unknown spreads, getters and dynamic callbacks are skipped
conservatively. Uninvoked callbacks are not route definitions. No automatic
policy or source fix is generated. Use the existing `rules` setting to select
`warning`, `error`, `info` or `off`; `--check` fails for warnings and errors.

## CI

Use check mode so CI cannot change the checkout:

```bash
askr analyze --check
```

JSON output is one deterministic object containing schema version `1`, the
project root, discovered and selected workspaces, per-workspace program details,
applied and skipped fixes, sorted diagnostics, and summary counts.
