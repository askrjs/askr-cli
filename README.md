# @askrjs/cli

Unified CLI for the Askr platform.

`@askrjs/cli` bundles project scaffolding and static-site generation commands
for Askr apps. Use it when you want a new project or when you need a repeatable
SSG build path.

## Install

```bash
npm install -D @askrjs/cli
```

## Quick Start

```bash
npx @askrjs/cli create startkit my-app
cd my-app
npm run dev
```

## Commands

- `askr-cli create [template] <name> [--no-install]`
- `askr-cli ssg --config <path> --output <dir> [--incremental]`

Direct command bins are also provided:

- `askr-create` for scaffolding
- `askr-ssg` for direct SSG entry

## Templates

Supported templates for `create`:

- `spa`
- `ssr`
- `ssg`
- `startkit`

Templates are stored in `templates/`.

## Docs

- [CLI docs](./docs/README.md)

