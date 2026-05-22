---
name: askr-query-mutation
description: Use when modeling shared server state in Askr with createQuery, createMutation, invalidate, service boundaries, consistency states, pending writes, cache keys, event-sourced read models, and explicit read/write coordination.
---

# Askr Query Mutation

Use this for shared read/write state that should outlive one render or coordinate across features.

## Inspect First

- `askr/docs/core/data.md`
- `askr/src/data/index.ts`
- Existing `src/features`, `src/shared`, and `src/adapters` boundaries.
- Existing query keys and invalidation prefixes.

## Query Pattern

```ts
import { createQuery, invalidate } from "@askrjs/askr/data";

const user = createQuery({
  key: `user:${id}`,
  fetch: ({ signal }) => userService.getUser(id, { signal }),
});

await user.refresh();
invalidate("user:");
```

Query state includes `data`, `error`, `loading`, `refreshing`, `stale`, `consistency`, and `refresh()`.

## Mutation Pattern

```ts
import { createMutation } from "@askrjs/askr/data";

const saveUser = createMutation({
  action: (input, { signal }) => userService.updateUser(input, { signal }),
  affects: (input) => [`user:${input.id}`, "users:"],
  afterSuccess: "invalidate",
});

await saveUser.execute({ id, name });
```

Mutation state includes `status`, `pending`, `error`, `result`, `execute`, `abort`, and `reset`.

## Event-Sourced Consistency Pattern

Use this pattern when writes append events and reads come from projections:

- Command success means the write was accepted, not necessarily that every read model is caught up.
- Include command ID, aggregate ID, expected version, observed version, event ID, or projection cursor in mutation results when the backend exposes them.
- Use `affects` and `afterSuccess: 'invalidate'` to mark affected queries as `pending-write` and refresh them.
- Keep the old query data visible while `consistency` is `pending-write`, `refreshing`, or `stale`.
- On stream reconnect or cursor gaps, invalidate the affected query prefix instead of replaying uncertain local state.
- Use `isConsistent` to compare returned read data against expected versions or event IDs.
- Use `reconcile` to retry while a projection is behind, with user-visible stale/syncing feedback.

```ts
const account = createQuery({
  key: `account:${id}`,
  fetch: ({ signal }) => accountsService.getAccount(id, { signal }),
  isConsistent: (data) => data.version >= expectedVersion(),
  reconcile: () => true,
});
```

## Layering

- Component owns user intent and display states.
- Query/mutation owns cache and read/write state.
- Feature service/query/mutation owns app workflow state and app-level models.
- Adapter owns generated clients and raw protocol details.

## Decision Rules

- Use `resource()` for isolated lifecycle reads.
- Use `createQuery()` for shared keyed reads.
- Use `createMutation()` for writes with pending/error/result state.
- Use prefix invalidation for affected query groups.
- Keep invalidation explicit and narrow.
- Surface `pending-write`, `refreshing`, and `stale` when the UX needs consistency feedback.
- Prefer truthful copy such as "saved, syncing" or "changes pending" when projections lag.

## Avoid

- Fetching directly in many leaf components.
- Hiding writes inside presentational UI.
- Cache keys that cannot be invalidated predictably.
- Generic query clients or global state abstractions unless the app already owns one.
- Optimistic updates without rollback or refetch.
- Treating write acknowledgement as read-model convergence in event-sourced systems.

## Checks

- Query keys are stable and prefix-friendly.
- Services receive `signal`.
- Mutation pending and error states are visible.
- A successful write invalidates only the affected read model.
- Event/version metadata is preserved when the UI needs to reason about projection catch-up.

## Source Files

- `askr/docs/core/data.md`
- `askr/src/data/index.ts`
- `askr/docs/reference/package-map.md`
