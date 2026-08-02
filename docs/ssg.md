# Static site generation

`askr ssg` owns static route publication and SEO discovery artifacts.

```bash
askr ssg --config ./ssg.config.ts --output ./dist
askr ssg --config ./ssg.config.ts --output ./dist --incremental
```

The command rejects unknown options, missing values, invalid worker counts, and
output directories that contain the project or config. Every build runs in a
sibling staging directory. Incremental builds begin from a copy of the current
output so skipped routes and the existing manifest remain available. The live
directory is swapped only after route generation and sitemap validation pass.
Every successful or incrementally retained HTML document is parsed with an HTML
parser before publication. Output reporting and configured budgets inspect the
complete staged result, so a failed integrity check leaves the previous live
directory unchanged.

## Sitemap ownership

Unless `sitemap: false` is explicit, config must provide an absolute HTTP(S)
`siteUrl`. Successful and incrementally skipped concrete routes are included;
failed and wildcard routes are excluded.

```ts
import type { SitemapConfig } from "@askrjs/cli/ssg";

const sitemap = {
  defaults: { changeFrequency: "weekly" },
  routes: {
    "/404": false,
    "/guide": { lastModified: "2026-07-18", priority: 0.8 },
  },
  resolve: async (route) => (route.path.startsWith("/private/") ? false : {}),
  resolverConcurrency: 16,
} satisfies SitemapConfig;

export const staticConfig = {
  registry,
  siteUrl: "https://example.com/docs/",
  sitemap,
};
```

Each rendered document may declare at most one `<link rel="canonical">`. When
present, that link is authoritative for the route's sitemap URL; relative
values resolve against `siteUrl`. The normalized absolute value is available as
`route.canonical` inside `sitemap.resolve`. Without a rendered canonical, the
concrete route URL remains the fallback. The build fails if a document has
multiple canonical links or if `sitemap.routes[route].url` or a resolver `url`
disagrees with the rendered canonical.

Supported URL metadata includes canonical overrides, W3C dates and datetimes,
change frequency, crawl priority, and `hreflang` alternates. Dates are checked
as real calendar values. Canonical URLs and alternates are validated and XML
escaped, and duplicate canonical URLs fail the build.

The CLI enforces the sitemap protocol limits of 50,000 URLs and 50 MB per file.
Larger route sets are deterministically partitioned and `sitemap.xml` becomes a
sitemap index. `robots.txt` is created or updated by default while preserving
unrelated directives. Set `robots: false` to remove the managed `Sitemap:` line.
Generated sitemap files are tracked in `.askr/sitemap-manifest.json`, allowing
obsolete chunks and changed output paths to be cleaned safely.

`limits.urlsPerFile` and `limits.bytesPerFile` may lower, but never raise, the
protocol limits. They are useful for controlled deployments and tests.

## Output report and budgets

Successful builds write a deterministic machine-readable report to
`.askr/ssg-output.json` by default. Set `outputReport: false` only when the
artifact is intentionally disabled. The report includes:

- raw and gzip HTML bytes per route;
- hydration JSON bytes and its share of the document;
- local initial JavaScript and CSS references per route;
- every emitted non-HTML asset, excluding internal manifests and the report;
- aggregate JavaScript/CSS bytes and deterministically sorted largest-page and
  largest-asset lists.

Reporting is informational unless budgets are configured:

```ts
export const staticConfig = {
  registry,
  siteUrl: "https://example.com",
  outputReport: {
    largestPages: 25,
    largestAssets: 25,
    budgets: {
      routes: { raw: 400_000, gzip: 80_000 },
      routeOverrides: {
        "/catalog": { raw: 800_000 },
        "/archive": false,
      },
      hydration: {
        share: 0.25,
        routes: { "/interactive-map": 0.5, "/static-export": false },
      },
      assets: {
        "assets/app.js": { raw: 300_000, gzip: 90_000 },
      },
      aggregate: {
        javascript: { gzip: 250_000 },
        css: { gzip: 80_000 },
      },
    },
  },
};
```

Route overrides are exact and merge with the global route defaults; `false`
exempts that exact route. Hydration shares use ratios from `0` through `1`.
Asset limits are exact emitted paths. A failure lists every violating
route/asset, measurement, limit, and a remediation before the staged directory
is discarded.
