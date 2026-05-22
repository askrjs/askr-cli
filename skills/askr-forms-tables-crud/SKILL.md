---
name: askr-forms-tables-crud
description: Use when building askr CRUD screens, forms, validation, filters, tables, pagination, selection, bulk actions, confirmation dialogs, row actions, resource/query data flow, and feature folder boundaries.
---

# Askr Forms Tables CRUD

Use this for create, read, update, delete, search, filter, and table workflows.

## Inspect First

- `askr/docs/guides/crud.md`
- `askr/docs/guides/forms.md`
- `askr/docs/guides/tables.md`
- `askr-cli/templates/startkit/src/pages/workspace/accounts/index.tsx`
- `askr-cli/templates/startkit/src/features/accounts/*`

## Structure

```text
src/pages/app/users.tsx
src/features/users/user-table.tsx
src/features/users/user-filters.tsx
src/features/users/user-form.tsx
src/features/users/users.query.ts
src/features/users/users.mutation.ts
src/adapters/users-client.ts
src/shared/format.ts
```

Routes compose the page. Feature modules own domain UI and workflows. `src/adapters` owns generated clients and raw transport. `src/shared` owns cross-cutting formatting and error helpers.

## Data Flow

- Use `resource()` for route-owned async reads that need lifecycle cancellation.
- Use `createQuery()` when list/detail data is shared across screens.
- Use `createMutation()` or explicit feature-owned async state for writes.
- Refresh or invalidate after create, update, archive, or delete.
- Keep filters, pagination, selected IDs, and dialog open state in `const [value, setValue] = state(initial)` pairs, then read with the getter and update through the setter.

## Table Rules

- Use stable row keys, never index keys for records.
- Put feature-specific columns in the feature folder.
- Use `selector()` for keyed row selection fanout when the table is large or hot.
- Provide loading, empty, error, and disabled action states.
- Keep formatting in `src/shared/format.ts` or a domain feature helper.

## Form Rules

- Keep form state local unless multiple routes need it.
- Put validation rules in `src/features/<feature>` when domain-specific, or `src/shared` when cross-cutting.
- Use `@askrjs/ui` form controls for behavior and accessibility.
- Disable submit while pending and surface field or form errors explicitly.

## Avoid

- API clients in table, form, or generic UI components.
- Business rules in reusable primitives.
- Hidden destructive actions without confirmation.
- Duplicated pagination/filter logic across route files.

## Checks

- CRUD ownership boundaries are obvious.
- Every async path has loading/error/retry or disabled feedback.
- Selection, bulk actions, and destructive actions are keyboard reachable.
- Tests cover filtering, selection, submit success, submit failure, and empty state.

## Source Files

- `askr/docs/guides/crud.md`
- `askr/docs/guides/forms.md`
- `askr/docs/guides/tables.md`
- `askr-cli/templates/startkit/src/pages/workspace/accounts/index.tsx`
