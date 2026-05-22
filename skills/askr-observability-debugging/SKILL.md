---
name: askr-observability-debugging
description: Use when adding Askr observability, debugging, structured logs, request IDs, trace IDs, query and mutation diagnostics, event-sourced replay context, agent-run audit trails, and dev-only diagnostics.
---

# Askr Observability Debugging

Use this when failures must be explainable to users, developers, or operators.

## Inspect First

- Existing error normalization and logging helpers in `src/shared`.
- API request/response metadata available from adapters.
- Query/mutation consistency and error states.
- Agent run IDs, command IDs, event IDs, and audit requirements.

## Metadata To Preserve

- Request ID or trace ID.
- User/session/workspace ID where safe.
- Command ID, idempotency key, aggregate ID, version, event ID, or projection cursor.
- Query key and invalidation prefix.
- Run ID, tool call ID, approval ID, and artifact ID for agentic workflows.

## UI Rules

- User-facing errors should be clear and safe.
- Developer diagnostics should be available in logs or dev-only panels.
- Do not leak secrets, raw tokens, private prompts, or sensitive payloads.
- When data is stale, include enough diagnostic context to know which read model is behind.

## Event-Sourced Debugging

- Log command submission and acknowledgement separately.
- Log projection catch-up separately from command success.
- Preserve last processed event ID for replay/reconnect issues.
- Make duplicate event handling idempotent and observable in tests.

## Avoid

- Swallowing errors in async handlers.
- Console-only diagnostics for production-critical flows.
- Showing raw stack traces or transport payloads to users.
- Losing correlation IDs between adapters, features, and UI errors.

## Checks

- Errors include user-safe copy and developer-useful context.
- Eventual consistency states are diagnosable.
- Agent workflows have audit-friendly run and event IDs.
- Logs do not contain secrets.
