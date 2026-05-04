import { test, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli } from "../src/bin/cli.js";
import { runCreateCli } from "../src/bin/create.js";
import { runSsgCli } from "../src/bin/ssg.js";

function createIo() {
  const logs = [];
  const errors = [];

  return {
    io: {
      log: (...args) => logs.push(args.join(" ")),
      error: (...args) => errors.push(args.join(" ")),
    },
    logs,
    errors,
  };
}

test("runCli prints top-level help", async () => {
  const { io, logs, errors } = createIo();
  const code = await runCli(["--help"], io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs.join("\n")).toMatch(/askr-cli - Unified CLI/);
  expect(logs.join("\n")).toMatch(/Commands:/);
});

test("runCreateCli defaults to startkit when template is omitted", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const { io, errors } = createIo();
    const code = await runCreateCli(["sample-app", "--no-install"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "sample-app");
    const packageJson = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
    const landingFile = await fs.readFile(path.join(appRoot, "src", "pages", "home.tsx"), "utf8");
    const routesFile = await fs.readFile(path.join(appRoot, "src", "routes", "index.ts"), "utf8");
    const routerFile = await fs.readFile(path.join(appRoot, "src", "router.tsx"), "utf8");

    expect(packageJson).toMatch(/"name": "sample-app"/);
    expect(packageJson).toMatch(/"@askrjs\/askr-lucide"/);
    expect(landingFile).toMatch(/Production-ready starter/);
    expect(routesFile).toMatch(/auth:\s*'guest'/);
    expect(routesFile).toMatch(/auth:\s*true/);
    expect(routesFile).toMatch(/group\(\{\s*layout:\s*App\s*\}/);
    expect(routesFile).toMatch(/fallback\(/);
    expect(routerFile).toMatch(/registerRoutes/);
    expect(routerFile).toMatch(/auth:\s*routeAuth/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli scaffolds SPA with the compact four-page app shell", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const { io, errors } = createIo();
    const code = await runCreateCli(["spa", "sample-spa", "--no-install"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "sample-spa");
    const packageJson = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
    const appFile = await fs.readFile(path.join(appRoot, "src", "app.tsx"), "utf8");
    const routesFile = await fs.readFile(path.join(appRoot, "src", "routes.tsx"), "utf8");
    const mainFile = await fs.readFile(path.join(appRoot, "src", "main.tsx"), "utf8");
    const stylesFile = await fs.readFile(path.join(appRoot, "src", "styles.css"), "utf8");
    const homeFile = await fs.readFile(path.join(appRoot, "src", "pages", "home.tsx"), "utf8");
    const componentsFile = await fs.readFile(path.join(appRoot, "src", "pages", "components.tsx"), "utf8");
    const chartsFile = await fs.readFile(path.join(appRoot, "src", "pages", "charts.tsx"), "utf8");

    expect(appFile).toMatch(/ThemeProvider/);
    expect(appFile).toMatch(/ThemeToggle/);
    expect(appFile).toMatch(/NavLink/);
    expect(appFile).toMatch(/@askrjs\/themes\/components/);
    expect(appFile).toMatch(/MoonIcon/);
    expect(appFile).toMatch(/SunIcon/);
    expect(appFile).toMatch(/toggleThemes=\{\["light", "dark"\]\}/);
    expect(appFile).toMatch(/Toggle color theme/);
    expect(packageJson).toMatch(/"@askrjs\/askr-charts"/);
    expect(routesFile).toMatch(/route\('\/components', Components\);/);
    expect(routesFile).toMatch(/route\('\/charts', Charts\);/);
    expect(mainFile).toMatch(/@askrjs\/askr-charts/);
    expect(stylesFile).toMatch(/@import "\.\/styles\/components\.css"/);
    expect(homeFile).toMatch(/A small app shell with a few real parts/);
    expect(componentsFile).toMatch(/Shared state/);
    expect(chartsFile).toMatch(/A few interactive charts, kept intentionally compact/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSsgCli prints help without requiring config", async () => {
  const { io, logs, errors } = createIo();
  const code = await runSsgCli(["--help"], undefined, io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs.join("\n")).toMatch(/askr-ssg - Static Site Generation for Askr/);
});
