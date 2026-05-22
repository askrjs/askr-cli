---
name: askr-migration-react
description: Use when translating React-shaped code, habits, or component designs into idiomatic Askr, including replacing useState/useEffect patterns, JSX assumptions, data fetching, routing, context, component APIs, and UI primitive choices.
---

# Askr Migration React

Use this when a task, code sample, or generated design is React-shaped and needs to become idiomatic Askr.

## Inspect First

- `askr/docs/migration/from-react.md`
- `askr/docs/guides/state.md`
- `askr/docs/guides/resources.md`
- `askr/docs/reference/conventions.md`
- The current app's askr imports and component patterns.

## Translation Table

- React `useState`: askr `state()` `[getter, setter]` pair.
- React `useMemo`: askr `derive()` when reactive computation is needed.
- React `useEffect` data loading: askr `resource()` or `createQuery()`.
- React Router component routes: askr `registerRoutes`, `group`, `route`, `page`.
- React context: askr `defineContext()` and `readContext()`.
- React conditional rendering can stay JSX, or use `Show`, `Case`, and `Match` when identity or clarity improves.
- React list `.map` can be fine for static arrays; use `For` with stable keys for reactive or large keyed lists.

## State Pattern

```tsx
import { state } from "@askrjs/askr";

const [open, setOpen] = state(false);

<button onClick={() => setOpen((value) => !value)}>{open() ? "Close" : "Open"}</button>;
```

`state()` always returns a `[getter, setter]` pair. Read with `open()` and update with `setOpen(...)`.

## Data Pattern

```tsx
import { resource } from "@askrjs/askr/resources";

const user = resource(({ signal }) => loadUser(id, { signal }), [id]);
```

Do not translate `useEffect` fetches literally. Pick `resource()` for lifecycle-owned async work or `createQuery()` for shared server state.

## Component API Rules

- Prefer narrow props and composition over large prop surfaces.
- Use `@askrjs/ui` for behavior and accessibility instead of porting React-only libraries blindly.
- Preserve `data-slot` hooks for styling.
- Keep business logic out of presentational components.

## Avoid

- Importing React hooks or React runtime helpers.
- Treating state getters like values instead of functions.
- Porting React Router route components directly.
- Hiding async work in effects or event-only side effects when the UI depends on it.
- Assuming third-party React component packages are compatible.

## Checks

- No React imports remain unless the project intentionally embeds React separately.
- Runtime helper call order is stable.
- Async work has cancellation and visible loading/error states.
- Routing uses Askr route registration.
- Interactive UI uses askr-compatible primitives.

## Source Files

- `askr/docs/migration/from-react.md`
- `askr/docs/guides/state.md`
- `askr/docs/guides/resources.md`
- `askr/docs/reference/conventions.md`
