import { defineConfig } from "vite-plus";
import { AnalyzeBudgetReporter } from "./benchmarks/analyze-budget-reporter";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    reporters: ["default", new AnalyzeBudgetReporter()],
    globalSetup: ["./benchmarks/analyze-global-setup.ts"],
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
    },
  },
});
