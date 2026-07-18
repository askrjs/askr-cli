# CLI: create

Scaffold a new Askr project from a template.

## Usage

```bash
askr create [template] <name> [--dir <path>] [--prompt <text>] [--no-install] [--no-skills]
askr create --prompt <text> [name] [--no-install] [--no-skills]
```

## Arguments

| Argument   | Description                                                       |
| ---------- | ----------------------------------------------------------------- |
| `template` | Template to use: `spa`, `ssr`, `ssg`, `full-stack`, or `startkit` |
| `name`     | Output directory name for the new project                         |

If `name` is omitted while `--prompt` is present, the CLI derives a deterministic
slug from the prompt.

## Options

| Option         | Description                                        |
| -------------- | -------------------------------------------------- |
| `--dir <path>` | Use an explicit output directory                   |
| `--no-install` | Scaffold files without installing npm dependencies |
| `--no-skills`  | Skip installing bundled Askr skills into `skills/` |
| `--prompt`     | Infer the best template from a product prompt      |
| `--help`, `-h` | Show help                                          |

Names must be valid lowercase npm package names and cannot contain path
separators. Use `--dir` when the filesystem destination differs from the
package name. npm, pnpm, Yarn, and Bun are detected from the invoking package
manager. Scaffolding and optional installation happen in a sibling staging
directory; the destination is replaced only after every requested step passes.

If you omit the template or name, the CLI falls back to an interactive prompt.
The default template is `startkit`.

When you pass `--prompt`, the CLI selects a template deterministically, writes
`.askr/blueprint.json` and `.askr/builder-brief.md`, and installs the bundled
Askr skills into `skills/` unless you opt out with `--no-skills`.

The builder brief is intentionally operational, not just descriptive. It now includes:

- template-specific files to inspect first
- a deterministic skill execution order
- local golden-example file paths from the generated scaffold
- the full recommended skill list for tooling or follow-up review

Broad planning skills and overlapping UI-system skills are intentionally omitted from the default recommendation set unless the scaffold was derived from a prompt that clearly spans multiple surfaces.

```bash
askr create --prompt "Agent workflow console with approvals and analytics"
```

## Templates

### `spa`

Client-rendered SPA with router support. Use this for standard interactive applications.

```bash
askr create spa my-app
```

If you omit the template, you still get `startkit` by default:

```bash
askr create my-app
```

### `ssr`

Server-rendered app scaffold. Use this when you need SSR at the application boundary.

```bash
askr create ssr my-ssr-app
```

### `ssg`

Static site generation scaffold with a `ssg.config.ts` file pre-configured.

```bash
askr create ssg my-docs-site
```

### `full-stack`

The progressive stage after SPA and SSR. It composes pages and APIs with executable
schemas, declared actions, auth and CSRF seams, metadata, i18n, telemetry, and
Node/Vite production entrypoints.

```bash
askr create full-stack my-platform
cd my-platform
askr add action approve-request --route /requests/{id}
```

### `startkit`

Full application starter with common screens pre-built: dashboard, settings, accounts,
login. The recommended starting point for new product applications.

```bash
askr create startkit my-dashboard
```

Stack included:

- `askr` - runtime
- `askr-ui` - UI primitives
- `askr-themes` - default visual layer
- `askr-lucide` - icon set

The full-stack template additionally includes `@askrjs/schema`, `@askrjs/i18n`,
`@askrjs/otel`, `@askrjs/auth`, `@askrjs/server`, `@askrjs/node`, and
`@askrjs/vite/server`.

## See also

- [CLI overview](./overview.md)
- [Project structure](https://github.com/askrjs/askr/tree/main/docs/reference/project-structure.md)
