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
`@askrjs/askr` and its public subpaths. A same-named function imported from
another package or local module is not treated as an Askr API.

### Correctness

- `askr/parse-error` reports malformed source before other results can be
  considered complete.
- `askr/stable-render-call` enforces stable top-level calls for state, derived
  values, selectors, resources, lifecycle operations, actions, queries, and
  mutations where the AST establishes a component render context.
- `askr/state-access` reports state getters used without calling them and
  setters called without a value or updater.
- `askr/state-render-write` reports state mutation during the owning component's
  render while allowing updates in event callbacks.
- `askr/resource-cancellation` and `askr/data-cancellation` report fetch-based
  resource, query, and mutation loaders that do not forward their cancellation
  signal.
- `askr/for-contract` requires `each`, an item renderer, and exactly one of
  `by` or `byIndex`.
- `askr/control-contract` validates required `Show` and `Match` conditions and
  direct `Case`/`Match` structure.
- `askr/no-async-component` reports async JSX components.
- `askr/route-registry` keeps route DSL calls inside a synchronous
  `createRouteRegistry()` definition.
- `askr/route-path-syntax` enforces `{name}` route parameters.
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
250 ms, and 300 ms respectively. The general `npm run bench` gate also checks a
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

Rule values are `error`, `warning`, `info`, or `off`. Exclusions are applied
relative to each workspace. The analyzer always ignores dependency, VCS,
coverage, generated, and common build-output directories by default.

## CI

Use check mode so CI cannot change the checkout:

```bash
askr analyze --check
```

JSON output is one deterministic object containing schema version `1`, the
project root, discovered and selected workspaces, per-workspace program details,
applied and skipped fixes, sorted diagnostics, and summary counts.
