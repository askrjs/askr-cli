import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin/is-direct-execution.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 78,
        branches: 69,
        functions: 88,
        lines: 80,
      },
    },
  },
});
