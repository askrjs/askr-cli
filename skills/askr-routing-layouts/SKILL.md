---
name: askr-routing-layouts
description: Use when defining Askr routes, route groups, page shells, index routes, fallback routes, navigation, auth requirements, route loaders, layout boundaries, or SPA/SSR/SSG shared route trees.
---

# Askr Routing Layouts

Use this for route registration, shell ownership, route metadata, and navigation. The goal is one obvious route tree that is registered before boot.

## Use This When

- You are adding, moving, or protecting a route.
- You are changing a shell or layout boundary.
- You need to attach an auth requirement or route policy.
- You need to add route-aware navigation.

## Inspect First

- `src/main.tsx`
- The app's route registry file
- The nearest branch route file and `_layout.tsx`
- Existing navigation components for the same branch
- Tests that already cover routing or layout retention

## Choose The Owner

- `group()` for inherited layout, auth requirements, or policies without a path segment.
- `page()` for a pathful shell that renders child route content.
- `route()` for a leaf route.
- `index()` only inside a `page()` scope.
- `fallback()` at the root or inside a `page()` scope that owns the fallback.

## Do This In Order

1. Register the route in the existing route tree before app boot.
2. Put auth requirements and policies on the narrowest route or group that owns them.
3. Keep route components synchronous and put async work inside route-owned components or features.
4. Keep navigation in `Link`, `navigate()`, and `currentRoute()` instead of local copies of route state.

## Copy This Shape

```tsx
import { requireUser } from "@askrjs/auth";
import { createRouteRegistry, fallback, group } from "@askrjs/askr/router";

export const pageRegistry = createRouteRegistry(() => {
  group({ layout: RootLayout }, () => {
    group({ layout: PublicLayout }, () => {
      registerPublicRoutes();
    });
    group({ layout: AppLayout, auth: requireUser() }, () => {
      registerAppRoutes();
    });
    fallback(NotFoundPage);
  });
});
```

## Nested Example

```tsx
import { requirePermission } from "@askrjs/auth";
import { fallback, index, page, route } from "@askrjs/askr/router";

export function registerWorkspaceRoutes(): void {
  page("/workspaces/{workspaceId}", WorkspaceLayout, () => {
    index(WorkspaceOverviewPage);
    route("settings", WorkspaceSettingsPage, {
      auth: requirePermission("workspace.manage"),
    });
    route("members", WorkspaceMembersPage, {
      auth: requirePermission("workspace.read"),
    });
    fallback(WorkspaceNotFoundPage);
  });
}
```

Use relative child paths inside `page()`. Put requirements and policies on the narrowest route or group that owns them.

## Never Do These

- Registering routes during render.
- Calling `route()` inside components; use `currentRoute()` there.
- Nesting `page()` inside `page()`.
- Absolute child route paths inside `page()`.
- Treating `group()` as a fallback scope.
- Putting theme styling decisions in route registration.
- Building a second router or page-local auth gate when route metadata already owns it.

## Validate

- The route tree is registered before boot.
- Shared route behavior lives in `group()` instead of repeated route-local checks.
- Child routes under `page()` use relative paths.
- Fallback scope is explicit.
- Navigation uses router primitives instead of local state copies.

## Done When

- The route tree is still the only route tree in the app.

## Handoff

- Use `askr-auth-access` when the next step is session or permission behavior.
- Use `askr-project-structure` when routing work also adds new files.
- Use `askr-testing-determinism` to validate route identity, fallback behavior, and layout retention.
