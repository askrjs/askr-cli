# CLI Overview

The `@askrjs/cli` package is the command-line surface for the Askr platform.

## CLI philosophy

The CLI exists to:

- Reduce boilerplate - you describe what you want, the CLI writes the files
- Enforce conventions - generated code follows platform standards
- Standardize structure - every generated project starts from the same foundation
- Accelerate feature creation - generators produce the right files in the right places
- Install agent skills - project-local `skills/` guidance teaches AI agents the same conventions
- Turn prompts into build-ready repos - prompt-aware scaffolding emits deterministic app blueprints for builders

Generated code has no runtime dependency on the CLI. Once scaffolded, the CLI is a dev-time
tool only. You can read and modify every generated file without affecting how the CLI works.

## Install and run

Install the CLI once, then use `askr` as the canonical entrypoint.

```bash
npm install -g @askrjs/cli
askr --help
```

No compatibility command aliases are published. Use the `askr` command and
its named subcommands.

## Core commands

### Project lifecycle

```bash
askr create [template] <name>   # Scaffold a new project
askr create --prompt "..."     # Infer a template and emit a builder blueprint
askr add page <name>            # Generate a route page into an existing SPA app
askr add action <name> --route /path # Generate a declared full-stack action
askr generate <openapi> -o <dir> # Generate a typed API client
askr openapi --entry <path>      # Export deterministic OpenAPI YAML
askr analyze --check             # Check Askr source without writing
askr doctor                      # Diagnose project and environment health
askr repair                      # Apply safe fixes and identify semantic work
askr check                       # Run analysis, lint, types, tests, and build
askr skills install             # Install bundled Askr agent skills
askr skills sync                # Update bundled Askr agent skills
askr ssg --config <path> --output <dir> # Run static site generation
askr outdated                   # Report available dependency updates
askr update                     # Apply safe dependency manifest updates
askr upgrade                    # Apply latest peer-compatible upgrades
askr upgrade --force            # Apply dist-tag targets without peer checks
```

### Project templates

| Template     | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `spa`        | Client-rendered app with router support                            |
| `ssr`        | Server-rendered app scaffold                                       |
| `ssg`        | Static generation scaffold with `ssg.config.ts`                    |
| `full-stack` | Pages, APIs, schemas, actions, auth, i18n, telemetry, Node/Vite    |
| `startkit`   | Full application starter: dashboards, auth screens, full structure |

```bash
askr create startkit my-app
askr create spa my-dashboard
askr create full-stack my-platform
askr create --prompt "Agent workflow console with approvals and analytics"
```

When you use `--prompt`, the CLI deterministically selects the best template,
writes `.askr/blueprint.json` and `.askr/builder-brief.md`, and installs the
bundled Askr skills into `skills/` unless you opt out with `--no-skills`.

### Generators

Shipped today:

```bash
askr add page <name>
askr add page ops/audit-log --branch public
askr add action approve-request --route /requests/{id}
```

`askr add page` currently targets route-first SPA projects created by
`askr create spa` and updates the owning `_routes.tsx` file directly.

`askr add action` targets projects created by `askr create full-stack`. It emits
a browser-safe descriptor, server-only handler, composition registration,
matched-route authorization, and a focused contract test.

Still planned:

These commands are still on the roadmap. They will scaffold feature code into an existing project.

```bash
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

Skills are copied into `skills/` as project-local dev-time guidance. `install`
is conservative for new projects; `sync` updates bundled `askr-*` skills while
preserving unrelated custom skills.

`askr create` now performs the equivalent of a bundled skill install for new
projects by default so agentic builders can work immediately against the local
Askr guidance.

## See also

- [create](./create.md) - full `create` command reference
- [skills](./skills.md) - install and sync bundled agent skills
- [add](./add.md) - generator command reference
- [workflows](./workflows.md) - common CLI workflows end to end
