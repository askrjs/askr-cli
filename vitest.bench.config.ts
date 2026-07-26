import { defineConfig } from "vite-plus";
import { AnalyzeBudgetReporter } from "./benchmarks/analyze-budget-reporter";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    reporters: ["default", new AnalyzeBudgetReporter()],
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
      includeSamples: false,
    },
  },
});
