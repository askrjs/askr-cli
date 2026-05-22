---
name: askr-accessibility
description: Use when making Askr UI accessible, including keyboard flows, focus management, ARIA names, dialogs, menus, forms, tables, live regions, screen-reader behavior, and @askrjs/ui primitive selection.
---

# Askr Accessibility

Use this for accessibility-sensitive UI or when composing interactive primitives.

## Inspect First

- Existing `@askrjs/ui` primitive usage.
- Labels, accessible names, focus order, and keyboard behavior.
- Form errors, async status messages, and destructive confirmations.
- Browser tests for overlays, menus, forms, and tables.

## Rules

- Use `@askrjs/ui` for behavior-heavy controls before raw HTML.
- Every interactive control needs an accessible name.
- Dialogs and menus need predictable focus entry, trapping where appropriate, and dismissal.
- Form fields need labels, error text, and relationship attributes when supported.
- Tables need semantic headers and stable row identity.
- Async errors and important status changes should be announced with appropriate live region or alert semantics.

## Eventual Consistency

- Pending writes and stale data should be visible to screen-reader users, not color-only.
- Row-level syncing or failed status needs text, not only icons.
- Streaming/agent timelines should avoid overwhelming live announcements; announce major state changes.

## Avoid

- Reimplementing primitive keyboard behavior.
- Icon-only buttons without labels.
- Focus loss after route changes, dialogs, or list updates.
- Color-only error, stale, selected, or pending states.
- Toast-only critical errors.

## Checks

- Keyboard-only users can complete the workflow.
- Focus lands in the expected place after navigation, dialog open/close, and submit.
- Axe or equivalent accessibility checks pass for changed surfaces when available.
- Browser tests cover complex focus and keyboard behavior.
