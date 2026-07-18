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
