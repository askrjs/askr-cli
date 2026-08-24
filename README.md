# @askrjs/cli

[![CI](https://github.com/askrjs/askr-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/askrjs/askr-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40askrjs%2Fcli.svg)](https://www.npmjs.com/package/@askrjs/cli)

Unified CLI for the Askr platform.

`@askrjs/cli` bundles project scaffolding and static-site generation commands
for Askr apps. It also installs the agent skills that teach AI assistants how to
build idiomatic Askr code. Use it when you want a new project, repeatable SSG
builds, prompt-to-app blueprints, route generators, or project-local `skills/`
guidance.

## Install

```bash
npm install -g @askrjs/cli
```

## Quick Start

```bash
npm install -g @askrjs/cli
askr create startkit my-app
cd my-app
npm run dev
```

Prompt-first scaffolding is also supported:

```bash
askr create --prompt "Agent workflow console with approvals and analytics"
```

The CLI uses deterministic weighted keyword matching to select a template,
prints the matched terms and selection reason, writes `.askr/blueprint.json`
and `.askr/builder-brief.md`, and installs bundled Askr skills into `skills/`
unless you opt out with `--no-skills`. Full-stack terms have weight 6, SSR and
SSG terms weight 4, SPA and startkit terms weight 3, and startkit has a
one-point default. An explicit positional template overrides prompt-based
template selection, while the prompt can still supply an inferred app name.

## Commands

- `askr create [template] <name> [--prompt <text>] [--no-install] [--no-skills]`
- `askr add page <name> [--branch app|public]`
- `askr add action <name> --route <path>`
- `askr add database postgres|sqlite [--cwd <dir>] [--force]`
- `askr analyze [--cwd <dir>] [--workspace <pattern>]... [--json] [--check]`
- `askr doctor [--cwd <dir>] [--workspace <pattern>]... [--json]`
- `askr repair [--cwd <dir>] [--workspace <pattern>]... [--json]`
- `askr check [--cwd <dir>] [--workspace <pattern>]... [--json]`
- `askr database validate|generate [--database <name>] [--json]`
- `askr database migration create|status|plan|apply|resolve ...`
- `askr skills list`
- `askr skills install [--cwd <dir>] [--force]`
- `askr skills sync [--cwd <dir>]`
- `askr ssg --config <path> --output <dir> [--incremental]`
- `askr openapi [--entry ./src/api.ts] [--output ./openapi.yml] [--check]`
- `askr outdated [packages...] [--workspace <glob>] [--tag <tag>] [--json]`
- `askr update [packages...] [--workspace <glob>] [--tag <tag>] [--json]`
- `askr upgrade [packages...] [--workspace <glob>] [--tag <tag>] [--json]`

The installed command is `askr`. Subcommands are intentionally not published
as compatibility binaries.

## Static analysis

`askr analyze` discovers the containing npm or pnpm workspace, builds a
TypeScript compiler program for every selected workspace, and checks current
Askr state, lifecycle, data, control-flow, routing, boot, SSR/SSG, action, and
configuration contracts.

```bash
askr analyze
askr analyze --workspace "@scope/web"
askr analyze --check
askr analyze --json --check
```

All diagnostics include a stable rule ID and workspace-relative source
location. The analyzer distinguishes canonical Askr imports from unrelated
same-named functions and only recommends `<For>` for state-backed reactive JSX
collections, so static transforms with `.map()` remain valid.

By default it transactionally applies only mechanical route-parameter and
plain-JSON JSX configuration fixes. `--check` is read-only for CI. Semantic
rewrites, including `.map()` to `<For>`, conditional primitives, and key
changes, are always report-only. See the
[analyze command reference](./docs/analyze.md) for rules and configuration.

## Project recovery loop

Every generated project uses the same guardrail loop:

```bash
askr doctor
askr repair
askr check
```

`doctor` performs a read-only environment, package-manager, framework, skills,
and static-analysis inspection. `repair` transactionally applies only safe
mechanical fixes and reports remaining semantic work. `check` requires clean
analysis before running the project's declared lint, typecheck, test, and build
scripts in order. When `database/index.ts` exists, `check` first delegates
database validation to the project's installed `@askrjs/orm` tooling.
Generated projects expose that final gate as `npm run check`.

## Database tooling

`askr database ...` is a lazy front end. The CLI resolves
`@askrjs/orm/tooling` from the target project and delegates the complete
command, so schema generation and migration semantics always match the
project's installed ORM version. See the
[database command reference](./docs/database.md).

See the [project guardrails reference](./docs/guardrails.md) for command and JSON
contracts.

## Static sitemap generation

`askr ssg` writes `sitemap.xml` from the concrete routes generated during the
build. Set the canonical deploy URL in the TypeScript config:

```ts
export const staticConfig = {
  registry,
  outputDir: "./dist",
  siteUrl: "https://example.com",
  sitemap: {
    defaults: { changeFrequency: "weekly" },
    routes: {
      "/404": false,
      "/docs": { priority: 0.8, lastModified: "2026-07-18" },
    },
  },
};
```

The sitemap config types are available from `@askrjs/cli/ssg` for projects that
want an explicit annotation.

Successful and incrementally skipped concrete routes are included by default.
Failed routes and wildcard templates are excluded. Route settings support a
canonical URL override, `lastModified`, `changeFrequency`, `priority`, and
`hreflang` alternates. Use `resolve(route)` for data-driven metadata or return
`false` to exclude a route. Set `sitemap: false` for an intentional opt-out.

The CLI validates real calendar dates, bounds asynchronous metadata resolution,
and enforces the sitemap protocol limits of 50,000 URLs and 50 MB per file.
Larger sites receive deterministic sitemap chunks plus a sitemap index. It also
creates or updates `robots.txt` while preserving unrelated directives and tracks
owned files so stale chunks and previous output paths are removed. Full and
incremental builds publish through a sibling staging directory, so route output,
metadata, assets, and sitemap artifacts change together or not at all.

## OpenAPI artifacts

`askr openapi` loads a TypeScript module whose default export exposes
`toOpenApiDocument()`, then writes deterministic YAML atomically. It defaults to
`./src/api.ts` and `./openapi.yml`:

```bash
askr openapi
askr openapi --check
```

Use `--entry` or `--output` to override either path. Check mode performs no
writes and exits unsuccessfully when the artifact is missing or differs by even
one byte, making it suitable for CI drift checks.

The first shipped generator is `askr add page`, which scaffolds a page file and
registers it in route-first SPA branches (`src/pages/app/_routes.tsx` or
`src/pages/public/_routes.tsx`).

## Dependency updates

The dependency commands are Askr-owned and discover
the containing npm or pnpm workspace from nested directories, include the root
manifest and declared workspaces, and reports safe, breaking, local, manual,
and failed decisions without running an install.

```bash
askr outdated
askr update
askr upgrade
askr upgrade --force
askr update vite "@types/*"
askr update --workspace "@scope/app" --tag next --json
```

`askr update` writes safe range changes. `askr upgrade` jointly selects the newest
peer-compatible published versions up to each package's configured dist-tag,
including breaking changes. Required peers must be present; optional peers may
be absent. `askr upgrade --force` writes the dist-tag targets directly and skips
peer checks. Positional selection is strict: unselected dependencies constrain
the solution but are never rewritten.

The updater preserves exact, caret, tilde, and x-range styles. It can widen one
bounded interval, and it updates only the highest clause of a simple OR union.
Complex ranges, npm aliases, and other ambiguous specifications are reported as
manual. Workspace, file, link, Git, URL, tracking-tag, and wildcard declarations
are not rewritten.

Only `package.json` dependency values are changed. The command never writes a
lockfile, installs packages, runs lifecycle scripts, or edits overrides,
resolutions, catalogs, or `packageManager` metadata. See the
[update command reference](./docs/update.md) for policy and output details.

## Agent skills

Install the bundled Askr skills into a project:

```bash
askr skills install
```

New projects created with `askr create` already receive the bundled skills by
default. Use `--no-skills` when you need a minimal scaffold.

Use `sync` to update an existing project. It overwrites bundled `askr-*` skill
folders and removes obsolete `askr-*` folders, while preserving unrelated
custom skills.

```bash
askr skills sync
```

The bundled skills include guidance for route-first project structure, API
integration, auth/access, agent workflows, realtime/event-sourced UX, eventual
consistency, observability, accessibility, file/artifact flows, the Askr mental
model, and agent execution discipline.

## Templates

Supported templates for `create`:

- `spa`
- `ssr`
- `ssg`
- `full-stack`
- `startkit`

Templates are stored in `templates/`.

## Docs

- [CLI docs](./docs/README.md)
