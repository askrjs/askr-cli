---
name: askr-testing-determinism
description: Use when testing Askr apps, validating deterministic runtime behavior, writing jsdom or browser tests, checking accessibility, cleanup, route behavior, resources, queries, mutations, keyed lists, and performance-sensitive UI.
---

# Askr Testing Determinism

Use this when adding or reviewing tests for Askr behavior.

## Inspect First

- `askr/docs/contributing/testing.md`
- `askr/docs/concepts/determinism.md`
- Existing `vitest.config.ts` files and `tests/` conventions.
- Package-specific test utilities before inventing new helpers.

## Test Selection

- Unit tests: pure helpers, formatters, validators, route metadata, data transforms.
- jsdom tests: runtime state, resource behavior, route rendering, component logic.
- Browser tests: focus, keyboard behavior, overlays, layout, hydration, visual regressions, performance-sensitive flows.
- Type tests: public API and component prop contracts.
- Benchmarks: hot paths, keyed lists, large tables, router matching, hydration.

## Determinism Targets

- Event ordering and batched updates.
- Stable call order for runtime helpers.
- Keyed DOM identity during list updates.
- No partial DOM commit after render failure.
- Async cancellation on navigation or unmount.
- Route identity and layout retention across navigation.

## Patterns

- Clean up mounted apps with `cleanupApp(root)` when tests mount an app.
- Prefer user-visible assertions over implementation detail checks.
- For `resource()`, cover pending, success, error, refresh, and cancellation when relevant.
- For `@askrjs/ui`, cover keyboard and ARIA behavior.
- For themes, include computed style and overflow checks where visual contracts matter.

## Avoid

- Tests that depend on uncontrolled timers or random data.
- Snapshot-only coverage for interactive behavior.
- Browser behavior tested only in jsdom.
- Performance changes without a focused benchmark or regression test.

## Checks

- The smallest meaningful test suite covers the changed contract.
- Tests fail before the fix when practical.
- App checks use existing scripts such as `npm run check`, `npm test`, `npm run type-check`, or package-specific test scripts.
- Async tests await visible state changes rather than sleeping blindly.

## Source Files

- `askr/docs/contributing/testing.md`
- `askr/docs/concepts/determinism.md`
- `askr/tests/jsdom/`
- `askr/tests/browser/`
- `askr-ui/tests/browser/`
- `askr-themes/tests/browser/`
