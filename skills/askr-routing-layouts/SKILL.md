---
name: askr-routing-layouts
description: Use when defining Askr routes, route groups, page shells, index routes, fallback routes, navigation, auth metadata, route loaders, layout boundaries, or SPA/SSR/SSG shared route trees.
---

# Askr Routing Layouts

Use this for URL structure, route registration, app shells, and navigation.

## Inspect First

- `askr/docs/reference/router.md`
- `askr/docs/guides/router.md`
- `askr/docs/guides/layouts.md`
- Existing `src/pages/_routes.tsx`, branch `_routes.tsx` files, and branch layouts.
- Existing `src/pages/**/_layout.tsx` components before adding a new shell.

## Route-First Shape

- `src/main.tsx` imports `src/pages/_routes.tsx` before app boot.
- `src/pages/_routes.tsx` composes public and authenticated branches.
- `src/pages/_layout.tsx` wraps app-wide providers and global styling.
- `src/pages/public/_routes.tsx` registers guest routes under `src/pages/public/_layout.tsx`.
- `src/pages/app/_routes.tsx` registers authenticated routes under `src/pages/app/_layout.tsx`.
- Leaf screens live inside their branch, such as `src/pages/public/home.tsx` or `src/pages/app/admin-home.tsx`.

## Canonical Pattern

```tsx
import { fallback, group, index, page, registerRoutes, route } from "@askrjs/askr/router";

registerRoutes(() => {
  group({ layout: RootLayout }, () => {
    group({ layout: PublicLayout }, () => {
      registerPublicRoutes();
    });
    group({ layout: AppLayout, auth: true }, () => {
      registerAppRoutes();
    });
    fallback(NotFoundPage);
  });
});
```

## Decision Rules

- Use `route(path, Component, options?)` for leaves.
- Use `group(options, fn)` for inherited layout, auth, role, permission, and policy behavior without a path segment.
- Use `page(path, Component, fn)` when a pathful shell renders child route content with `Outlet`.
- Use `index(Component)` only inside a `page()` scope.
- Use `fallback(Component)` at root or directly inside a `page()` scope.
- Use `{param}` path syntax, not `:param`.
- Keep route handlers synchronous; use `resource()` or query primitives inside route components.

## Navigation

- Use `Link` from `@askrjs/askr/router` for route links.
- Use `navigate()` for imperative navigation after an action.
- Use `currentRoute()` inside components that need active route state.
- Keep navigation state in the router rather than duplicating it in page state.

## Avoid

- Registering routes during render.
- Calling `route()` inside components; use `currentRoute()` there.
- Nesting `page()` inside `page()`.
- Absolute child route paths inside `page()`.
- Treating `group()` as a fallback scope.
- Putting theme styling decisions in route registration.

## Checks

- The route tree is imported and registered before app startup.
- Shared route behavior is in `group`, not duplicated per route.
- Public and authenticated branches have explicit route and layout files.
- Page-local children use relative paths.
- Fallback scope is explicit.
- Auth metadata has a resolver in `registerRoutes(..., { auth })` when used.

## Source Files

- `askr/docs/reference/router.md`
- `askr/docs/core/routing.md`
- `askr-cli/templates/startkit/src/routes/index.ts`
- `askr-cli/templates/startkit/src/router.tsx`
