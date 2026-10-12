import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: process.env.ASKR_FINAL18_ADMISSION ? ["./tests/helpers/final-parent-setup.ts"] : [],
  },
});
