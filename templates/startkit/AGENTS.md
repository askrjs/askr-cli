# {{appName}}

Client-side SPA built with Askr, askr-ui, and askr-themes.

## Agent Workflow

- Read `package.json`, `src/main.tsx`, `src/router.tsx`, the nearest route file, and the nearest feature folder before editing.
- Use Askr skills in this order when scope is unclear: `askr-app-builder`, `askr-mental-model`, `askr-project-structure`, then the specialized skill for the touched surface.
- Prefer the smallest change that matches the existing route, feature, shell, and style conventions.
- Validate with the narrowest relevant executable check first, then widen only if needed.

## Commands

```bash
npm run dev        # Vite dev server with HMR (port 5173)
npm run build      # Production build to dist/
npm run preview    # Serve production build locally
npm test           # Vitest (jsdom)
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run fmt        # Prettier
```

## Architecture

- **Framework:** Askr - actor-backed, fine-grained reactive UI. No virtual DOM.
- **Components:** askr-ui headless components (Button, Accordion, Toggle, Input, etc.). Props use `onPress` (not `onClick`), `asChild` for polymorphism, `data-slot` attributes for styling hooks.
- **Styling:** askr-themes CSS via `[data-slot]` selectors. Keep `src/styles.css` as a thin entrypoint and organize styles in `src/styles/*` using layers (reset/tokens/theme/layout/components).
- **Routing:** `createRouteRegistry()` composes `group()` and `route()` declarations in `src/router.tsx`. Use `currentRoute()` inside components and navigate with `<Link href="...">`.
- **State:** Prefer `const [value, setValue] = state(initial)`. Read with `value()`, update with `setValue(...)`. `derive()` for computed values. `resource()` for async data.
- **Data flow:** Keep sample data in `src/lib/mock-data.ts`, not inline in pages. Read async data with `resource()` and keep mock mutations in the same lib boundary.
- **Preferences:** Keep persistent appearance/session helpers in the lib boundary and initialize at app bootstrap.
- **Vite plugin:** `askr()` from `@askrjs/vite` handles JSX transform - no manual esbuild config needed.

## Do Not Invent By Default

- React hooks, React Router patterns, or `useEffect`-style data loading.
- Generic query-client or global-store abstractions when `resource()`, `createQuery()`, or `createMutation()` already fit.
- App-local `Button`, `Card`, `Panel`, `Sidebar`, `Navbar`, `EmptyState`, `HStack`, or `VStack` clones before checking `@askrjs/ui` and `@askrjs/themes`.
- Route-local API clients or DTO mapping inside page components.

## File Structure

```
src/
  main.tsx           # Entry: createSPA + navigate
  app.tsx            # Root layout with nav
  router.tsx         # Route registration
  styles.css         # Style entrypoint
  styles/            # reset/tokens/theme/layout/components layers
  components/        # App-level reusable components
  layouts/           # app and auth route layouts
  features/          # feature-scoped UI modules
  pages/             # Route page components
  lib/               # Mock data + formatting helpers
tests/               # Vitest tests
```

## Conventions

- TypeScript strict mode, ESM-only
- JSX import source: `@askrjs/askr`
- Use askr-ui components instead of raw HTML for interactive elements
- Prefer composed components from `src/components/*` for app surfaces like panels, headers, tables, and empty states
- Style with tokens; avoid hardcoded non-theme colors in component classes
- Keep spacing on a strict rhythm: 4/8/16/24/32/48
- Keep typography to a small semantic scale (title/section/body/muted)
- Prefer subtle borders over heavy shadows or decorative effects
- Ensure consistent hover/focus-visible/disabled/empty/error treatment across components
- Prettier + ESLint enforced

## Validation

- Run the narrowest relevant test first.
- Run `npm run typecheck` for type-sensitive changes.
- Run `npm run build` when app boot, routing, or packaging changes.
- Confirm loading, empty, error, stale, and pending states remain truthful for user-visible flows.
- Run `askr repair` after analyzer failures; it applies only safe mechanical fixes.
- Resolve remaining semantic diagnostics deliberately.
- Run `npm run check` before declaring work complete. It requires clean Askr analysis, then runs lint, typecheck, tests, and build.
