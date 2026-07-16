import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      add: "src/bin/add.ts",
      cli: "src/bin/cli.ts",
      create: "src/bin/create.ts",
      generate: "src/bin/generate.ts",
      openapi: "src/bin/openapi.ts",
      skills: "src/bin/skills.ts",
      ssg: "src/bin/ssg.ts",
      update: "src/bin/update.ts",
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
      neverBundle: [/^@askrjs\/askr(?:\/.*)?$/, "tsx/esm/api"],
    },
  },
});
