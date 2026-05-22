---
name: askr-ssr-ssg
description: Use when building askr server-rendered or static-generated apps, working with SSR/SSG entrypoints, route manifests, static generation configs, hydration-safe rendering, resource constraints, and render output verification.
---

# Askr SSR SSG

Use this when the app renders outside the browser or produces static output.

## Inspect First

- `askr/docs/guides/ssr.md`
- `askr/docs/guides/ssg.md`
- `askr/docs/core/rendering.md`
- `askr/docs/advanced/selective-hydration.md`
- Template files under `askr-cli/templates/ssr` or `askr-cli/templates/ssg`.

## Ownership

- `@askrjs/askr/ssr` owns server rendering helpers.
- `@askrjs/askr/ssg` owns static generation helpers.
- `@askrjs/cli` owns project templates and SSG command workflow.
- The route tree should be shared across SPA, SSR, and SSG where possible.

## Routing Rules

- Register routes at module load.
- Pass the route manifest into the boot/rendering path.
- Keep route definitions deterministic and environment-safe.
- Use route `entries` for generated parameter sets where SSG needs them.

## Async Rules

- Keep route handlers and render components synchronous.
- Use framework-supported data resolution paths for SSR/SSG templates.
- Do not read browser-only globals during server render.
- Keep hydration markup stable between server and client.

## Static Generation Pattern

```bash
npx @askrjs/cli create ssg my-site
npm run build
npx @askrjs/cli ssg --config ./ssg.config.ts --output ./dist/static
```

## Avoid

- Async components.
- Route registration that depends on request-time mutation.
- Browser-only APIs in render paths without guards.
- Divergent route trees for client, server, and static output.
- Hydration-affecting random values or time reads in initial render.

## Checks

- SSR/SSG build output is deterministic for the same inputs.
- Hydration has no structural mismatch warnings.
- Generated static routes cover expected params.
- Browser preview still navigates correctly after hydration.

## Source Files

- `askr/docs/guides/ssr.md`
- `askr/docs/guides/ssg.md`
- `askr/docs/core/rendering.md`
- `askr-cli/templates/ssr/`
- `askr-cli/templates/ssg/`
