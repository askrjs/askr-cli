# {{appName}} - SPA Template

A compact single-page app built with Askr, askr-ui, askr-themes, and askr-charts.

## Quick Start

```bash
npm install
npm run dev      # Start dev server at http://localhost:5173
npm run build    # Build for production
npm run preview  # Preview production build
npm test         # Run tests with Vitest
```

## Project Structure

```
src/
|-- main.tsx         # Entry point - creates SPA
|-- app.tsx          # Shared shell and navigation
|-- routes.tsx       # Route registration for the four app pages
|-- styles.css       # Theme import plus app styles
|-- components/      # Small local helpers (counter, labels, cards)
|-- pages/           # Home, About, Components, Charts
`-- resources/       # Async data fetchers
```

## Core Concepts

### Routing with `route()`

Routes are registered declaratively at module load time:

```tsx
// src/routes.tsx
import { group, registerRoutes, route } from '@askrjs/askr/router';
import AppLayout from './app';
import Home from './pages/home';
import About from './pages/about';
import Components from './pages/components';
import Charts from './pages/charts';

registerRoutes(() => {
  group({ layout: AppLayout }, () => {
    route('/', Home);
    route('/about', About);
    route('/components', Components);
    route('/charts', Charts);
  });
});
```

Navigate with the `Link` component:

```tsx
import { Link } from '@askrjs/askr/router';

<nav>
  <Link href="/">Home</Link>
  <Link href="/about">About</Link>
  <Link href="/components">Components</Link>
  <Link href="/charts">Charts</Link>
</nav>;
```

### State with `state()`

Create reactive values that trigger re-renders when updated:

```tsx
import { state } from '@askrjs/askr';

function Counter() {
  const count = state(0);

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set((c) => c + 1)}>Increment</button>
    </div>
  );
}
```

**Key points:**

- Call `state(initialValue)` to create a reactive value
- Call `count()` to read the current value
- Call `count.set(newValue)` or `count.set(prev => ...)` to update
- Only components that use the state re-render (fine-grained)

### What This Template Includes

- A shared app shell with `NavLink` navigation and theme toggle
- Two small landing pages for home and about
- A compact components page with tabs, accordion, toggle, input, and reactive counter
- A compact charts page with bar, donut, and heatmap demos

## Development Commands

```bash
npm run dev          # Start Vite dev server with HMR
npm run build        # Build for production to dist/
npm run preview      # Test production build locally
npm run type-check   # Run TypeScript type checking
npm run lint         # Check code with ESLint
npm run lint:fix     # Auto-fix linting issues
npm run fmt          # Format code with Prettier
npm test             # Run tests
npm test -- --watch  # Watch mode
npm test -- --ui     # Visual test dashboard
```

## Building for Production

```bash
npm run build    # Creates dist/ folder
npm run preview  # Serve dist/ locally to test
```

Deploy the `dist/` folder to any static host:

- **Netlify** - Connect GitHub repo, auto-deploys on push
- **Vercel** - Same as Netlify
- **GitHub Pages** - Works with Actions
- **AWS S3** - Static hosting
- **Cloudflare Pages** - Fast global CDN

## Common Patterns

### Controlled Inputs

```tsx
function Form() {
  const email = state('');

  return (
    <input
      value={email()}
      onInput={(e) => email.set(e.target.value)}
      type="email"
    />
  );
}
```

### Derived State

```tsx
import { derive } from '@askrjs/askr';

function Total() {
  const items = state([1, 2, 3]);
  const sum = derive(() => items().reduce((a, b) => a + b, 0));

  return <p>Total: {sum}</p>;
}
```

## Testing

Tests use Vitest (Jest-compatible):

```bash
npm test                    # Run once
npm test -- --watch         # Watch mode
npm test -- --ui            # Visual dashboard
npm test -- --coverage      # Coverage report
```

## Next Steps

1. Replace the landing copy with your app content.
2. Swap the demo datasets in `src/pages/charts.tsx` for your own data.
3. Add or remove routes in `src/routes.tsx` as the app grows.
4. Build on the local component helpers only where shared packages are not enough.
