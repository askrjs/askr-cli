---
name: askr-theming
description: Use when styling Askr apps with @askrjs/themes, tokens, data-theme, ThemeProvider, shell/nav/layout primitives, data-slot selectors, visual quality audits, dark mode, and theme/app boundary decisions.
---

# Askr Theming

Use this when applying or extending the optional Askr visual layer. Prefer solved `@askrjs/themes` primitives before inventing app-local wrappers.

## Inspect First

- `askr-themes/docs/askr-themes.md`
- `askr-themes/docs/theming.md`
- `askr-themes/docs/tokens.md`
- Existing `src/styles.css` and `src/styles/*`.

## Layer Model

- Import the default theme once at the app boundary or stylesheet entry.
- Override semantic tokens in app CSS.
- Use `data-theme` on `<html>` or `ThemeProvider` for runtime switching.
- Use `data-slot` and documented alias classes as selectors.
- Keep runtime TS/JS free of hardcoded `--ak-*` token literals.

## Canonical Imports

```ts
import '@askrjs/themes/default';
import { ThemeProvider, ThemePicker } from '@askrjs/themes/theme';
import {
  AspectRatio,
  Block,
  Box,
  Container,
  Flex,
  Inline,
  Section,
  Spacer,
  Stack,
} from '@askrjs/themes/layouts';
import { Button, ButtonGroup, Field, FieldError, FieldHint, InputGroup } from '@askrjs/themes/controls';
import { Alert, Badge, Card, CardActions, CardContent, CardHeader, CardTitle, Skeleton } from '@askrjs/themes/surfaces';
import { EmptyState, Spinner } from '@askrjs/themes/feedback';
import { Header, Shell, ShellMain, ShellNav } from '@askrjs/themes/shells';
import { Breadcrumb, Nav, NavGroup, NavLink, Pagination, Sidebar } from '@askrjs/themes/navs';
```

## Solved Surface Area

Use these before creating new primitives:

- Layout: `Box`, `Flex`, `Inline`, `Stack`, `Block`, `Container`, `Section`, `Spacer`, `AspectRatio`.
- Controls/forms: themed `Button`, `ButtonGroup`, `Close`, `Field`, `FieldHint`, `FieldError`, `InputGroup`, `InputGroupText`.
- Surfaces: `Alert`, `Badge`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardActions`, `ListGroup`, `ListGroupItem`, `Separator`, `Divider`, `Skeleton`.
- Feedback: `EmptyState`, `Spinner`.
- Shells/navs: `Header`, `Shell`, `ShellNav`, `ShellMain`, `Sidebar`, `SidebarPanel`, `SidebarToggle`, `Navbar`, `Nav`, `NavBrand`, `NavGroup`, `NavItem`, `NavLink`, `NavToggle`, `Breadcrumb`, `Pagination`.
- Overlays: use `@askrjs/themes/overlays` for themed `Dropdown`, `Menu`, and `Menubar` composition.

## Layout Decision Rules

- Use `Container` for page width and gutters.
- Use `Container size="fluid"` for full-width app content.
- Use `Section` for major page rhythm.
- Use `Stack` for vertical flow.
- Use `Block` for responsive card or tile groups.
- Use `Flex` for explicit one-dimensional flex layout.
- Use `Inline` for horizontal inline groups such as button rows, filter chips, and metadata.
- Use `Box` for low-level layout props, spacing, dimensions, overflow, and positioning when no semantic primitive fits.
- Use `Spacer` only for deliberate layout separation that should remain structural.
- Use `AspectRatio` for media, embeds, and fixed-ratio preview regions.
- Use `Sidebar` for vertical app navigation.
- Use `Navbar` for horizontal topbars.
- Use `Shell`/`ShellNav`/`ShellMain` for app frame composition.
- Use themed controls, surfaces, and feedback primitives when you want the default admin visual language.
- Compose product-specific page recipes in userland.

## Token Rules

- Override semantic `--ak-*` tokens in CSS after importing the default theme.
- Prefer color, spacing, density, layout, focus, elevation, motion, z-index, and state tokens before custom CSS values.
- Keep app token overrides in CSS; do not place raw token names or values in runtime TypeScript.
- Use component-level CSS only when a semantic token cannot express the app surface.

## Visual Standard

Aim for compact, readable, low-noise SaaS/admin UI. Check mobile, tablet, desktop, light, and dark states. Long labels must wrap or truncate intentionally in navs, cards, tables, badges, overlays, and dense rows.

## Avoid

- Moving runtime behavior into theme files.
- Treating theme components as app state containers.
- Hardcoded non-token colors when tokens exist.
- Deep internal selectors or `!important`.
- Marketing-page assumptions in operational SaaS surfaces.
- Inventing app-local `Panel`, `HStack`, `VStack`, `Page`, `Toolbar`, `Badge`, `Card`, or `EmptyState` components before checking the theme surface.
- Recreating shell, nav, feedback, form field, or responsive layout primitives already exported by `@askrjs/themes`.

## Checks

- No clipped text, horizontal overflow, or misaligned icons.
- Focus, hover, disabled, empty, and error states are styled.
- Dark mode has deliberate contrast and depth.
- App-specific CSS remains override-friendly.

## Source Files

- `askr-themes/docs/askr-themes.md`
- `askr-themes/docs/theming.md`
- `askr-themes/visual-check.html`
- `askr-cli/templates/startkit/src/styles/tokens.css`
