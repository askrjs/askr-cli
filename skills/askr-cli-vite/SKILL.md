---
name: askr-cli-vite
description: Use when scaffolding Askr projects with @askrjs/cli, choosing spa/ssr/ssg/startkit templates, configuring @askrjs/vite, JSX import source, Vite build setup, generated app customization, or fixing transform wiring.
---

# Askr CLI Vite

Use this for project creation and build integration.

## Inspect First

- `askr-cli/docs/create.md`
- `askr-cli/docs/workflows.md`
- `askr-vite/README.md`
- Existing `package.json`, `vite.config.ts`, and `tsconfig.json`.

## Template Choice

- `startkit`: default for new product apps with dashboard, accounts, settings, login, themes, icons, and common checks.
- `spa`: minimal client-rendered interactive app.
- `ssr`: server-rendered app boundary.
- `ssg`: static generation scaffold with `ssg.config.ts`.

## CLI Pattern

```bash
npm install -g @askrjs/cli
askr create startkit my-app
cd my-app
npm run dev
```

Use `askr <command> [args]` after installation. Use `--no-install` only when dependency installation is managed elsewhere.

## Vite Pattern

```ts
import { defineConfig } from "vite";
import { askr } from "@askrjs/vite";

export default defineConfig({
  plugins: [askr()],
});
```

The plugin owns Askr JSX and template transforms. Keep Vite config focused on build/dev integration.

## Decision Rules

- Preserve generated Vite wiring unless the app has a specific build requirement.
- Use package-owned entrypoints instead of hand-written JSX transform config.
- Keep runtime behavior out of Vite config.
- After scaffolding, generated code is app-owned and should be customized consistently.

## Avoid

- Duplicating JSX transform setup in Vite, tsconfig, and custom esbuild config.
- Choosing `startkit` for a tiny isolated demo when `spa` fits better.
- Treating CLI-generated files as immutable.
- Adding runtime route or data decisions to build config.

## Checks

- `vite.config.ts` uses `askr()`.
- `package.json` scripts match the selected template.
- `tsconfig` JSX settings match askr template conventions.
- `npm run dev`, `npm run build`, and available checks pass after setup.

## Source Files

- `askr-cli/docs/create.md`
- `askr-cli/docs/workflows.md`
- `askr-vite/README.md`
- `askr-cli/templates/startkit/package.json`
- `askr-cli/templates/startkit/vite.config.ts`
