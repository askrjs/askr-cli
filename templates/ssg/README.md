# {{appName}}

Static site built with [Askr](https://github.com/askrjs/askr).

## Development workflow

The starter keeps the authoring loop small and explicit:

1. Run `npm run dev` for the SPA-style editing experience.
2. Edit the page components in `src/pages/`.
3. Register routes in `src/routes.tsx`.
4. Run `npm run generate` to write static HTML into `dist/static/`.
5. Run `npm run preview` to check the production build locally.

## Sample pages

- `/` introduces the starter and the basic developer loop.
- `/workflow` explains the edit, generate, and preview loop.
- `/content` shows the small explicit route map.
- `/preview` keeps one interactive page so you can verify hydration.

## Commands

```bash
npm run dev        # Start dev server (runs as SPA)
npm run build      # Build for production
npm run generate   # Generate static HTML pages
npm run preview    # Preview production build
npm test           # Run tests
npm run lint       # Lint code
npm run fmt        # Format code
npm run type-check # Type check
```

## Static generation

Run `npm run generate` to pre-render all routes as static HTML files in `dist/static/`.

`ssg.config.ts` derives its static route list from the same route registration used in dev mode, so the shell and leaf pages stay in sync.
