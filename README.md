# @askrjs/cli

Unified CLI for the Askr platform.

`@askrjs/cli` bundles project scaffolding and static-site generation commands
for Askr apps. It also installs the agent skills that teach AI assistants how to
build idiomatic Askr code. Use it when you want a new project, repeatable SSG
builds, or project-local `.skills` guidance.

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

## Commands


- `askr create [template] <name> [--no-install]`
- `askr skills list`
- `askr skills install [--cwd <dir>] [--force]`
- `askr skills sync [--cwd <dir>]`
- `askr ssg --config <path> --output <dir> [--incremental]`

The canonical installed command is `askr`. Compatibility aliases `askr-cli`, `askr-create`, and `askr-ssg` are also provided.

## Agent skills

Install the bundled Askr skills into a project:

```bash
askr skills install
```

Use `sync` to update an existing project. It overwrites bundled `askr-*` skill
folders and removes obsolete `askr-*` folders, while preserving unrelated
custom skills.

```bash
askr skills sync
```

The bundled skills include guidance for route-first project structure, API
integration, auth/access, agent workflows, realtime/event-sourced UX, eventual
consistency, observability, accessibility, and file/artifact flows.

## Templates

Supported templates for `create`:

- `spa`
- `ssr`
- `ssg`
- `startkit`

Templates are stored in `templates/`.

## Docs

- [CLI docs](./docs/README.md)
