---
name: askr-error-loading-empty
description: Use when designing Askr loading, empty, error, stale, refreshing, pending-write, retry, disabled, partial-data, and eventual-consistency UX across routes, tables, forms, dashboards, queries, and mutations.
---

# Askr Error Loading Empty

Use this whenever a feature touches async data or non-happy-path UI.

## Inspect First

- The route/container that owns the resource, query, or mutation.
- Existing shared empty state, alert, toast, skeleton, and error components.
- Query consistency fields: `loading`, `refreshing`, `stale`, `consistency`.
- Mutation state: `pending`, `error`, `result`, `status`.

## State Vocabulary

- Initial loading: no usable data yet.
- Refreshing: old data is visible while new data loads.
- Empty: request succeeded but no records match.
- Error: request failed and user needs recovery or explanation.
- Partial: some data is usable, some failed or is still loading.
- Pending write: command accepted but read model may not reflect it yet.
- Stale: current read model is known or suspected to be behind.

## Eventual Consistency UX

- Keep stale data visible when it is safer than blanking the screen.
- Use "syncing", "saving", "processing", or "updating" copy for projection lag.
- Disable only actions that would conflict; keep safe navigation available.
- Show reconciliation failures as recoverable stale/error states.
- Prefer narrow row-level status over global page blocking when only one record is pending.

## Avoid

- One spinner for every async state.
- Empty states that hide errors.
- Toast-only errors for important failed workflows.
- Claiming a write is fully complete before the read side confirms it.
- Clearing useful data during refresh.

## Checks

- Initial, refresh, empty, error, stale, and pending-write states are represented.
- Retry paths call the owning `refresh()` or mutation action.
- Screen-reader relevant failures use `role="alert"` where appropriate.
- Copy tells the truth about eventual consistency.
