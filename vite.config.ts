import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  pack: {
    entry: {
      add: "src/bin/add.ts",
      analyze: "src/bin/analyze.ts",
      cli: "src/bin/cli.ts",
      create: "src/bin/create.ts",
      database: "src/bin/database.ts",
      generate: "src/bin/generate.ts",
      openapi: "src/bin/openapi.ts",
      skills: "src/bin/skills.ts",
      ssg: "src/bin/ssg.ts",
      "ssg-config": "src/ssg.ts",
      update: "src/bin/update.ts",
    },
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    outExtensions: () => ({
      js: ".js",
    }),
    sourcemap: false,
    copy: ["templates", "skills"],
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
      neverBundle: [/^@askrjs\/askr(?:\/.*)?$/, "tsx/esm/api"],
    },
  },
});
