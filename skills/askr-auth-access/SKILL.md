---
name: askr-auth-access
description: Use when building Askr authentication, session loading, public/app route branches, protected layouts, role and permission metadata, redirects, login/logout, and access-denied UX.
---

# Askr Auth Access

Use this for authentication and authorization in route-first Askr apps.

## Inspect First

- `src/pages/_routes.tsx`, `src/pages/public/_routes.tsx`, and `src/pages/app/_routes.tsx`.
- `src/pages/public/_layout.tsx` and `src/pages/app/_layout.tsx`.
- Existing session, token, and user helpers in `src/shared` or `src/features/auth`.
- Router auth resolver configuration.

## Route Model

- Public branch: landing, login, recovery, invite acceptance, guest-only pages.
- App branch: authenticated product routes wrapped by the app layout.
- Put auth metadata on route groups when the whole branch shares policy.
- Put role/permission metadata on the narrowest route group or leaf that needs it.

## Canonical Pattern

```tsx
group({ layout: PublicLayout, auth: 'guest' }, () => {
  registerPublicRoutes();
});

group({ layout: AppLayout, auth: true }, () => {
  registerAppRoutes();
});
```

## UX Rules

- Session loading should block protected app chrome until the app knows whether a user exists.
- Redirect unauthenticated users to login with a return target when useful.
- Redirect authenticated users away from guest-only login screens.
- Show explicit forbidden/unauthorized states when the user is signed in but lacks access.
- Keep sign-out behavior in the authenticated shell or auth feature workflow.

## Avoid

- Per-page auth checks duplicated across protected routes.
- Rendering protected app data before session resolution.
- Putting token storage or API auth header logic in components.
- Treating roles and permissions as visual-only state.

## Checks

- Public and app branches are explicit.
- Protected routes have auth policy in route metadata.
- Access-denied, loading, and redirect behavior are tested.
- Auth state is available to adapters without leaking transport details into UI.
