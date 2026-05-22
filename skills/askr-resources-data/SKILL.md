---
name: askr-resources-data
description: Use when loading lifecycle-aware async data in Askr with resource, cancellation signals, pending/error/value states, refresh behavior, route/container ownership, consistency-aware refreshes, and async anti-pattern cleanup.
---

# Askr Resources Data

Use this when async work belongs to a component lifecycle rather than a shared cache.

## Inspect First

- `askr/docs/guides/resources.md`
- `askr/docs/reference/resources.md`
- `askr/docs/core/data.md`
- Existing route/container data loading patterns.

## Canonical Pattern

```tsx
import { resource } from '@askrjs/askr/resources';

function UserCard({ id }: { id: string }) {
  const user = resource(async ({ signal }) => {
    const response = await fetch(`/api/users/${id}`, { signal });
    return response.json();
  }, [id]);

  if (user.pending || !user.value) return <p>Loading...</p>;
  if (user.error) return <p role="alert">Unable to load user.</p>;
  return <p>{user.value.name}</p>;
}
```

## Decision Rules

- Use `resource()` for component-owned async reads that should cancel on unmount, navigation, or dependency change.
- Pass `signal` to `fetch` and other cancellable APIs.
- Put resource ownership at the route or feature-container boundary when multiple children need the data.
- Keep leaf display components data-free; pass `value`, loading, error, or callbacks as props.
- Use dependency arrays intentionally so resources refresh only when inputs change.
- Use query/mutation primitives instead when state must be shared by key across screens.

## UI States

- `pending`: show loading or refreshing affordance.
- `error`: show retryable error UI with `role="alert"` when appropriate.
- `value`: treat as nullable before first resolution.
- `refresh()`: expose on refresh, retry, or post-write reload actions.

## Consistency Notes

- Use `resource()` for lifecycle-owned reads; use query/mutation primitives when multiple screens need shared consistency state.
- After a write, call `refresh()` only from the owner that understands whether stale data should stay visible.
- For event-sourced projections, preserve version or event cursor in the returned value when the page must show "syncing" or "stale" truthfully.
- Do not clear useful old data during refresh unless showing stale data would be unsafe.

## Avoid

- Async route components.
- `useEffect`-style data loading.
- Custom cancellation tokens when `signal` exists.
- Hidden loading or error paths.
- Fetching in generic UI primitives.

## Checks

- The async owner is the smallest route/container that needs the data.
- Cancellable work receives `signal`.
- Loading, error, empty, and retry states are visible.
- Route handlers remain synchronous.
- Refresh behavior is honest about stale or eventually consistent data.

## Source Files

- `askr/docs/guides/resources.md`
- `askr/docs/reference/resources.md`
- `askr/docs/core/data.md`
- `askr-cli/templates/startkit/src/pages/workspace/dashboard.tsx`
