# CLI Overview

The `@askrjs/cli` package is the command-line surface for the Askr platform.

## CLI philosophy

The CLI exists to:

- Reduce boilerplate - you describe what you want, the CLI writes the files
- Enforce conventions - generated code follows platform standards
- Standardize structure - every generated project starts from the same foundation
- Accelerate feature creation - generators produce the right files in the right places
- Install agent skills - `.skills` guidance teaches AI agents the same conventions

Generated code has no runtime dependency on the CLI. Once scaffolded, the CLI is a dev-time
tool only. You can read and modify every generated file without affecting how the CLI works.

## Install and run

Install the CLI once, then use `askr` as the canonical entrypoint.

```bash
npm install -g @askrjs/cli
askr --help
```

Compatibility aliases are also exposed:

- `askr-cli`
- `askr-create`
- `askr-ssg`

## Core commands

### Project lifecycle

```bash
askr create [template] <name>   # Scaffold a new project
askr skills install             # Install bundled Askr agent skills
askr skills sync                # Update bundled Askr agent skills
askr ssg --config <path>        # Run static site generation
```

### Project templates

| Template   | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| `spa`      | Client-rendered app with router support                            |
| `ssr`      | Server-rendered app scaffold                                       |
| `ssg`      | Static generation scaffold with `ssg.config.ts`                    |
| `startkit` | Full application starter: dashboards, auth screens, full structure |

```bash
askr create startkit my-app
askr create spa my-dashboard
```

### Planned generators

These commands are on the roadmap. They will scaffold feature code into an existing project.

```bash
askr add page <name>    # Add a new route + page component
askr add route <path>   # Register a new route in the router
askr add crud <model>   # Scaffold full CRUD UI for a model
askr add table <name>   # Generate a data table component
askr add form <name>    # Generate a form component
```

Generated code follows the [conventions](https://github.com/askrjs/askr/tree/main/docs/reference/conventions.md) and [project structure](https://github.com/askrjs/askr/tree/main/docs/reference/project-structure.md) expected by the platform.

### Agent skills

```bash
askr skills list
askr skills install
askr skills sync
```

Skills are copied into `.skills/` as project-local dev-time guidance. `install`
is conservative for new projects; `sync` updates bundled `askr-*` skills while
preserving unrelated custom skills.

## See also

- [create](./create.md) - full `create` command reference
- [skills](./skills.md) - install and sync bundled agent skills
- [add](./add.md) - generator command reference
- [workflows](./workflows.md) - common CLI workflows end to end
