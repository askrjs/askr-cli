# CLI Workflows

End-to-end CLI workflows for common Askr tasks.

These workflows assume `@askrjs/cli` is installed globally, so the command surface is `askr {command} [args]`.

## Agent workflow defaults

The bundled skills are now meant to be used as task workflows, not just concept references. The default execution path is:

1. `askr-agent-execution`
2. `askr-mental-model`
3. `askr-project-structure`
4. `askr-routing-layouts`
5. `askr-runtime-reactivity`
6. One specialized workflow skill for the actual task
7. `askr-testing-determinism`

## Common task flows

### Add a page or route

- `askr-agent-execution`
- `askr-project-structure`
- `askr-routing-layouts`
- `askr-runtime-reactivity`
- `askr-testing-determinism`

### Add route-owned async data

- `askr-agent-execution`
- `askr-resources-data`
- `askr-error-loading-empty`
- `askr-testing-determinism`

### Add shared reads and writes

- `askr-agent-execution`
- `askr-query-mutation`
- `askr-error-loading-empty`
- `askr-testing-determinism`

### Integrate a backend API boundary

- `askr-agent-execution`
- `askr-api-integration`
- `askr-query-mutation` or `askr-resources-data`
- `askr-auth-access` when auth or permission policy shapes the boundary
- `askr-testing-determinism`

### Build a CRUD screen

- `askr-agent-execution`
- `askr-project-structure`
- `askr-forms-tables-crud`
- `askr-query-mutation` or `askr-resources-data`
- `askr-error-loading-empty`
- `askr-testing-determinism`

### Apply theming and solved primitives

- `askr-agent-execution`
- `askr-theming`
- `askr-ui-composition`
- `askr-accessibility`
- `askr-testing-determinism`

### Build uploads and generated artifacts

- `askr-agent-execution`
- `askr-file-upload-artifacts`
- `askr-api-integration`
- `askr-error-loading-empty`
- `askr-testing-determinism`

### Build a metrics dashboard

- `askr-agent-execution`
- `askr-dashboard-charts`
- `askr-resources-data`
- `askr-error-loading-empty`
- `askr-testing-determinism`

### Harden accessibility on an interactive surface

- `askr-agent-execution`
- `askr-accessibility`
- `askr-ui-composition`
- `askr-testing-determinism`

### Review generated output for architecture drift

- `askr-agent-execution`
- `askr-project-structure`
- `askr-routing-layouts`
- `askr-testing-determinism`

Run:

```bash
askr skills review reject-parallel-architecture --cwd ./candidate-app
```

### Scaffold or repair CLI and Vite wiring

- `askr-agent-execution`
- `askr-cli-vite`
- `askr-testing-determinism`

### Translate React-shaped code into Askr

- `askr-agent-execution`
- `askr-mental-model`
- `askr-migration-react`
- `askr-project-structure`
- `askr-testing-determinism`

## Start a new application

```bash
# Create a full-featured application starter
askr create startkit my-app
cd my-app
npm run dev
```

`askr create` installs the bundled Askr skills into `.skills/` by default, so
the repo is immediately ready for agentic builders.

## Start a minimal SPA

```bash
askr create spa my-spa
cd my-spa
npm run dev
```

## Add a page to an SPA branch

```bash
askr add page audit-log --cwd ./my-spa
askr add page ops/review-queue --branch public --cwd ./my-spa
```

The generator writes the page file and updates the owning `_routes.tsx` file so
the route is live immediately.

## Update agent skills

```bash
askr skills sync
```

This refreshes bundled `askr-*` skills in `.skills/` and leaves unrelated custom
skills alone.

## Generate a static site

```bash
# Create an SSG project
askr create ssg my-site
cd my-site

# Build static output
npm run build

# Or run SSG directly with a config
askr ssg --config ./ssg.config.ts --output ./dist/static
```

## Build and preview

```bash
npm run build
npm run preview
```

## See also

- [create](./create.md)
- [skills](./skills.md)
- [add](./add.md)
- [SSG guide](https://github.com/askrjs/askr/tree/main/docs/guides/ssg.md)
