# {{appName}}

Client-side SPA built with Askr, askr-ui, askr-themes, and askr-charts.

## Commands

```bash
npm run dev        # Vite dev server with HMR (port 5173)
npm run build      # Production build to dist/
npm run preview    # Serve production build locally
npm test           # Vitest (jsdom)
npm run type-check # tsc --noEmit
npm run lint       # ESLint
npm run fmt        # Prettier
```

## Architecture

- **Framework:** Askr â€” actor-backed, fine-grained reactive UI. No virtual DOM.
- **Components:** askr-ui headless components (Button, Tabs, Accordion, Toggle, Input, NavLink, etc.). Props use `onPress` (not `onClick`), `asChild` for polymorphism, `data-slot` attributes for styling hooks.
- **Styling:** askr-themes CSS via `[data-slot]` selectors. Design tokens use `--ak-*` prefix. Theme import in `src/styles.css`. Switch themes by changing the import (e.g., `@askrjs/themes/tuxedo`).
- **Charts:** askr-charts provides the chart page primitives. Import `@askrjs/charts` in `src/main.tsx` so the package CSS loads.
- **Routing:** `registerRoutes()` composes `group()` and `route()` declarations in `src/routes.tsx`. Navigate with `<Link href="...">`. No config file.
- **State:** `state(initial)` creates reactive values. Read with `count()`, update with `count.set(v => v + 1)`. `derive()` for computed values. `resource()` for async data.
- **Vite plugin:** `askr()` from `@askrjs/vite` handles JSX transform â€” no manual esbuild config needed.

## File Structure

```
src/
  main.tsx           # Entry: createSPA + navigate
  app.tsx            # Shared app shell with nav
  routes.tsx         # Four-page route registration
  styles.css         # Theme import + app CSS
  components/        # Local helper components
  pages/             # Home, About, Components, Charts
  resources/         # Async data fetchers (resource())
tests/               # Vitest tests
```

## Conventions

- TypeScript strict mode, ESM-only
- JSX import source: `@askrjs/askr`
- Use askr-ui components instead of raw HTML for interactive elements
- Keep the SPA template compact; it should feel like a small app, not a framework catalog
- Style with `--ak-*` tokens, never `--pico-*` or hardcoded colors
- Prettier + ESLint enforced

