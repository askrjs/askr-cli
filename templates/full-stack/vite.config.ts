import { defineConfig } from "vite-plus";
import { askr } from "@askrjs/vite";
import { askrServer } from "@askrjs/vite/server";

export default defineConfig({
  plugins: [askr(), askrServer({ entry: "./src/server/entry-server.ts" })],
  lint: { ignorePatterns: ["dist/**", "node_modules/**", "coverage/**"] },
  server: { port: 5173, open: true },
  build: { manifest: true, sourcemap: true },
});
