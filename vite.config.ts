import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      add: "src/bin/add.ts",
      analyze: "src/bin/analyze.ts",
      cli: "src/bin/cli.ts",
      create: "src/bin/create.ts",
      database: "src/bin/database.ts",
      generate: "src/bin/generate.ts",
      openapi: "src/bin/openapi.ts",
      skills: "src/bin/skills.ts",
      ssg: "src/bin/ssg.ts",
      "ssg-config": "src/ssg.ts",
      update: "src/bin/update.ts",
    },
    format: ["esm"],
    outDir: "dist",
    platform: "node",
    outExtensions: () => ({
      js: ".js",
    }),
    sourcemap: false,
    copy: ["templates", "skills"],
    deps: {
      neverBundle: [/^@askrjs\/askr(?:\/.*)?$/, "tsx/esm/api"],
    },
  },
});
