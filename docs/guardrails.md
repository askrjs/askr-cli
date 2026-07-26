# Project guardrails

Askr projects ship with one recovery loop for humans, CI, and AI agents:

```bash
askr doctor
askr repair
askr check
```

## `askr doctor`

`doctor` performs a read-only health inspection. It checks:

- the active Node version against the CLI support range;
- package-manager declaration and lockfile consistency;
- `@askrjs/askr` declarations in source workspaces;
- presence and byte-level freshness of project-local Askr agent skills;
- all `askr analyze --check` diagnostics.

Warnings are advisory. Environment, package-manager, framework dependency, and
analysis errors make the command exit `1`.

```bash
askr doctor
askr doctor --cwd ./apps/web
askr doctor --json
```

## `askr repair`

`repair` applies the analyzer's explicitly safe fixes as one transaction, runs
analysis again, and reports semantic findings that still require judgment.

```bash
askr repair
askr repair --workspace "@example/web"
askr repair --json
```

Route-parameter conversion and plain-JSON JSX runtime configuration are safe
fixes today. Moving lifecycle calls, changing collection keys, and other
semantic rewrites remain report-only. Run `repair` again after manual edits; a
clean second run applies no changes.

## `askr check`

`check` is the default completion gate in generated projects. It first runs
read-only static analysis. Blocking findings skip later work so the fastest,
most actionable failure is reported first. Once analysis is clean, it runs each
declared root script in this order:

1. `lint`
2. `typecheck`
3. `test`
4. `build`

Missing scripts are ignored. The command uses the declared package manager or
the single detected lockfile and never invokes the project's `check` script,
which prevents recursion.

```bash
askr check
askr check --workspace "@example/web"
askr check --json
```

Human output includes child-script output and a pass/fail summary. JSON output
uses schema version `1` and contains the full analyzer report plus deterministic
script results.

## Recovery workflow

When a first implementation is wrong:

```bash
askr doctor
askr repair
# review any remaining semantic diagnostics
askr check
```

Generated projects expose the same loop through `npm run check`. Their
project-local `AGENTS.md` files direct agents to use `askr repair` and
`askr check` before declaring work complete.
