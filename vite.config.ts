import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      cli: 'src/bin/cli.js',
      create: 'src/bin/create.js',
      ssg: 'src/bin/ssg.js',
    },
    format: ['esm'],
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    copy: ['templates'],
    deps: {
      neverBundle: [/^@askrjs\/askr(?:\/.*)?$/],
    },
  },
});
