# CLI: skills

Install the Askr agent skills into an application project.

Skills are dev-time guidance files. They do not add runtime dependencies or app
magic; they make the expected Askr architecture available to AI agents and other
skill-aware tools.

## Usage

```bash
askr skills list
askr skills review list
askr skills review <prompt-id> [--cwd <dir>] [--json]
askr skills install [--cwd <dir>] [--force]
askr skills sync [--cwd <dir>]
```

## Commands

### `skills list`

Print the bundled skill names.

### `skills install`

Copy bundled skills into `<cwd>/skills/`. The command refuses to write into a
non-empty `skills` directory unless `--force` is provided.

```bash
askr skills install
askr skills install --cwd ./my-app
```

### `skills review`

Evaluate a generated output tree against deterministic Askr prompt rubrics.

The review harness is intentionally heuristic and fast. It scans text files under
the target directory, ignores `skills/`, legacy `.skills/`, `.askr/`,
`node_modules/`, and build artifacts, then scores the result against required
and forbidden patterns for the selected prompt. Treat it as a repeatable smoke
screen, not as proof of full behavioral correctness.

```bash
askr skills review list
askr skills review foundation --cwd ./candidate-app
askr skills review reject-react-query --cwd ./scratch-output --json
askr skills review reject-parallel-architecture --cwd ./scratch-output
```

### `skills sync`

Update bundled Askr skills in `<cwd>/skills/`. This overwrites bundled skill
folders and removes obsolete `askr-*` folders. Non-Askr custom skill folders are
preserved.

```bash
askr skills sync
```

## Bundled skills

The CLI bundles the canonical skill source in `skills/`. Published packages
include the same folder so installed CLIs can copy it into projects.

The bundle is now intentionally layered to reduce ambiguity across model sizes.
It should feel like a workflow system, not a framework essay collection.

## Skill layers

### Foundation sequence

These are the default entry path for new tasks:

- `askr-agent-execution`
- `askr-mental-model`
- `askr-project-structure`
- `askr-routing-layouts`
- `askr-runtime-reactivity`
- `askr-testing-determinism`

Small or cheaper models should usually stay on this path plus one specialized workflow skill.
The builder recommendation set intentionally keeps broad planning and UI-system add-ons out of the default path unless the prompt is broad enough to justify them.

### Core workflows

These skills should be the main task-oriented surface for most application work:

- `askr-resources-data`
- `askr-query-mutation`
- `askr-error-loading-empty`
- `askr-forms-tables-crud`
- `askr-auth-access`
- `askr-theming`
- `askr-ui-composition`
- `askr-ssr-ssg`
- `askr-realtime-streaming`
- `askr-agent-workflows`

### Domain add-ons

These should be pulled in only when the task clearly needs them:

- `askr-api-integration`
- `askr-observability-debugging`
- `askr-file-upload-artifacts`
- `askr-env-config`
- `askr-dashboard-charts`
- `askr-accessibility`
- `askr-design-system`
- `askr-cli-vite`
- `askr-migration-react`
- `askr-app-builder`

`askr-app-builder`, `askr-ui-composition`, and `askr-design-system` should not be the first stop for ordinary feature work. Pull them in only when the task is clearly broader than one owned workflow.

`askr-cli-vite` and `askr-migration-react` are also intentionally low-frequency. Use them for setup, repair, or translation work, then hand back to the normal route, data, and UI workflow skills.

## Mandatory conventions

- Keep one route tree.
- Register routes before app boot.
- Keep pages route-focused, features workflow-focused, and adapters transport-focused.
- Use `resource()` for lifecycle-owned reads.
- Use `createQuery()` for shared keyed reads.
- Use `createMutation()` for writes.
- Use `@askrjs/ui` and `@askrjs/themes` before inventing app-local primitives.
- Represent loading, empty, error, stale, retry, and pending-write states truthfully.
- Run the narrowest executable validation before closing the task.

## Review loop

The builder brief created by `askr create --prompt ...` now mirrors this layered system:

- inspect the generated scaffold first
- follow a deterministic skill execution order
- use local golden-example files instead of broad external docs first
- close with the narrowest validation path

The executable prompt rubrics under `skills review` mirror the review prompts in
`docs/skill-review-prompts.md` so skill changes can be checked against the same
foundation, routing, data, realtime, and negative-default scenarios. That now includes direct checks for React drift, app-local primitive drift, one-spinner async drift, and parallel architecture drift. Failed reviews now report related skills and a repair focus so the next step is explicit.

## Canonical structure taught by the skills

The bundled skills describe Askr projects as route-first:

```text
src/main.tsx
src/pages/_routes.tsx
src/pages/_layout.tsx
src/pages/public/_routes.tsx
src/pages/public/_layout.tsx
src/pages/public/home.tsx
src/pages/public/admin-login.tsx
src/pages/app/_routes.tsx
src/pages/app/_layout.tsx
src/pages/app/admin-home.tsx
src/components/shared/
src/features/
src/shared/
src/adapters/
tests/
```

Routes live in `pages`, shells live in `_layout.tsx`, reusable UI lives in
`components/shared`, feature workflows live in `features`, cross-cutting helpers
live in `shared`, and generated clients or transport adapters live in
`adapters`.

## Eventual consistency

The bundled skills teach event-sourced applications as a normal Askr path:
commands may be accepted before read models catch up, so UIs should distinguish
`pending-write`, `refreshing`, `stale`, processing, syncing, and ready states.
Agents should preserve event IDs, versions, cursors, command IDs, and projection
metadata at API boundaries when a feature needs to reason about consistency.

## See also

- [CLI overview](./overview.md)
- [create](./create.md)
- [skill system design](./skill-system-design.md)
