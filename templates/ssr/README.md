# {{appName}}

An Askr application with server rendering, browser hydration, and a Node production adapter.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
```

## Rendering model

`src/routes.tsx` exports one route registry shared by the browser and server. The server entry composes `createServerApp()` with `createAskrPageHandler()`, which returns an Askr HTML fragment plus normalized document metadata. The Vite server integration preserves static head content, injects Askr-owned metadata at the single `<!--askr-head-->` marker, and inserts the fragment at the single `<!--askr-app-->` marker.

In development, Vite reloads the server entry and document for each HTML request. The production build emits a document-composing server app; `server.ts` only adapts that Web `ServerApp` to Node transport.

API responses and other non-fragment responses pass through without document composition.

## Structure

```text
index.html            document source and sole askr-head and askr-app markers
server.ts             production Node launcher
src/
  main.tsx            browser hydration
  entry-server.tsx    composed ServerApp
  routes.tsx          shared route registry
  app.tsx             root layout
  pages/               route components
  components/          reusable components
  resources/           data resources
```

The application source does not construct document markup or expose a `render(url)` callback. Document ownership stays in `index.html` and `@askrjs/vite/server`.
