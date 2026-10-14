import { defineConfig } from "vite-plus";
import { AnalyzeBudgetReporter } from "./benchmarks/analyze-budget-reporter";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    globalSetup: ["./benchmarks/analyze-global-setup.ts"],
    benchmark: {
      reporters: ["default", new AnalyzeBudgetReporter()],
      include: ["benchmarks/**/*.bench.ts"],
      includeSamples: false,
    },
  },
});
