# {{appName}}

An Askr full-stack application with shared routes, executable schemas, declared actions, API routes, SSR hydration, i18n, telemetry seams, and Node/Vite production entrypoints.

## Commands

```bash
npm install
npm run dev
npm run check
npm run build
npm run preview
```

Use `askr add action <name> --route <path>` to generate a browser-safe descriptor, server handler, composition-root registration, route authorization, and focused test.

`index.html` owns the static document. `@askrjs/vite/server` injects only Askr-owned head nodes and composes the streamed app response at `<!--askr-app-->`.
