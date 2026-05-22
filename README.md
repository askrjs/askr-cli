# @askrjs/cli

Unified CLI for the Askr platform.

`@askrjs/cli` bundles project scaffolding and static-site generation commands
for Askr apps. It also installs the agent skills that teach AI assistants how to
build idiomatic Askr code. Use it when you want a new project, repeatable SSG
builds, prompt-to-app blueprints, route generators, or project-local `.skills`
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

The CLI deterministically selects the best template, writes `.askr/blueprint.json`
and `.askr/builder-brief.md`, and installs bundled Askr skills into `.skills/`
unless you opt out with `--no-skills`.

## Commands

- `askr create [template] <name> [--prompt <text>] [--no-install] [--no-skills]`
- `askr add page <name> [--branch app|public]`
- `askr skills list`
- `askr skills install [--cwd <dir>] [--force]`
- `askr skills sync [--cwd <dir>]`
- `askr ssg --config <path> --output <dir> [--incremental]`

The canonical installed command is `askr`. Compatibility aliases `askr-add`, `askr-cli`, `askr-create`, and `askr-ssg` are also provided.

The first shipped generator is `askr add page`, which scaffolds a page file and
registers it in route-first SPA branches (`src/pages/app/_routes.tsx` or
`src/pages/public/_routes.tsx`).

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
- `startkit`

Templates are stored in `templates/`.

## Docs

- [CLI docs](./docs/README.md)
