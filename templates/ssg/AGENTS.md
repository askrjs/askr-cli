# {{appName}}

Static site built with Askr, askr-ui, askr-themes, and the Askr CLI.

## Commands

```bash
npm run dev        # Vite dev server (runs as SPA for development)
npm run build      # Build client assets and atomically publish dist/
npm run generate   # Run full SSG through `askr ssg`
npm run preview    # Serve production build locally
npm test           # Vitest (jsdom)
npm run typecheck  # tsc --noEmit
npm run lint       # vite-plus lint
npm run fmt        # vite-plus format
```

## Architecture

- **Framework:** Askr - actor-backed, fine-grained reactive UI. No virtual DOM.
- **Boot flow:** `src/main.tsx` starts the browser app with the shared `pageRegistry`.
- **SSG flow:** `ssg.config.ts` passes that same registry to the complete executable SSG config. `askr ssg` owns full and incremental generation.
- **Pages:** `src/pages/home.tsx`, `src/pages/about.tsx`, `src/pages/content.tsx`, and `src/pages/example.tsx` form the sample site.
- **Shell:** `src/app.tsx` owns the nav and page frame.
- **Theme primitives:** the starter composes `Header`, `Nav`, `NavLink`, `Container`, `Section`, `Stack`, `Box`, and `Block` from `@askrjs/themes` instead of hand-rolling shell/layout wrappers.
- **Components:** askr-ui headless components. Props use `onPress` (not `onClick`) and `asChild` for polymorphism.
- **Styling:** askr-themes CSS via public classes and `data-slot` selectors. Theme import lives in `src/styles.css`.
- **Routing:** keep `pageRegistry` in `src/routes.tsx` as the single route source of truth for both dev and SSG.
- **State:** `const [value, setValue] = state(initial)` and `derive()`. Keep starter routes synchronously prerenderable; if you add async data back, provide an SSR-safe strategy before expecting SSG to render it.
- **Vite plugin:** `askr()` from `@askrjs/vite` handles JSX transform.

## File Structure

```
ssg.config.ts          # Routes, document renderer, and static asset sources
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
- Add new pages in `src/pages/`, then update `pageRegistry` in `src/routes.tsx`
- Pass the shared registry through `ssg.config.ts` instead of maintaining a second hand-written route list
- Keep SSG execution behind `askr ssg`; do not add a parallel project-local generator
- Use askr-ui components for interactive elements and askr-themes layout/shell primitives for structure
- Style with `--ak-*` tokens
- Keep SSG routes synchronous at render time unless you intentionally wire SSR data into generation
