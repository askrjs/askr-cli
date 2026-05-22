# CLI: skills

Install the Askr agent skills into an application project.

Skills are dev-time guidance files. They do not add runtime dependencies or app
magic; they make the expected Askr architecture available to AI agents and other
skill-aware tools.

## Usage

```bash
askr skills list
askr skills install [--cwd <dir>] [--force]
askr skills sync [--cwd <dir>]
```

## Commands

### `skills list`

Print the bundled skill names.

### `skills install`

Copy bundled skills into `<cwd>/.skills`. The command refuses to write into a
non-empty `.skills` directory unless `--force` is provided.

```bash
askr skills install
askr skills install --cwd ./my-app
```

### `skills sync`

Update bundled Askr skills in `<cwd>/.skills`. This overwrites bundled skill
folders and removes obsolete `askr-*` folders. Non-Askr custom skill folders are
preserved.

```bash
askr skills sync
```

## Bundled skills

The CLI bundles the canonical skill source in `skills/`. Published packages
include the same folder so installed CLIs can copy it into projects.

The bundle includes route structure, runtime/data, UI composition, theming,
testing, API integration, auth/access, agent workflows, realtime streaming,
observability, environment config, file/artifact flows, accessibility, and
eventual-consistency UX guidance.

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
