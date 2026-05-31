# {{appName}}

Static site built with Askr, askr-ui, askr-themes, and createStaticGen.

## Commands

```bash
npm run dev        # Vite dev server (runs as SPA for development)
npm run build      # Production client build to dist/
npm run generate   # Pre-render all routes as static HTML to dist/static/
npm run preview    # Serve production build locally
npm test           # Vitest (jsdom)
npm run type-check # tsc --noEmit
npm run lint       # vite-plus lint
npm run fmt        # vite-plus format
```

## Architecture

- **Framework:** Askr - actor-backed, fine-grained reactive UI. No virtual DOM.
- **Boot flow:** `src/main.tsx` registers `registerAppRoutes()` and starts the browser app with `createSPA({ manifest: getManifest() })`.
- **SSG flow:** `ssg.config.ts` registers the same `registerAppRoutes()` function, derives `RouteConfig[]` from the manifest records, and `ssg-build.ts` calls `createStaticGen()`.
- **Pages:** `src/pages/home.tsx`, `src/pages/about.tsx`, `src/pages/content.tsx`, and `src/pages/example.tsx` form the sample site.
- **Shell:** `src/app.tsx` owns the nav and page frame.
- **Theme primitives:** the starter composes `Header`, `Nav`, `NavLink`, `Container`, `Section`, `Stack`, `Box`, and `Block` from `@askrjs/themes` instead of hand-rolling shell/layout wrappers.
- **Components:** askr-ui headless components. Props use `onPress` (not `onClick`) and `asChild` for polymorphism.
- **Styling:** askr-themes CSS via public classes and `data-slot` selectors. Theme import lives in `src/styles.css`.
- **Routing:** keep `registerAppRoutes()` in `src/routes.tsx` as the single route source of truth for both dev and SSG.
- **State:** `const [value, setValue] = state(initial)` and `derive()`. Keep starter routes synchronously prerenderable; if you add async data back, provide an SSR-safe strategy before expecting SSG to render it.
- **Vite plugin:** `askr()` from `@askrjs/vite` handles JSX transform.

## File Structure

```
ssg.config.ts          # Route definitions for static generation
ssg-build.ts           # Build script: calls createStaticGen
tsconfig.ssg.json      # Node-side TSX config for static generation
src/
  main.tsx             # Client entry: registers routes and boots createSPA
  app.tsx              # Root layout with nav
  routes.tsx           # Shared route registration source of truth
  styles.css           # Theme import + layout CSS
  components/          # Reusable components
  pages/               # Route page components
tests/                 # Vitest tests
```

## Conventions

- TypeScript strict mode, ESM-only
- JSX import source: `@askrjs/askr`
- Add new pages in `src/pages/`, then update `registerAppRoutes()` in `src/routes.tsx`
- Let `ssg.config.ts` derive static handlers from the shared route registration instead of maintaining a second hand-written list
- Use askr-ui components for interactive elements and askr-themes layout/shell primitives for structure
- Style with `--ak-*` tokens
- Keep SSG routes synchronous at render time unless you intentionally wire SSR data into generation
