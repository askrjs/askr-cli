# {{appName}}

This is a strict TypeScript, ESM-only Askr SSR application.

## Architecture

- `src/routes.tsx` owns the shared `createRouteRegistry()` result.
- `src/entry-server.tsx` exports a composed `ServerApp` using `@askrjs/server/askr`.
- `index.html` is the only document source and contains exactly one `<!--askr-head-->` marker and one `<!--askr-app-->` marker.
- `@askrjs/vite/server` owns development and production document composition.
- `server.ts` only starts the production app through `@askrjs/node`.
- `src/main.tsx` hydrates server HTML or starts the SPA when no fragment is present.

Do not add Express, a `render(url)` convention, inline document markup, or manual marker replacement to application code.

## Commands

```bash
npm run dev
npm run build
npm run preview
npm test
npm run typecheck
npm run lint
npm run fmt
```

Use askr-ui primitives for interactive controls, `--ak-*` theme tokens for styling, and preserve the shared server/browser route registry.
