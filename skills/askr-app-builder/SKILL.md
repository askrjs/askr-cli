---
name: askr-app-builder
description: Use when building or substantially extending an Askr application, choosing scaffolds, planning app architecture, combining routing, state, data, UI primitives, theming, charts, SSR/SSG, or deciding which more specific Askr skill should guide the work.
---

# Askr App Builder

Use this as the first skill for real application work. Choose the smallest Askr path that can produce a polished, deterministic product surface.

## Inspect First

- `askr-cli/templates/startkit/AGENTS.md` for the canonical product-app baseline.
- `askr/docs/reference/package-map.md` for package ownership.
- `askr/docs/reference/project-structure.md` and `askr/docs/reference/conventions.md` for file placement.
- Existing `src/main.tsx`, `src/pages/**/_routes.tsx`, `src/pages/**/_layout.tsx`, `src/features/`, `src/components/shared/`, `src/shared/`, `src/adapters/`, and `src/styles/`.

## Choose The Path

- New product app: start from `npx @askrjs/cli create startkit <name>`.
- Minimal interactive app: use the `spa` template.
- Server-rendered app: use `ssr`.
- Static/documentation site: use `ssg`.
- Existing app: follow its current route, layout, style, and test conventions before introducing new ones.

## Canonical Layers

- `@askrjs/askr`: runtime, reactivity, routing, resources, query/mutation, SSR, SSG.
- `@askrjs/ui`: headless behavior and accessibility primitives.
- `@askrjs/themes`: optional visual layer, tokens, shell/nav/layout wrappers.
- `@askrjs/charts`: CSS-first dashboard chart visuals.
- `@askrjs/vite`: Vite JSX and template transform wiring.
- `@askrjs/cli`: scaffolding and SSG workflow tooling.

## Build Order

1. Scaffold with `askr-cli create` and install bundled skills with `askr-cli skills install`.
2. Establish the route-first `src/pages` branch structure before page internals.
3. Register top-level route groups in `_routes.tsx`; use `route()` for leaf screens and `page()` only for pathful shells that render child route content.
4. Put app-wide providers and branch chrome in `_layout.tsx` files.
5. Put feature logic, queries, mutations, and workflows in `src/features`.
6. Put generated clients and raw transport in `src/adapters`; put cross-cutting helpers in `src/shared`.
7. Load lifecycle-owned async work with `resource()` at route/container boundaries, or use `createQuery()`/`createMutation()` for shared server state.
8. Compose behavior with `@askrjs/ui`; style with tokens, `data-slot`, and `@askrjs/themes`.
9. Verify type checks, tests, browser behavior, and consistency states for user-visible flows.

## Minimal Imports

```tsx
import { createSPA } from "@askrjs/askr/boot";
import { fallback, getManifest, group, registerRoutes, route } from "@askrjs/askr/router";
import { askr } from "@askrjs/vite";
```

Import the top-level route registry from `src/main.tsx`. Register routes at module load, keep route handlers synchronous, and do async work inside components with `resource()` or shared query primitives.

## Avoid

- React-shaped defaults such as `useEffect` data loading or implicit mutable state.
- Mixing route registration, data transport, layout shell, and visual theme logic in one component.
- Raw interactive HTML when an `@askrjs/ui` primitive owns the behavior.
- App-local layout, shell, card, nav, feedback, or form primitives when `@askrjs/themes` already owns the surface.
- Hardcoded `--ak-*` token literals in runtime TypeScript or JavaScript.

## Checks

- The app has one clear route tree.
- Route branches, layouts, feature workflows, adapters, shared helpers, UI behavior, and theme concerns sit in separate layers.
- Loading, empty, error, disabled, and narrow-screen states are explicit.
- `npm run check` or the closest available project check passes.

## Source Files

- `askr/docs/getting-started/platform-overview.md`
- `askr/docs/reference/package-map.md`
- `askr/docs/reference/project-structure.md`
- `askr-cli/templates/startkit/AGENTS.md`
- `askr-cli/docs/create.md`
