# Hydration verification

`askr verify-hydration` catches SSG defects that are invisible in generated
HTML but move, insert, or remove elements after the browser mounts the client
application.

## Default workflow

From an SSG project:

```bash
askr verify-hydration
```

The command:

1. runs `npm run build`;
2. reads successful routes from `dist/metadata.json`;
3. serves the exact generated route files and assets on a loopback-only,
   no-cache HTTP server;
4. loads each route in headless Chrome with JavaScript disabled;
5. loads it again with JavaScript enabled, waits for the document and module
   scripts to complete, then waits two animation frames;
6. compares tag-and-child topology below `#app`.

Text, attributes, comments, and non-structural execution artifacts (`script`,
`style`, `link`, `meta`, `noscript`, and `template`) are excluded from the
structural snapshot. Normal text, class, ARIA, and JavaScript-fallback changes
after hydration therefore remain valid. A node moving from one sibling
container to another changes its normalized path and fails the check. Browser
page errors and `console.error` messages also fail closed. The verifier does not
wait for network idleness, so healthy polling, streaming, and SSE connections
cannot hold the check open.

## Route sets and existing output

Repeat `--route` to select a subset of concrete metadata routes:

```bash
askr verify-hydration --route / --route /docs
```

Without `--route`, every successful route in `metadata.json` is verified.
Unknown routes, invalid metadata, output paths escaping the generated
directory, missing roots, HTTP failures, browser errors, and timeouts are
reported as failures.

Use an existing output directory without rebuilding:

```bash
askr verify-hydration --no-build --output ./.askr/site
```

Use `--build-script <name>` when the owning package exposes SSG through a script
other than `build`. Use `--root <selector>` when the hydrated application root
is not `#app`. `--timeout <ms>` controls the per-route browser timeout.

## Browser setup

The command uses `playwright-core` without downloading a browser into the CLI
package. It defaults to the system Chrome channel on macOS, Linux, and Windows.
Microsoft Edge is also supported:

```bash
askr verify-hydration --browser-channel msedge
```

For a Playwright-managed Chromium installation:

```bash
npx playwright-core install chromium
askr verify-hydration --browser-channel playwright
```

Set `ASKR_BROWSER_CHANNEL` to choose the default channel in CI. A command-line
`--browser-channel` value takes precedence.

## Cleanup and failures

The browser, browser contexts, pages, and loopback server close in `finally`
paths on success, DOM divergence, page error, timeout, and launch failure.
Build subprocesses have a five-minute ceiling and receive termination before
the command reports a timeout.
