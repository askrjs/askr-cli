import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      cli: "src/bin/cli.js",
      create: "src/bin/create.js",
      skills: "src/bin/skills.js",
      ssg: "src/bin/ssg.js",
    },
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    outExtensions: () => ({
      js: ".js",
    }),
    sourcemap: true,
    copy: ["templates", "skills"],
    deps: {
      neverBundle: [/^@askrjs\/askr(?:\/.*)?$/],
    },
  },
});
