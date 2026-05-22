---
name: askr-project-structure
description: Use when deciding where Askr app files belong, naming components, separating route-first pages, layouts, features, shared helpers, adapters, reusable UI, tests, and package-owned responsibilities.
---

# Askr Project Structure

Use this before creating, moving, or reviewing files in an Askr app. A clean Askr project is route-first: the UI tree is organized around page branches and layout boundaries.

## Inspect First

- `askr/docs/reference/project-structure.md`
- `askr/docs/reference/conventions.md`
- `askr/docs/reference/package-map.md`
- Existing app folders, page branches, and import aliases.

## Canonical Shape

- `src/main.tsx`: boot the SPA and import the route registry.
- `src/pages/_routes.tsx`: compose the top-level public and authenticated route branches.
- `src/pages/_layout.tsx`: root wrapper for theme, providers, and app-wide styling.
- `src/pages/public/_routes.tsx`: guest-facing routes such as home and login.
- `src/pages/public/_layout.tsx`: public shell around guest pages.
- `src/pages/app/_routes.tsx`: authenticated routes and app branch policy.
- `src/pages/app/_layout.tsx`: authenticated shell with sidebar, nav, and sign-out behavior.
- `src/pages/public/*.tsx` and `src/pages/app/*.tsx`: leaf page screens.
- `src/components/shared/`: reusable UI building blocks and shell pieces.
- `src/features/<feature>/`: feature logic, queries, mutations, and API-facing workflows.
- `src/shared/`: cross-cutting utilities such as navigation data, formatting, and error handling.
- `src/adapters/`: generated API clients and transport adapters.
- `src/styles/`: reset, tokens, theme, layout, and component CSS.
- `public/`: static assets served directly.
- `tests/`: behavior, integration, and contract coverage.

## Naming And Exports

- Use kebab-case file names: `account-table.tsx`.
- Use PascalCase component symbols: `AccountTable`.
- Prefer named exports unless the existing app template uses default page exports.
- Name leaf page files after the path or product surface they represent.
- Keep prop types close to the component: `AccountTableProps`.

## Decision Rules

- If it owns URL reachability, put it in the nearest `src/pages/**/_routes.tsx`.
- If it owns persistent shell chrome, put it in the matching `src/pages/**/_layout.tsx`.
- If it owns domain behavior, colocate it under `features/<domain>`.
- If it owns reusable display, put it in `components/shared`.
- If it owns cross-cutting helpers, put it in `shared`.
- If it owns generated clients or raw transport, put it in `adapters`.
- If it is visual styling, put it in CSS or theme layer, not runtime logic.

## Avoid

- API clients in components or UI primitives.
- Business logic or transport code in `src/pages`.
- JSX in `src/shared` or `src/adapters`.
- Duplicate shells across pages.
- One component that owns routing, fetching, mutation, and styling.
- Parallel abstractions for a concern Askr already owns.

## Checks

- Another agent could predict where the file belongs.
- Imports follow package ownership from `package-map.md`.
- New folders match existing app conventions.
- Related tests live near the behavior or in the established `tests/` layout.

## Source Files

- `askr/docs/reference/project-structure.md`
- `askr/docs/reference/conventions.md`
- `askr-cli/templates/startkit/README.md`
- `askr-cli/templates/startkit/AGENTS.md`
