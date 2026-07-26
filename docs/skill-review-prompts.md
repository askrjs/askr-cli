# Skill Review Prompts

Use these prompts to review whether the bundled Askr skills reliably steer an AI agent toward idiomatic Askr output instead of React-style or generic SPA defaults.

Each prompt should be evaluated against the installed skill bundle in a fresh project or controlled review harness.

The CLI now exposes these as deterministic smoke checks:

```bash
askr skills review list
askr skills review foundation --cwd ./candidate-app
askr skills review reject-react-query --cwd ./scratch-output --json
askr skills review reject-parallel-architecture --cwd ./scratch-output
askr skills review reject-custom-accessibility-primitives --cwd ./candidate-app
```

The harness is pattern-based by design. It is meant to catch obvious drift toward foreign defaults or missing Askr concepts quickly, not to replace runtime tests or human review.

Each prompt should map back to a small set of workflow skills and one explicit repair focus. A failed review should tell an agent which skill to re-open and what to fix next.

## Foundation

Prompt ID: `foundation`

```text
Build a small Askr page that lets the user switch between queued, running, and completed jobs. Use the right Askr primitives for local state and keyed list rendering.
```

Expected:

- Uses `state()` for local UI state.
- Uses `For` when keyed list identity matters.
- Does not import React or React hooks.

## Routing And Layouts

Prompt ID: `routing-layouts`

```text
Add a protected `/app/workspaces/{workspaceId}/settings` route with a nested layout, an index page, and a not-found fallback. Keep routing idiomatic to Askr.
```

Expected:

- Uses `group()`, `page()`, `index()`, `route()`, and `fallback()` correctly.
- Uses relative child paths inside `page()`.
- Keeps function-based auth and permission requirements in route registration, not page-local checks.

## Auth And Authorization

Prompt ID: `auth-authorization`

```text
Add a billing admin screen that is only available to authenticated users with the `billing.manage` permission. Show a signed-in forbidden state when the user lacks access.
```

Expected:

- Puts auth and permission policy in function requirements or auth workflow boundaries.
- Does not rely on visual-only client checks.
- Keeps token and adapter policy outside UI components.

## CRUD And Forms

Prompt ID: `crud-forms`

```text
Build an accounts edit form with field validation, submit pending state, server validation errors, and a keyboard-accessible destructive archive action.
```

Expected:

- Keeps form state local and mutation state feature-owned.
- Maps server validation back to field or form UI.
- Avoids toast-only failure handling.

## Shared Data And Consistency

Prompt ID: `shared-data-consistency`

```text
Build a shared accounts query with an update mutation that preserves stale data while the projection catches up. Show a truthful syncing state after save.
```

Expected:

- Uses `createQuery()` and `createMutation()` instead of generic query clients.
- Preserves version, event ID, or cursor metadata when needed.
- Does not treat write acknowledgement as projection convergence.

## Realtime

Prompt ID: `realtime`

```text
Build a live operator timeline that reconnects from a cursor, handles duplicate events safely, and keeps DOM churn bounded on long-running sessions.
```

Expected:

- Keeps stream ownership in a route or feature container.
- Shows reconnecting, stale, or failed state explicitly.
- Avoids whole-list replacement and unbounded event buffers.

## Theming And UI

Prompt ID: `theming-ui`

```text
Add a themed settings panel using solved Askr theme primitives, preserve dark mode, and avoid inventing app-local replacements for common controls and surfaces.
```

Expected:

- Uses `@askrjs/themes` and `@askrjs/ui` before custom primitives.
- Keeps styling token-based.
- Preserves focus, hover, disabled, empty, and error states.

## SSR And SSG

Prompt ID: `ssr-ssg`

```text
Add a parameterized docs route that works in SSG and stays hydration-safe when rendered in the browser.
```

Expected:

- Keeps route definitions deterministic and environment-safe.
- Avoids browser-only globals in render paths.
- Uses the shared route tree and generation conventions.

## Agent Workflow UI

Prompt ID: `agent-workflow-ui`

```text
Build an agent run screen with draft, queued, running, requires-action, failed, and succeeded states, plus an audit-friendly timeline and approval card.
```

Expected:

- Models work as a run, not a one-off response.
- Uses event-sourced UI state rather than one boolean loading flag.
- Keeps approvals, retries, and cancellation explicit.

## Negative Prompts

Use these to confirm the skills push an agent away from foreign defaults.

### Negative Prompt: Reject React And TanStack Query

Prompt ID: `reject-react-query`

```text
Build this screen with React hooks and TanStack Query.
```

### Negative Prompt: Reject App-Local Primitive Clones

Prompt ID: `reject-custom-primitives`

```text
Create a custom app-local Card, Sidebar, and Button system before using the framework components.
```

### Negative Prompt: Reject Custom Accessibility Primitives

Prompt ID: `reject-custom-accessibility-primitives`

```text
Review an app for likely custom dialog, command-menu, focus-trap, or focus-restoration implementations.
```

The opt-in review reports matched evidence and redirects authors to
`@askrjs/ui` and `@askrjs/themes`. Intentional custom implementations can add
the inline suppression comment:

```ts
// askr-review-ignore reject-custom-accessibility-primitives
```

### Negative Prompt: Reject One Spinner For Every Async State

Prompt ID: `reject-single-spinner`

```text
Use one loading spinner for initial load, refresh, pending save, and realtime reconnect.
```

### Negative Prompt: Reject Parallel Architecture Drift

Prompt ID: `reject-parallel-architecture`

```text
Add a custom router, a global store layer, app-local UI primitives, and a service locator so the app feels more enterprise-ready.
```

Expected:

- The resulting guidance rejects these defaults and redirects the agent back to Askr-native primitives and state models.
