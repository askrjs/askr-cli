import { test, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli } from "../src/bin/cli.js";
import { runCreateCli } from "../src/bin/create.js";
import { runSkillsCli } from "../src/bin/skills.js";
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
  expect(logs.join("\n")).toMatch(/askr - Unified CLI/);
  expect(logs.join("\n")).toMatch(/askr <command> \[args\]/);
  expect(logs.join("\n")).toMatch(/Commands:/);
  expect(logs.join("\n")).toMatch(/skills/);
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
    const sidebarFile = await fs.readFile(
      path.join(appRoot, "src", "components", "app-sidebar.tsx"),
      "utf8",
    );

    expect(packageJson).toMatch(/"name": "sample-app"/);
    expect(packageJson).toMatch(/"@askrjs\/lucide"/);
    expect(landingFile).toMatch(/Production-ready starter/);
    expect(routesFile).toMatch(/auth:\s*["']guest["']/);
    expect(routesFile).toMatch(/auth:\s*true/);
    expect(routesFile).toMatch(/group\(\{\s*layout:\s*App\s*\}/);
    expect(routesFile).toMatch(/fallback\(/);
    expect(routerFile).toMatch(/registerRoutes/);
    expect(routerFile).toMatch(/auth:\s*routeAuth/);
    expect(sidebarFile).toMatch(/Navbar orientation="vertical"/);
    expect(sidebarFile).toMatch(/NavGroup id="workspace-nav-group" label="Workspace"/);
    expect(sidebarFile).toMatch(/placement="bottom"/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli scaffolds SPA with the route-first themed app shell", async () => {
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
    const rootLayoutFile = await fs.readFile(path.join(appRoot, "src", "pages", "_layout.tsx"), "utf8");
    const routesFile = await fs.readFile(path.join(appRoot, "src", "pages", "_routes.tsx"), "utf8");
    const publicRoutesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "public", "_routes.tsx"),
      "utf8",
    );
    const appRoutesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "app", "_routes.tsx"),
      "utf8",
    );
    const appLayoutFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "app", "_layout.tsx"),
      "utf8",
    );
    const mainFile = await fs.readFile(path.join(appRoot, "src", "main.tsx"), "utf8");
    const stylesFile = await fs.readFile(path.join(appRoot, "src", "styles.css"), "utf8");
    const homeFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "public", "home.tsx"),
      "utf8",
    );
    const dashboardFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "app", "admin-home.tsx"),
      "utf8",
    );
    const operationsFile = await fs.readFile(
      path.join(appRoot, "src", "features", "operations", "operations.query.ts"),
      "utf8",
    );
    const adapterFile = await fs.readFile(
      path.join(appRoot, "src", "adapters", "operations-client.ts"),
      "utf8",
    );

    expect(rootLayoutFile).toMatch(/ThemeProvider/);
    expect(rootLayoutFile).toMatch(/defaultTheme=["']tabby["']/);
    expect(appLayoutFile).toMatch(/Shell/);
    expect(appLayoutFile).toMatch(/Sidebar/);
    expect(appLayoutFile).toMatch(/ThemeToggle/);
    expect(appLayoutFile).toMatch(/appNavItems/);
    expect(packageJson).toMatch(/"@askrjs\/charts"/);
    expect(routesFile).toMatch(/registerPublicRoutes/);
    expect(routesFile).toMatch(/registerAppRoutes/);
    expect(routesFile).toMatch(/fallback\(NotFoundPage\)/);
    expect(routesFile).toMatch(/group\(\{\s*layout:\s*AppLayout/);
    expect(publicRoutesFile).toMatch(/route\(["']\/admin-login["']/);
    expect(appRoutesFile).toMatch(/route\(["']\/app\/agents["']/);
    expect(mainFile).toMatch(/@askrjs\/askr\/boot/);
    expect(mainFile).toMatch(/getManifest/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/components\.css["']/);
    expect(homeFile).toMatch(/Route-first Askr SPA/);
    expect(homeFile).toMatch(/@askrjs\/themes\/layouts/);
    expect(dashboardFile).toMatch(/resource/);
    expect(dashboardFile).toMatch(/@askrjs\/charts\/components/);
    expect(operationsFile).toMatch(/loadOperations/);
    expect(adapterFile).toMatch(/AbortSignal/);
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
  expect(logs.join("\n")).toMatch(/askr ssg - Static Site Generation for Askr/);
});

test("runSkillsCli lists bundled skills", async () => {
  const { io, logs, errors } = createIo();
  const code = await runSkillsCli(["list"], io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs).toContain("askr-app-builder");
  expect(logs).toContain("askr-agent-workflows");
  expect(logs).toContain("askr-api-integration");
  expect(logs).toContain("askr-error-loading-empty");
  expect(logs).toContain("askr-realtime-streaming");
  expect(logs).toContain("askr-routing-layouts");
  expect(logs).toContain("askr-testing-determinism");
});

test("runSkillsCli installs bundled skills into project .skills", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-"));

  try {
    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["install", "--cwd", tempRoot], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Installed 24 Askr skills/);

    const skillFile = await fs.readFile(
      path.join(tempRoot, ".skills", "askr-app-builder", "SKILL.md"),
      "utf8",
    );
    const metadataFile = await fs.readFile(
      path.join(tempRoot, ".skills", "askr-app-builder", "agents", "openai.yaml"),
      "utf8",
    );

    expect(skillFile).toMatch(/name: askr-app-builder/);
    expect(metadataFile).toMatch(/display_name: "Askr App Builder"/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli refuses install into non-empty .skills without force", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-"));

  try {
    await fs.mkdir(path.join(tempRoot, ".skills"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, ".skills", "note.md"), "keep me", "utf8");

    const { io, errors } = createIo();
    const code = await runSkillsCli(["install", "--cwd", tempRoot], io);

    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/Refusing to install/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli sync updates Askr skills and preserves unrelated skills", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-"));

  try {
    const skillsRoot = path.join(tempRoot, ".skills");
    await fs.mkdir(path.join(skillsRoot, "custom-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, "custom-skill", "SKILL.md"), "custom", "utf8");
    await fs.mkdir(path.join(skillsRoot, "askr-old-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, "askr-old-skill", "SKILL.md"), "old", "utf8");
    await fs.writeFile(path.join(skillsRoot, "askr-routing.md"), "old flat skill", "utf8");

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["sync", "--cwd", tempRoot], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Synced 24 Askr skills/);

    await expect(fs.access(path.join(skillsRoot, "custom-skill", "SKILL.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(skillsRoot, "askr-old-skill"))).rejects.toThrow();
    await expect(fs.access(path.join(skillsRoot, "askr-routing.md"))).rejects.toThrow();
    await expect(
      fs.access(path.join(skillsRoot, "askr-app-builder", "SKILL.md")),
    ).resolves.toBeUndefined();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
