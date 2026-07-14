import { defineConfig } from 'vite-plus';
import { askr } from '@askrjs/vite';
import { askrServer } from '@askrjs/vite/server';

export default defineConfig({
  plugins: [askr(), askrServer({ entry: './src/entry-server.tsx' })],
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    trailingComma: 'es5',
    printWidth: 80,
    tabWidth: 2,
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    manifest: true,
    sourcemap: true,
  },
});
