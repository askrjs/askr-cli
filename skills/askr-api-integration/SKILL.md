---
name: askr-api-integration
description: Use when integrating Askr apps with generated API clients, transport adapters, auth headers, cancellation, DTO mapping, error normalization, retries, and event-sourced consistency metadata.
---

# Askr API Integration

Use this for the boundary between Askr feature code and backend APIs.

## Inspect First

- Existing `src/adapters` generated clients and transport wrappers.
- Existing `src/features` query/mutation workflows.
- Existing `src/shared` error formatting, auth/session helpers, and config.
- API DTO naming, version fields, event IDs, cursor fields, and request IDs.

## Boundary Model

- `src/adapters`: generated clients, raw HTTP/SSE/WebSocket transport, auth header injection, low-level retries.
- `src/features/<feature>`: app-level queries, mutations, DTO-to-model mapping, workflow state.
- `src/shared`: cross-cutting config, error normalization, date/number formatting, request tracing.
- Components consume app models and workflow state, never raw transport DTOs.

## Canonical Pattern

```ts
export async function listAccounts({ signal }: { signal: AbortSignal }) {
  const response = await accountsClient.list({ signal });
  return {
    items: response.items.map(toAccount),
    version: response.version,
    lastEventId: response.last_event_id,
  };
}
```

Forward `AbortSignal` through every cancellable layer.

## Event-Sourced Consistency

- Preserve server version, revision, etag, cursor, or event ID in app models when the UI needs freshness.
- Return write acknowledgements with enough metadata to reconcile: accepted command ID, target aggregate ID, expected version, observed version, or event ID.
- Treat read-after-write as eventually consistent unless the API explicitly guarantees linear reads.
- Show `pending-write`, `refreshing`, or `stale` state while projections catch up.
- Prefer idempotency keys for commands that may retry.

## Avoid

- Raw DTOs leaking into page or component props.
- API clients in `src/pages` or `src/components/shared`.
- Dropping `signal` in adapter layers.
- Hiding consistency metadata that later UX needs.
- Retrying non-idempotent commands without an idempotency key.

## Checks

- Every async adapter accepts and forwards `signal`.
- Errors normalize into user-safe messages and machine-readable codes.
- DTO mapping is deterministic and tested.
- Event/version metadata reaches query or mutation state when consistency matters.
