---
name: askr-realtime-streaming
description: Use when building Askr realtime UX with SSE, WebSocket, event streams, reconnects, cursors, cancellation, backpressure-aware UI, optimistic updates, projection lag, and event-sourced state.
---

# Askr Realtime Streaming

Use this for live data, event streams, and projection-driven UI.

## Inspect First

- Adapter support for SSE, WebSocket, polling, or long-running requests.
- Event schema: event ID, sequence, aggregate ID, type, timestamp, and payload.
- Query keys and mutation invalidation affected by streamed events.
- Reconnect and resume requirements.

## Event Stream Rules

- Treat events as append-only facts.
- Apply events idempotently by event ID or sequence.
- Store `lastEventId` or cursor for reconnect.
- Handle gaps by refetching the affected query or projection.
- Separate optimistic local intent from confirmed events.

## Askr Ownership

- Use route or feature containers to own stream lifecycle.
- Forward `AbortSignal` through stream setup and teardown when supported.
- Update query/read-model state through explicit refresh, invalidation, or feature-owned state.
- Keep leaf components as timeline/list renderers, not stream owners.

## UX Rules

- Show connected, reconnecting, stale, and failed states when the workflow depends on freshness.
- Keep old data visible during reconnect when safe.
- Use row-level pending/syncing indicators for targeted updates.
- Provide manual refresh when automatic catch-up fails.

## Avoid

- Assuming streamed events arrive exactly once or in order.
- Clearing the screen during reconnect.
- Unbounded in-memory event lists.
- Mixing transport code into pages or components.
- Treating command success as projection success.

## Checks

- Reconnect resumes from a cursor or falls back to refetch.
- Duplicate and out-of-order events are safe.
- Projection lag has visible UI.
- Stream teardown happens on navigation or unmount.
