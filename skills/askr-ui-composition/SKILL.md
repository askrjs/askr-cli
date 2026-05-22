---
name: askr-ui-composition
description: Use when composing Askr UI with @askrjs/ui headless primitives, accessibility behavior, asChild polymorphism, root-owned state, private component context, slots, keyboard behavior, overlays, and app-local components.
---

# Askr UI Composition

Use this when building interactive UI from `@askrjs/ui` primitives or reviewing app-local components for idiomatic composition.

## Inspect First

- `askr-ui/docs/askr-ui.md`
- `askr-ui/docs/components.md`
- `askr-ui/docs/composition.md`
- Existing component imports and slot naming.

## Ownership Model

- `@askrjs/ui` owns behavior, focus, keyboard support, ARIA, dismissal, and headless structure.
- `@askrjs/themes` owns optional visual wrappers and default styling.
- App components own product composition, copy, data, and workflow state.

## Choose UI Or Theme

- Use `@askrjs/ui` directly when the app has its own CSS/design system or needs a headless behavior primitive.
- Use `@askrjs/themes/controls`, `surfaces`, `feedback`, `shells`, `navs`, and `overlays` when the default Askr visual system should style the primitive.
- Do not create app-local wrappers for solved theme surfaces unless the wrapper adds product semantics.

## Canonical Pattern

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@askrjs/ui/alert-dialog';

<AlertDialog>
  <AlertDialogTrigger asChild>
    <button>Archive</button>
  </AlertDialogTrigger>
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogContent>
      <AlertDialogTitle>Archive account?</AlertDialogTitle>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Archive</AlertDialogAction>
    </AlertDialogContent>
  </AlertDialogPortal>
</AlertDialog>;
```

## Decision Rules

- Use `Button`, `Input`, `Checkbox`, `Select`, `Switch`, `Toggle`, `Dialog`, `AlertDialog`, `Popover`, `Menu`, `Menubar`, `Dropdown`, `Tooltip`, and related families before raw interactive HTML.
- Use themed `Button`, `Field`, `InputGroup`, `Card`, `Alert`, `EmptyState`, `Spinner`, `Nav`, `Sidebar`, `Navbar`, and `DropdownContent` when visual styling should come from `@askrjs/themes`.
- Keep coordination state in the root component that owns the interaction, using a local `[getter, setter]` pair from `state()`.
- Use `asChild` when a primitive part should preserve caller markup.
- Use `data-slot` on structural app nodes for stable styling hooks.
- Use direct subpaths for focused imports and root imports when the module already imports several families.

## Avoid

- Reimplementing keyboard, focus, or dismissal behavior already owned by a primitive.
- Styling or business logic inside behavior primitives.
- Leaf components that fetch data or own routing.
- Silent invalid composition when a part requires a root scope.
- Prop bloat where composition would be clearer.

## Checks

- Keyboard and pointer behavior match the primitive contract.
- ARIA labels, names, and roles are present where required.
- `asChild` preserves expected markup and events.
- Interactive behavior has jsdom or browser coverage when user-facing.

## Source Files

- `askr-ui/docs/composition.md`
- `askr-ui/docs/components.md`
- `askr-cli/templates/startkit/src/pages/workspace/accounts/index.tsx`
