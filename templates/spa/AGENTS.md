# {{appName}}

Client-side SPA built with Askr, askr-ui, askr-themes, and askr-charts.

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

- **Routing:** `src/main.tsx` imports the `pageRegistry` from `src/pages/_routes.tsx`, then passes it to `createSPA()`. Route branches live under `src/pages/public`, `src/pages/auth`, and `src/pages/app`.
- **Layouts:** `_layout.tsx` files own shells. The root layout owns `ThemeScope`; public layouts own landing chrome, auth layouts own sign-in chrome, and app layouts own authenticated sidebar chrome.
- **UI:** Prefer the `@askrjs/themes/components` catalog before writing local components. Use app-local components only for product concepts such as `MetricCard` and `StatusBadge`; keep charts in `@askrjs/charts`.
- **State:** `const [value, setValue] = state(initial)`. Read with `value()`, update with `setValue(...)`. Use `derive()` for computed values and `resource()` for async data.
- **Data:** Route/container components own resources; `src/features` owns product workflows; `src/adapters` owns API clients, transports, abort handling, and generated clients.
- **Consistency:** Event-sourced screens should expose pending writes, projection lag, stale data, retries, and manual refresh instead of hiding everything behind one loading state.
- **Styling:** Keep `src/styles.css` thin. Customize theme values in `src/styles/tokens.css`, global defaults in `src/styles/theme.css`, shell structure in `src/styles/layout.css`, and component classes in `src/styles/components.css`.
- **Charts:** Create typed plot namespaces from `@askrjs/charts` at module scope and compose marks inside `Plot.Root`; chart CSS is loaded from `@askrjs/charts/styles`.
- **Vite plugin:** `askr()` from `@askrjs/vite` handles JSX transform. Do not add manual esbuild JSX config.

## File Structure

```
src/
  main.tsx
  pages/
    _routes.tsx
    _layout.tsx
    public/
    auth/
    app/
  components/shared/
  features/
  adapters/
  shared/
  styles/
    reset.css
    tokens.css
    theme.css
    layout.css
    components.css
tests/
```

## Conventions

- Keep routes thin and route-first.
- Keep shell chrome in layouts, not leaf pages.
- Keep business logic out of `src/pages`.
- Use `Link` and `navigate` from `@askrjs/askr/router`.
- Use headless `@askrjs/ui/*` for behavior primitives and `@askrjs/themes/*` for composed visual surfaces.
- Avoid hardcoded color systems, custom component catalogs, and React habits like effect-driven data loading.

## Recovery and completion

- Run `askr repair` after analyzer failures; it applies only safe mechanical fixes.
- Resolve remaining semantic diagnostics deliberately.
- Run `npm run check` before declaring work complete. It requires clean Askr analysis, then runs lint, typecheck, tests, and build.
