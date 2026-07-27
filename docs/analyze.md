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
  mutations where the AST establishes a component render context. Local
  wrapper summaries follow aliases, namespace imports, re-export barrels,
  nested calls, and cycles, so conditionally calling a helper that transitively
  claims a render slot is reported at the helper call. It also
  reports eager control primitives such as `<For>`, `<Show>`, and `<Case>`
  placed directly behind a non-constant ternary or logical expression, or
  reached only after a conditional early return.
  Conditionally mounted components are not reported because each component
  owns a separate render scope.
- `askr/render-side-effect` reports high-confidence platform timers, observers,
  event listeners, and subscriptions started during component render, including
  starts hidden behind local wrappers. A `task()` callback is accepted only
  when its returned cleanup matches the timer handle, observer instance, or
  listener tuple it started.
- `askr/state-access` reports state getters used without calling them in JSX
  expressions or direct returns, and setters called without a value or updater.
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

- `askr/prefer-for` reports `.map()` when its array result flows directly into
  JSX children. Data transforms outside JSX, JSX attribute values, joined text,
  and transforms passed to `<For each={...}>` remain valid.
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

`npm run bench:analyze` runs the analyzer's Vitest benchmark suite. Its cold
full-analysis workloads cover 50 files, 250 files, five workspaces containing
250 files, a 200-function cyclic wrapper graph reached through 12 re-export
barrels, and the shipped startkit template. Hot rule workloads cover every
registered diagnostic, cyclic summary propagation, and exact lifecycle cleanup
matching. A coverage contract fails when a rule or benchmark is added without
classification and an explicit budget. The enforced mean budgets are 100 ms,
250 ms, 300 ms, 100 ms, 100 ms, 5 ms, 6 ms, and 5 ms for those workloads. The
general `npm run bench` gate separately checks the installed CLI, including a
cold startkit scan against a 1000 ms p95 budget.

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
relative to each workspace and extend the built-in defaults. The analyzer
always ignores dependency, VCS, coverage, generated, and common build-output
directories by default, including `.askr/**`, `dist/**`, and `build/**`.
TypeScript `include` entries do not re-enable those generated directories;
analyze the original source that produced an artifact instead.

## CI

Use check mode so CI cannot change the checkout:

```bash
askr analyze --check
```

JSON output is one deterministic object containing schema version `1`, the
project root, discovered and selected workspaces, per-workspace program details,
applied and skipped fixes, sorted diagnostics, and summary counts.
