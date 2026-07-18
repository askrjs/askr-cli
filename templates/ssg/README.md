# {{appName}}

Static site built with [Askr](https://github.com/askrjs/askr).

## Development workflow

The starter keeps the authoring loop small and explicit:

1. Run `npm run dev` for the SPA-style editing experience.
2. Edit the page components in `src/pages/`.
3. Register routes in `src/routes.tsx`.
4. Run `npm run build` to build client assets and atomically generate `dist/`.
5. Run `npm run preview` to check the production build locally.

## Sample pages

- `/` introduces the starter and the basic developer loop.
- `/workflow` explains the edit, generate, and preview loop.
- `/content` shows the small explicit route map.
- `/preview` keeps one interactive page so you can verify hydration.

## Commands

```bash
npm run dev        # Start dev server (runs as SPA)
npm run build      # Build assets and generate the complete static site
npm run generate   # Regenerate static HTML with the Askr CLI
npm run preview    # Preview production build
npm test           # Run tests
npm run lint       # Lint code
npm run fmt        # Format code
npm run typecheck  # Type check
```

## Static generation

Run `npm run build` to compile browser assets and pre-render every route into `dist/`. The `askr ssg` command owns both full and incremental generation, and publishes routes, metadata, the incremental manifest, browser assets, `sitemap.xml`, and the managed `robots.txt` sitemap directive together.

`ssg.config.ts` passes the same immutable route registry used in dev mode, so the shell and leaf pages stay in sync.
