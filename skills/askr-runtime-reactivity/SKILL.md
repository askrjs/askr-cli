---
name: askr-runtime-reactivity
description: Use when writing askr reactive runtime code with state, derive, selector, context, JSX control flow, stable call order, deterministic event handling, or render lifecycle rules.
---

# Askr Runtime Reactivity

Use this when local state, derived values, keyed selection, context, control flow, or render determinism matters.

## Inspect First

- `askr/docs/core/data.md`
- `askr/docs/guides/state.md`
- `askr/docs/concepts/determinism.md`
- `askr/docs/concepts/runtime-enforcement.md`
- Existing component state patterns.

## Core Pattern

```tsx
import { derive, selector, state } from "@askrjs/askr";
import { For, Show } from "@askrjs/askr/control";

const [count, setCount] = state(0);
const [selectedId, setSelectedId] = state<number | null>(null);
const doubled = derive(() => count() * 2);
const isSelected = selector(selectedId);
```

`state()` returns a `[getter, setter]` pair. Read with the getter call and update with the setter.

## Decision Rules

- Use `state()` for local mutable UI state, always as a `[getter, setter]` pair.
- Use `derive()` for computed values from reactive reads.
- Use `selector()` when one source fans out to many keyed readers, especially tables and lists.
- Use `defineContext()` and `readContext()` for cross-tree values.
- Use `For`, `Show`, `Case`, and `Match` for JSX control flow when they make identity or branching clearer.
- Keep runtime helper call order stable across renders.

## Determinism Rules

- Do not call `state`, `derive`, `selector`, `resource`, query, or mutation helpers conditionally.
- Do not mutate state during render.
- Batch related updates in the event handler that owns the user action.
- Preserve stable keys in `For` for rows and reorderable lists.

## Avoid

- Reading a getter without calling it.
- React hooks or `useState` in Askr app code.
- Recreating selectors in row components.
- Index keys for data with stable IDs.
- Derived state that performs side effects.

## Checks

- Runtime helpers are top-level and unconditional.
- Lists have stable identity.
- Event handlers serialize intent clearly.
- Tests cover branch toggles, list selection, and state updates that matter to the feature.

## Source Files

- `askr/docs/guides/state.md`
- `askr/docs/core/data.md`
- `askr/docs/concepts/determinism.md`
- `askr/src/runtime/state.ts`
- `askr/src/runtime/derive.ts`
- `askr/src/runtime/selector.ts`
