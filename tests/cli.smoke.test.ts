import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { runAddCli } from "../src/bin/add";
import { runCli } from "../src/bin/cli";
import { runCreateCli } from "../src/bin/create";
import { listSkillReviewPrompts } from "../src/bin/skill-review";
import { runSkillsCli } from "../src/bin/skills";
import { runSsgCli } from "../src/bin/ssg";
import { writeFileChanges } from "../src/file-changes";

const execFileAsync = promisify(execFile);

function createIo(): {
  io: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  logs: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    io: {
      log: (...args: unknown[]) => logs.push(args.join(" ")),
      error: (...args: unknown[]) => errors.push(args.join(" ")),
    },
    logs,
    errors,
  };
}

function getMarkdownSection(markdown: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^### ${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^### |^## |\\Z)`, "m"),
  );

  if (!match) {
    throw new Error(`Missing markdown section: ${heading}`);
  }

  return match[1];
}

function getMarkdownLevel2Section(markdown: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^## ${escapedHeading}\\r?\\n([\\s\\S]*?)(?=^## |\\Z)`, "m"),
  );

  if (!match) {
    throw new Error(`Missing markdown level-2 section: ${heading}`);
  }

  return match[1];
}

function getBacktickedBulletItems(markdown: string): string[] {
  return [...markdown.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

function getAllBacktickedItems(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function getBacktickedNumberedItems(markdown: string): string[] {
  return [...markdown.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
}

function getBacktickedItemsFromBulletLines(markdown: string): string[] {
  const bulletLines = [...markdown.matchAll(/^- .*$/gm)].map((match) => match[0]);
  return bulletLines.flatMap((line) => getAllBacktickedItems(line));
}

function normalizePromptText(markdown: string): string {
  return markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return entry.isFile() && /\.(?:md|ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

function getSkillReviewDocEntries(
  markdown: string,
): Array<{ id: string; title: string; prompt: string }> {
  return [
    ...markdown.matchAll(
      /^(##|###) (.+)\r?\n\r?\nPrompt ID: `([^`]+)`\r?\n\r?\n```text\r?\n([\s\S]*?)\r?\n```/gm,
    ),
  ].map(([, , title, id, prompt]) => ({
    id,
    title,
    prompt: normalizePromptText(prompt),
  }));
}

test("runCli prints top-level help", async () => {
  const { io, logs, errors } = createIo();
  const code = await runCli(["--help"], io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs.join("\n")).toMatch(/askr - Unified CLI/);
  expect(logs.join("\n")).toMatch(/askr <command> \[args\]/);
  expect(logs.join("\n")).toMatch(/Commands:/);
  expect(logs.join("\n")).toMatch(/add/);
  expect(logs.join("\n")).toMatch(/skills/);
  expect(logs.join("\n")).toMatch(/openapi/);
});

test("package surface ships project templates for installed create commands", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files: string[] };

  expect(manifest.files).toEqual(["dist"]);

  for (const template of ["full-stack", "spa", "ssr", "ssg", "startkit"]) {
    const templateRoot = new URL(`../templates/${template}/`, import.meta.url);
    const npmIgnore = await fs.readFile(new URL(".npmignore", templateRoot), "utf8");

    expect(npmIgnore.split(/\r?\n/)).not.toContain("*");
    await expect(fs.access(new URL("gitignore.template", templateRoot))).resolves.toBeUndefined();
  }
});

test("guidance manifest stays aligned with templates and bundled skills", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../guidance-manifest.json", import.meta.url), "utf8"),
  ) as {
    version: number;
    shared: { agentFile: string; skills: string[] };
    templates: Record<string, { agentFile: string; skills: string[] }>;
  };
  expect(manifest.version).toBe(1);
  const bundled = new Set(
    (await fs.readdir(new URL("../skills/", import.meta.url), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  for (const [template, guidance] of Object.entries(manifest.templates)) {
    await expect(
      fs.access(new URL(`../templates/${template}/${guidance.agentFile}`, import.meta.url)),
    ).resolves.toBeUndefined();
    for (const skill of [...manifest.shared.skills, ...guidance.skills]) {
      expect(bundled.has(skill), `${template} references missing ${skill}`).toBe(true);
    }
  }
});

test("runCli prints version for short and long flags", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  };

  const longFlag = createIo();
  const shortFlag = createIo();

  expect(await runCli(["--version"], longFlag.io)).toBe(0);
  expect(longFlag.errors).toHaveLength(0);
  expect(longFlag.logs).toEqual([packageJson.version]);

  expect(await runCli(["-v"], shortFlag.io)).toBe(0);
  expect(shortFlag.errors).toHaveLength(0);
  expect(shortFlag.logs).toEqual([packageJson.version]);
});

test("package exports only the canonical askr command", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    bin: Record<string, string>;
  };

  expect(packageJson.bin).toEqual({ askr: "./dist/cli.js" });
});

test("public docs and templates use the clean-break scope vocabulary", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = [
    ...(await sourceFiles(path.join(root, "docs"))),
    ...(await sourceFiles(path.join(root, "templates"))),
  ];
  const obsolete = [
    "defineContext",
    "readContext",
    "ThemeProvider",
    "useTheme",
    "ToastProvider",
    "SidebarProvider",
  ];
  const violations = (
    await Promise.all(
      files.map(async (file) => {
        const source = await fs.readFile(file, "utf8");
        return obsolete
          .filter((name) => source.includes(name))
          .map((name) => `${path.relative(root, file)}: ${name}`);
      }),
    )
  ).flat();
  expect(violations).toEqual([]);
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
    expect(routesFile).toMatch(/auth:\s*requireAnonymous\(\)/);
    expect(routesFile).toMatch(/auth:\s*requireUser\(\)/);
    expect(routesFile).toMatch(/group\(\{\s*layout:\s*App\s*\}/);
    expect(routesFile).toMatch(/fallback\(/);
    expect(routerFile).toMatch(/createRouteRegistry/);
    expect(routerFile).toMatch(/export const pageRegistry/);
    expect(routerFile).toMatch(/auth:\s*routeAuth/);
    expect(sidebarFile).toMatch(/Navbar\s+orientation="vertical"/);
    expect(sidebarFile).toMatch(/NavGroup id="workspace-nav-group" label="Workspace"/);
    expect(sidebarFile).toMatch(/placement="bottom"/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 15_000);

test("runCreateCli rejects unsafe names, unknown options, and extra positional arguments", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-create-input-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(tempRoot);
    for (const args of [
      ["../escape", "--no-install"],
      ["Bad Name", "--no-install"],
      ["safe-name", "--wat", "--no-install"],
      ["spa", "safe-name", "extra", "--no-install"],
    ]) {
      expect(await runCreateCli(args, createIo().io)).toBe(1);
    }
    expect(await fs.readdir(tempRoot)).toEqual([]);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("startkit registers pages from the canonical route metadata", async () => {
  const expectedRoutes = [
    ["src/routes/public.ts", "landingRoute.href", "route('/')"],
    ["src/routes/auth.ts", "loginRoute.href", "route('/login')"],
    ["src/routes/workspace/index.ts", "dashboardRoute.href", "route('/dashboard')"],
    ["src/routes/workspace/index.ts", "settingsRoute.href", "route('/settings')"],
    ["src/routes/workspace/accounts.ts", "accountsRoute.href", "route('/accounts')"],
  ] as const;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-startkit-routes-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    expect(await runCreateCli(["startkit", "sample-app", "--no-install"], createIo().io)).toBe(0);
    const appRoot = path.join(tempRoot, "sample-app");

    for (const [relativePath, canonicalHref, rawRoute] of expectedRoutes) {
      const source = await fs.readFile(path.join(appRoot, relativePath), "utf8");
      expect(source, relativePath).toContain(canonicalHref);
      expect(source, relativePath).not.toContain(rawRoute);
    }
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli supports an explicit output directory without deriving it from the package name", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-create-dir-"));
  const target = path.join(tempRoot, "nested", "project");
  try {
    expect(
      await runCreateCli(
        ["ssr", "valid-app", "--dir", target, "--no-install", "--no-skills"],
        createIo().io,
      ),
    ).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf8")).name).toBe(
      "valid-app",
    );
    const brief = await fs.readFile(path.join(target, ".askr/builder-brief.md"), "utf8");
    expect(brief).toContain("src/entry-server.tsx");
    expect(brief).toContain("src/routes.tsx");
    expect(brief).not.toContain("server-entry");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli preserves a file that occupies the requested target", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-create-file-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(tempRoot);
    await fs.writeFile(path.join(tempRoot, "existing-app"), "keep");
    expect(await runCreateCli(["existing-app", "--no-install", "--no-skills"], createIo().io)).toBe(
      1,
    );
    expect(await fs.readFile(path.join(tempRoot, "existing-app"), "utf8")).toBe("keep");
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
    const rootLayoutFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "_layout.tsx"),
      "utf8",
    );
    const routesFile = await fs.readFile(path.join(appRoot, "src", "pages", "_routes.tsx"), "utf8");
    const publicRoutesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "public", "_routes.tsx"),
      "utf8",
    );
    const authLayoutFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "auth", "_layout.tsx"),
      "utf8",
    );
    const authRoutesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "auth", "_routes.tsx"),
      "utf8",
    );
    const authLoginFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "auth", "login.tsx"),
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
    const resetStylesFile = await fs.readFile(
      path.join(appRoot, "src", "styles", "reset.css"),
      "utf8",
    );
    const tokensStylesFile = await fs.readFile(
      path.join(appRoot, "src", "styles", "tokens.css"),
      "utf8",
    );
    const themeStylesFile = await fs.readFile(
      path.join(appRoot, "src", "styles", "theme.css"),
      "utf8",
    );
    const layoutStylesFile = await fs.readFile(
      path.join(appRoot, "src", "styles", "layout.css"),
      "utf8",
    );
    const componentsStylesFile = await fs.readFile(
      path.join(appRoot, "src", "styles", "components.css"),
      "utf8",
    );
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

    expect(rootLayoutFile).toMatch(/ThemeScope/);
    expect(rootLayoutFile).toMatch(/defaultTheme=["']tabby["']/);
    expect(appLayoutFile).toMatch(/Shell/);
    expect(appLayoutFile).toMatch(/Sidebar/);
    expect(appLayoutFile).toMatch(/ThemeToggle/);
    expect(appLayoutFile).toMatch(/appNavItems/);
    expect(packageJson).toMatch(/"@askrjs\/charts": ">=0\.1\.0 <0\.2\.0"/);
    expect(routesFile).toMatch(/registerPublicRoutes/);
    expect(routesFile).toMatch(/registerAuthRoutes/);
    expect(routesFile).toMatch(/registerAppRoutes/);
    expect(routesFile).toMatch(/fallback\(NotFoundPage\)/);
    expect(routesFile).toMatch(/group\(\{\s*layout:\s*AppLayout/);
    expect(publicRoutesFile).not.toMatch(/admin-login/);
    expect(authLayoutFile).toMatch(/auth-shell/);
    expect(authRoutesFile).toMatch(/route\(["']\/login["']/);
    expect(authLoginFile).toMatch(/Sign in/);
    expect(appRoutesFile).toMatch(/route\(["']\/app\/agents["']/);
    expect(mainFile).toMatch(/@askrjs\/askr\/boot/);
    expect(mainFile).toMatch(/registry:\s*pageRegistry/);
    expect(mainFile).not.toMatch(/getManifest/);
    expect(mainFile).not.toMatch(/import ['"]\.\/pages\/_routes['"]/);
    expect(routesFile).toMatch(/export const pageRegistry = createRouteRegistry/);
    expect(routesFile).not.toMatch(/registerRoutes/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/reset\.css["']/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/tokens\.css["']/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/theme\.css["']/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/layout\.css["']/);
    expect(stylesFile).toMatch(/@import ["']\.\/styles\/components\.css["']/);
    expect(stylesFile).toMatch(/@import ["']@askrjs\/charts\/styles["']/);
    expect(resetStylesFile).toMatch(/@layer reset/);
    expect(tokensStylesFile).toMatch(/@layer tokens/);
    expect(themeStylesFile).toMatch(/@layer theme/);
    expect(layoutStylesFile).toMatch(/@layer layout/);
    expect(componentsStylesFile).toMatch(/@layer components/);
    expect(homeFile).toMatch(/Route-first Askr SPA/);
    expect(homeFile).toMatch(/auth branch/);
    expect(homeFile).toMatch(/@askrjs\/themes\/components/);
    expect(dashboardFile).toMatch(/resource/);
    expect(dashboardFile).toMatch(/createPlot<OperationsChartRow>/);
    expect(dashboardFile).toMatch(/from ["']@askrjs\/charts["']/);
    expect(dashboardFile).not.toMatch(/@askrjs\/charts\/components/);
    expect(operationsFile).toMatch(/loadOperations/);
    expect(adapterFile).toMatch(/export type OperationsChartRow/);
    expect(adapterFile).toMatch(/AbortSignal/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli scaffolds SSG with shared route registration and current builder hints", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const { io, errors } = createIo();
    const code = await runCreateCli(["ssg", "sample-ssg", "--no-install", "--no-skills"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "sample-ssg");
    const packageJson = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
    const mainFile = await fs.readFile(path.join(appRoot, "src", "main.tsx"), "utf8");
    const routesFile = await fs.readFile(path.join(appRoot, "src", "routes.tsx"), "utf8");
    const shellFile = await fs.readFile(
      path.join(appRoot, "src", "components", "site-shell.tsx"),
      "utf8",
    );
    const ssgConfigFile = await fs.readFile(path.join(appRoot, "ssg.config.ts"), "utf8");
    const readmeFile = await fs.readFile(path.join(appRoot, "README.md"), "utf8");
    const brief = await fs.readFile(path.join(appRoot, ".askr", "builder-brief.md"), "utf8");

    expect(packageJson).toMatch(/"name": "sample-ssg"/);
    expect(packageJson).toMatch(
      /"generate": "askr ssg --config \.\/ssg\.config\.ts --output \.\/dist"/,
    );
    expect(packageJson).toMatch(/"@askrjs\/cli": ">=0\.0\.2 <0\.1\.0"/);
    expect(packageJson).toMatch(/"test": "vp test run -c \.\/vitest\.config\.ts"/);
    expect(packageJson).toMatch(/"fmt": "vp fmt \."/);
    expect(mainFile).toMatch(/registry:\s*pageRegistry/);
    expect(routesFile).toMatch(/export const pageRegistry = createRouteRegistry/);
    expect(routesFile).toMatch(/route\('\/', Home\);/);
    expect(routesFile).toMatch(/route\('\/preview', Preview\);/);
    expect(shellFile).toMatch(/@askrjs\/themes\/components/);
    expect(shellFile).toMatch(/export function SiteHeader/);
    expect(ssgConfigFile).toMatch(/registry:\s*pageRegistry/);
    expect(ssgConfigFile).toMatch(/export const staticConfig/);
    expect(ssgConfigFile).toMatch(/\.askr\/client\/assets/);
    expect(readmeFile).toMatch(/Register routes in `src\/routes\.tsx`\./);
    expect(readmeFile).toMatch(/`ssg\.config\.ts` passes the same immutable route registry/);
    expect(brief).toMatch(/## Inspect First In This Scaffold/);
    expect(brief).toMatch(/- src\/routes\.tsx/);
    expect(brief).toMatch(/- src\/components\/site-shell\.tsx/);
    expect(brief).toMatch(/- ssg\.config\.ts/);
    expect(brief).toMatch(/## Golden Examples In This Scaffold/);
    expect(brief).toMatch(/- src\/routes\.tsx/);
    expect(brief).not.toMatch(/src\/pages\/_routes\.tsx/);
    await expect(fs.access(path.join(appRoot, "ssg-build.ts"))).rejects.toThrow();
    await expect(fs.access(path.join(appRoot, "tsconfig.ssg.json"))).rejects.toThrow();
    await expect(fs.access(path.join(appRoot, "node_modules"))).rejects.toThrow();
    await expect(fs.access(path.join(appRoot, "dist"))).rejects.toThrow();
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}, 15000);

test("runCreateCli derives a prompt-aware builder blueprint and installs skills", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const promptText =
      "Build an agent workflow console with realtime approvals and analytics dashboards";
    const { io, errors } = createIo();
    const code = await runCreateCli(["--prompt", promptText, "--no-install"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "agent-workflow-console");
    const blueprint = JSON.parse(
      await fs.readFile(path.join(appRoot, ".askr", "blueprint.json"), "utf8"),
    ) as {
      appName: string;
      template: string;
      templateSelection: { mode: string };
      capabilities: string[];
      recommendedSkills: string[];
    };
    const brief = await fs.readFile(path.join(appRoot, ".askr", "builder-brief.md"), "utf8");

    await expect(
      fs.access(path.join(appRoot, "skills", "askr-app-builder", "SKILL.md")),
    ).resolves.toBeUndefined();

    expect(blueprint.appName).toBe("agent-workflow-console");
    expect(blueprint.template).toBe("spa");
    expect(blueprint.templateSelection.mode).toBe("prompt");
    expect(blueprint.capabilities).toContain("agent-workflows");
    expect(blueprint.capabilities).toContain("dashboard-charts");
    expect(blueprint.capabilities).toContain("realtime-streaming");
    expect(blueprint.recommendedSkills).toContain("askr-agent-execution");
    expect(blueprint.recommendedSkills).toContain("askr-agent-workflows");
    expect(blueprint.recommendedSkills).toContain("askr-dashboard-charts");
    expect(blueprint.recommendedSkills).toContain("askr-mental-model");
    expect(blueprint.recommendedSkills).toContain("askr-app-builder");
    expect(blueprint.recommendedSkills).not.toContain("askr-design-system");
    expect(blueprint.recommendedSkills).not.toContain("askr-ui-composition");
    expect(brief).toMatch(/Build an agent workflow console/);
    expect(brief).toMatch(/## Inspect First In This Scaffold/);
    expect(brief).toMatch(/## Skill Execution Order/);
    expect(brief).toMatch(/### Start here/);
    expect(brief).toMatch(
      /askr-agent-execution - Read the repo in the right order and validate narrowly\./,
    );
    expect(brief).toMatch(/### Pull in next when the task needs it/);
    expect(brief).toMatch(
      /askr-agent-workflows - Model runs, approvals, timelines, and audit-friendly states\./,
    );
    expect(brief).toMatch(/## Golden Examples In This Scaffold/);
    expect(brief).toMatch(/src\/pages\/_routes\.tsx/);
    expect(brief).toMatch(/Use For for keyed or dynamic list rendering/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCreateCli scaffolds a function-first full-stack project", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const { io, errors } = createIo();
    const code = await runCreateCli(
      ["full-stack", "sample-full-stack", "--no-install", "--no-skills"],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "sample-full-stack");
    const packageJson = await fs.readFile(path.join(appRoot, "package.json"), "utf8");
    const packageManifest = JSON.parse(packageJson) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const indexHtml = await fs.readFile(path.join(appRoot, "index.html"), "utf8");
    const gitignore = await fs.readFile(path.join(appRoot, ".gitignore"), "utf8");
    const actionsFile = await fs.readFile(
      path.join(appRoot, "src", "server", "action-registry.ts"),
      "utf8",
    );
    const routesFile = await fs.readFile(path.join(appRoot, "src", "routes.tsx"), "utf8");
    const homeFile = await fs.readFile(path.join(appRoot, "src", "pages", "home.tsx"), "utf8");
    const serverFile = await fs.readFile(path.join(appRoot, "src", "server", "app.ts"), "utf8");
    const brief = await fs.readFile(path.join(appRoot, ".askr", "builder-brief.md"), "utf8");

    expect(packageJson).toMatch(/"@askrjs\/schema"/);
    expect(packageJson).toMatch(/"@askrjs\/i18n"/);
    expect(packageJson).toMatch(/"@askrjs\/otel"/);
    expect(packageManifest.dependencies["@askrjs/askr"]).toBe(">=0.0.53 <0.1.0");
    expect(packageManifest.dependencies["@askrjs/themes"]).toBe(">=0.0.12 <0.1.0");
    expect(packageManifest.dependencies["@askrjs/ui"]).toBe(">=0.0.13 <0.1.0");
    expect(packageManifest.devDependencies["@askrjs/vite"]).toBe(">=0.0.6 <0.1.0");
    expect(indexHtml.match(/<!--askr-app-->/g)).toHaveLength(1);
    expect(indexHtml.match(/<!--askr-head-->/g)).toHaveLength(1);
    expect(gitignore).toContain("node_modules");
    expect(actionsFile).toMatch(/handleAction\(createMessageAction, createMessage\)/);
    expect(actionsFile).toMatch(/export function createActionHandlers/);
    expect(routesFile).toMatch(/actionsFor\(["']\/["']\)/);
    expect(homeFile).toMatch(/ActionForm\(\{/);
    expect(homeFile).toMatch(/htmlFor="message"/);
    expect(homeFile).toMatch(/<input id="message" name="value" required \/>/);
    expect(serverFile).toMatch(/createAskrApp/);
    expect(serverFile).not.toMatch(/createServerApp|createAskrPageHandler/);
    expect(serverFile).toMatch(/schema: MessageInput/);
    expect(serverFile).toMatch(/mediaTypes: \[["']application\/json["']\]/);
    expect(serverFile).toMatch(/csrf/);
    expect(serverFile).toMatch(/rateLimit/);
    expect(serverFile).toMatch(/Production requires a strong CSRF_SECRET/);
    expect(serverFile).not.toMatch(/CSRF_SECRET \?\? "development-only-secret"/);
    expect(serverFile).toMatch(/if \(development\)/);
    expect(brief).toMatch(/src\/server\/action-registry\.ts/);
    expect(brief).toMatch(/src\/schemas\.ts/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("template package floors require the clean-break scope vocabulary", async () => {
  for (const template of ["full-stack", "spa", "ssr", "ssg", "startkit"]) {
    const manifest = JSON.parse(
      await fs.readFile(new URL(`../templates/${template}/package.json`, import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(manifest.dependencies["@askrjs/askr"], template).toBe(">=0.0.53 <0.1.0");
    if (manifest.dependencies["@askrjs/themes"]) {
      expect(manifest.dependencies["@askrjs/themes"], template).toBe(">=0.0.12 <0.1.0");
    }
    if (manifest.dependencies["@askrjs/ui"]) {
      expect(manifest.dependencies["@askrjs/ui"], template).toBe(">=0.0.13 <0.1.0");
    }
    if (manifest.dependencies["@askrjs/auth"]) {
      expect(manifest.dependencies["@askrjs/auth"], template).toBe(">=0.0.1 <0.1.0");
    }
  }
});

test("runCreateCli can skip bundled skills installation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const { io, errors } = createIo();
    const code = await runCreateCli(["sample-app", "--no-install", "--no-skills"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const appRoot = path.join(tempRoot, "sample-app");
    const blueprint = JSON.parse(
      await fs.readFile(path.join(appRoot, ".askr", "blueprint.json"), "utf8"),
    ) as {
      recommendedSkills: string[];
      appName: string;
      template: string;
    };

    await expect(fs.access(path.join(appRoot, "skills"))).rejects.toThrow();
    expect(blueprint.recommendedSkills).toContain("askr-agent-execution");
    expect(blueprint.appName).toBe("sample-app");
    expect(blueprint.template).toBe("startkit");
    expect(blueprint.recommendedSkills).not.toContain("askr-app-builder");
    expect(blueprint.recommendedSkills).toContain("askr-mental-model");
    expect(blueprint.recommendedSkills).toContain("askr-theming");
    expect(blueprint.recommendedSkills).not.toContain("askr-design-system");
    expect(blueprint.recommendedSkills).not.toContain("askr-ui-composition");
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runAddCli scaffolds a page and registers the app route", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-add-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const createCode = await runCreateCli(["spa", "sample-spa", "--no-install"], createIo().io);
    expect(createCode).toBe(0);

    const appRoot = path.join(tempRoot, "sample-spa");
    const { io, errors } = createIo();
    const code = await runAddCli(["page", "audit-log", "--cwd", appRoot], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const pageFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "app", "audit-log.tsx"),
      "utf8",
    );
    const routesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "app", "_routes.tsx"),
      "utf8",
    );

    expect(pageFile).toMatch(/export default function AuditLogPage/);
    expect(pageFile).toMatch(/<h1>Audit Log<\/h1>/);
    expect(pageFile).toMatch(/resource\(\), derive\(\), and For/);
    expect(routesFile).toMatch(/import AuditLogPage from '\.\/audit-log';/);
    expect(routesFile).toMatch(/route\('\/app\/audit-log', AuditLogPage\);/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runAddCli rolls back page registration given a replacement failure", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-add-rollback-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(tempRoot);
    expect(
      await runCreateCli(["spa", "sample-spa", "--no-install", "--no-skills"], createIo().io),
    ).toBe(0);
    const appRoot = path.join(tempRoot, "sample-spa");
    const routes = path.join(appRoot, "src/pages/app/_routes.tsx");
    const original = await fs.readFile(routes, "utf8");
    let replacements = 0;
    const code = await runAddCli(
      ["page", "atomic-page", "--cwd", appRoot],
      createIo().io,
      (changes) =>
        writeFileChanges(changes, {
          async replace(temporary, target) {
            replacements += 1;
            if (replacements === 2) throw new Error("injected replacement failure");
            await fs.rename(temporary, target);
          },
        }),
    );
    expect(code).toBe(1);
    expect(await fs.readFile(routes, "utf8")).toBe(original);
    await expect(
      fs.access(path.join(appRoot, "src/pages/app/atomic-page.tsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runCli routes add page through the top-level command", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-add-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const createCode = await runCreateCli(["spa", "sample-spa", "--no-install"], createIo().io);
    expect(createCode).toBe(0);

    const appRoot = path.join(tempRoot, "sample-spa");
    const { io, errors } = createIo();
    const code = await runCli(
      [
        "add",
        "page",
        "ops/review-queue",
        "--branch",
        "public",
        "--cwd",
        appRoot,
        "--title",
        "Review Queue",
      ],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const pageFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "public", "ops", "review-queue.tsx"),
      "utf8",
    );
    const routesFile = await fs.readFile(
      path.join(appRoot, "src", "pages", "public", "_routes.tsx"),
      "utf8",
    );

    expect(pageFile).toMatch(/export default function OpsReviewQueuePage/);
    expect(pageFile).toMatch(/<h1>Review Queue<\/h1>/);
    expect(routesFile).toMatch(/import OpsReviewQueuePage from '\.\/ops\/review-queue';/);
    expect(routesFile).toMatch(/route\('\/ops\/review-queue', OpsReviewQueuePage\);/);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runAddCli generates a browser-safe action and server registration", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-add-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempRoot);
    const createCode = await runCreateCli(
      ["full-stack", "sample-full-stack", "--no-install", "--no-skills"],
      createIo().io,
    );
    expect(createCode).toBe(0);

    const appRoot = path.join(tempRoot, "sample-full-stack");
    const { io, errors } = createIo();
    const code = await runAddCli(
      ["action", "archive-project", "--route", "/", "--cwd", appRoot],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const descriptorFile = await fs.readFile(
      path.join(appRoot, "src", "actions", "archive-project.ts"),
      "utf8",
    );
    const handlerFile = await fs.readFile(
      path.join(appRoot, "src", "server", "actions", "archive-project.ts"),
      "utf8",
    );
    const registryFile = await fs.readFile(
      path.join(appRoot, "src", "server", "action-registry.ts"),
      "utf8",
    );
    const authorizationFile = await fs.readFile(
      path.join(appRoot, "src", "action-authorizations.ts"),
      "utf8",
    );
    const testFile = await fs.readFile(
      path.join(appRoot, "tests", "actions", "archive-project.test.ts"),
      "utf8",
    );

    expect(descriptorFile).toMatch(/defineAction/);
    expect(descriptorFile).not.toMatch(/@askrjs\/server/);
    expect(handlerFile).toMatch(/export async function archiveProject/);
    expect(registryFile).toMatch(/handleAction\(archiveProjectAction, archiveProject\)/);
    expect(authorizationFile).toMatch(/"\/": \[[^\]]*archiveProjectAction[^\]]*\]/);
    expect(testFile).toMatch(/archiveProjectAction/);

    const forceCode = await runAddCli(
      ["action", "archive-project", "--route", "/", "--cwd", appRoot, "--force"],
      io,
    );
    expect(forceCode).toBe(0);
    expect(
      await fs.readFile(path.join(appRoot, "src", "server", "action-registry.ts"), "utf8"),
    ).toBe(registryFile);
    expect(await fs.readFile(path.join(appRoot, "src", "action-authorizations.ts"), "utf8")).toBe(
      authorizationFile,
    );
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

test("runSsgCli rejects unknown, missing, and invalid option values", async () => {
  for (const args of [["--config"], ["--unknown"], ["--workers", "garbage"], ["--workers", "0"]]) {
    const { io, errors } = createIo();
    expect(await runSsgCli(args, undefined, io)).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  }
});

test("runSsgCli rejects raw route arrays", async () => {
  const { io, errors } = createIo();
  const code = await runSsgCli(
    ["--config", "ssg.config.ts", "--output", "dist"],
    {
      cwd: () => "/workspace",
      existsSync: () => true,
      importConfig: async () => ({
        routes: [{ path: "/" }],
        siteUrl: "https://example.com",
        sitemap: false,
      }),
    },
    io,
  );

  expect(code).toBe(1);
  expect(errors).toContain("Error: Config must provide a route registry and no raw routes array");
});

test("runSsgCli preserves live output when sitemap metadata fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-ssg-atomic-"));
  const output = path.join(root, "dist");
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "original.txt"), "original");
  try {
    const code = await runSsgCli(
      ["--config", "ssg.config.ts", "--output", "dist", "--incremental"],
      {
        cwd: () => root,
        existsSync: () => true,
        importConfig: async () => ({
          registry: { records: [] },
          siteUrl: "https://example.com",
          sitemap: { resolve: () => Promise.reject(new Error("metadata failed")) },
        }),
        createStaticGen: ({ outputDir }) => ({
          async generate() {
            await fs.writeFile(path.join(outputDir, "new.txt"), "new");
            return {
              mode: "incremental",
              successful: 1,
              totalRoutes: 1,
              failed: 0,
              rebuilt: 1,
              skipped: 0,
              removed: 0,
              cacheHits: 0,
              routes: [{ path: "/", filePath: "index.html", status: "success" }],
            };
          },
        }),
      },
      createIo().io,
    );
    expect(code).toBe(1);
    expect(await fs.readFile(path.join(output, "original.txt"), "utf8")).toBe("original");
    await expect(fs.access(path.join(output, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runSsgCli preserves a file that occupies the output path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-ssg-file-"));
  await fs.writeFile(path.join(root, "dist"), "keep");
  try {
    expect(
      await runSsgCli(
        ["--config", "ssg.config.ts", "--output", "dist"],
        { cwd: () => root, existsSync: () => true },
        createIo().io,
      ),
    ).toBe(1);
    expect(await fs.readFile(path.join(root, "dist"), "utf8")).toBe("keep");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runSsgCli requires a canonical site URL unless sitemap generation is disabled", async () => {
  const generate = async () => {
    throw new Error("generation should not start");
  };
  const { io, errors } = createIo();

  const code = await runSsgCli(
    ["--config", "ssg.config.ts", "--output", "dist"],
    {
      cwd: () => "/workspace",
      existsSync: () => true,
      importConfig: async () => ({ registry: { records: [] } }),
      createStaticGen: () => ({ generate }),
    },
    io,
  );

  expect(code).toBe(1);
  expect(errors).toContain(
    "Error: Config must provide siteUrl to generate sitemap.xml, or set sitemap: false",
  );
});

test("runSsgCli loads TypeScript configs without an external loader", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-ssg-"));
  const configPath = path.join(tempRoot, "ssg.config.ts");
  await fs.writeFile(
    configPath,
    'export const registry = { records: [] }; export const siteUrl = "https://example.com";\n',
    "utf8",
  );
  const generate = async () => ({
    mode: "full",
    successful: 1,
    totalRoutes: 1,
    failed: 0,
    rebuilt: 1,
    skipped: 0,
    removed: 0,
    cacheHits: 0,
    routes: [{ path: "/", filePath: "index.html", status: "success" }],
  });
  const createStaticGen = () => ({ generate });
  const { io, errors } = createIo();

  try {
    const code = await runSsgCli(
      ["--config", configPath, "--output", path.join(tempRoot, "dist")],
      { createStaticGen },
      io,
    );
    expect(errors).toHaveLength(0);
    expect(code).toBe(0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("askr ssg executes TSX route modules with the project JSX runtime", async () => {
  const tempRoot = await fs.mkdtemp(path.join(process.cwd(), ".tmp-askr-cli-ssg-"));
  const configPath = path.join(tempRoot, "ssg.config.ts");
  const outputDir = path.join(tempRoot, "dist");

  try {
    await fs.writeFile(
      path.join(tempRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "@askrjs/askr",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "page.tsx"),
      "export function Page() { return <main>Ready</main>; }\n",
      "utf8",
    );
    await fs.writeFile(
      configPath,
      'import { createRouteRegistry, route } from "@askrjs/askr/router"; import { Page } from "./page.tsx"; export const siteUrl = "https://example.com"; export const registry = createRouteRegistry(() => route("/", Page));\n',
      "utf8",
    );

    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(process.cwd(), "src", "bin", "ssg.ts"),
        "--config",
        configPath,
        "--output",
        outputDir,
      ],
      { cwd: tempRoot },
    );

    await expect(fs.readFile(path.join(outputDir, "index.html"), "utf8")).resolves.toContain(
      "<main>Ready</main>",
    );
    await expect(fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8")).resolves.toContain(
      "<loc>https://example.com/</loc>",
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSsgCli forwards complete registry-based static config", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-ssg-options-"));
  const registry = { records: [] };
  const document = () => "<!doctype html>";
  const assets = [{ from: ".askr/client/assets", to: "assets" }];
  const generate = async () => ({
    mode: "full",
    successful: 1,
    totalRoutes: 1,
    failed: 0,
    rebuilt: 1,
    skipped: 0,
    removed: 0,
    cacheHits: 0,
    routes: [{ path: "/", filePath: "index.html", status: "success" }],
  });
  let received: Record<string, unknown> | undefined;
  const { io, errors } = createIo();

  try {
    const code = await runSsgCli(
      ["--config", "ssg.config.ts", "--output", "dist"],
      {
        cwd: () => tempRoot,
        existsSync: () => true,
        importConfig: async () => ({
          staticConfig: { registry, document, assets, seed: 42, concurrency: 2, sitemap: false },
        }),
        createStaticGen: (options) => {
          received = options;
          return { generate };
        },
      },
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(received).toMatchObject({
      registry,
      document,
      assets,
      seed: 42,
      concurrency: 2,
      parallelism: 1,
    });
    expect(path.dirname(String(received?.outputDir))).toBe(tempRoot);
    expect(path.basename(String(received?.outputDir))).toMatch(/^\.dist\.askr-ssg-/);
    expect(received).not.toHaveProperty("routes");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSsgCli preserves the previous full output when sitemap generation fails", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-sitemap-atomic-"));
  const outputDir = path.join(tempRoot, "dist");
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, "index.html"), "previous", "utf8");
  const { io, errors } = createIo();

  try {
    const code = await runSsgCli(
      ["--config", "ssg.config.ts", "--output", outputDir],
      {
        cwd: () => tempRoot,
        existsSync: () => true,
        importConfig: async () => ({
          registry: { records: [] },
          siteUrl: "https://example.com",
          sitemap: {
            resolve: () => {
              throw new Error("metadata unavailable");
            },
          },
        }),
        createStaticGen: (options) => ({
          generate: async () => {
            await fs.mkdir(options.outputDir, { recursive: true });
            await fs.writeFile(path.join(options.outputDir, "index.html"), "next", "utf8");
            return {
              mode: "full",
              successful: 1,
              totalRoutes: 1,
              failed: 0,
              rebuilt: 1,
              skipped: 0,
              removed: 0,
              cacheHits: 0,
              routes: [{ path: "/", filePath: "index.html", status: "success" }],
            };
          },
        }),
      },
      io,
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("metadata unavailable");
    await expect(fs.readFile(path.join(outputDir, "index.html"), "utf8")).resolves.toBe("previous");
    await expect(fs.access(path.join(outputDir, "sitemap.xml"))).rejects.toThrow();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli lists bundled skills", async () => {
  const { io, logs, errors } = createIo();
  const code = await runSkillsCli(["list"], io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs).toContain("askr-agent-execution");
  expect(logs).toContain("askr-app-builder");
  expect(logs).toContain("askr-agent-workflows");
  expect(logs).toContain("askr-api-integration");
  expect(logs).toContain("askr-error-loading-empty");
  expect(logs).toContain("askr-mental-model");
  expect(logs).toContain("askr-realtime-streaming");
  expect(logs).toContain("askr-routing-layouts");
  expect(logs).toContain("askr-testing-determinism");
});

test("runSkillsCli rejects missing cwd and unknown options before synchronization", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-input-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(tempRoot);
    await fs.mkdir(path.join(tempRoot, "skills", "askr-obsolete"), { recursive: true });
    expect(await runSkillsCli(["sync", "--cwd"], createIo().io)).toBe(1);
    expect(await runSkillsCli(["list", "--definitely-invalid"], createIo().io)).toBe(1);
    await fs.access(path.join(tempRoot, "skills", "askr-obsolete"));
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli bounds review input size", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-size-"));
  try {
    await fs.writeFile(path.join(tempRoot, "oversized.ts"), "x".repeat(2 * 1024 * 1024 + 1));
    const { io, errors } = createIo();
    expect(await runSkillsCli(["review", "foundation", "--cwd", tempRoot], io)).toBe(1);
    expect(errors.join("\n")).toMatch(/exceeds .* bytes/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli preserves a file that occupies the skills target", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-file-"));
  try {
    await fs.writeFile(path.join(tempRoot, "skills"), "keep");
    expect(await runSkillsCli(["sync", "--cwd", tempRoot], createIo().io)).toBe(1);
    expect(await fs.readFile(path.join(tempRoot, "skills"), "utf8")).toBe("keep");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli lists skill review prompts", async () => {
  const { io, logs, errors } = createIo();
  const code = await runSkillsCli(["review", "list"], io);

  expect(code).toBe(0);
  expect(errors).toHaveLength(0);
  expect(logs.join("\n")).toMatch(/foundation\s+Foundation/);
  expect(logs.join("\n")).toMatch(/reject-react-query/);
  expect(logs.join("\n")).toMatch(/reject-custom-accessibility-primitives/);
});

test("skill review prompts only reference bundled skills", async () => {
  const prompts = listSkillReviewPrompts();
  const bundledSkillEntries = await fs.readdir(new URL("../skills/", import.meta.url), {
    withFileTypes: true,
  });
  const bundledSkillNames = new Set(
    bundledSkillEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  for (const prompt of prompts) {
    for (const skill of prompt.relatedSkills) {
      expect(bundledSkillNames.has(skill), `${prompt.id} references missing skill ${skill}`).toBe(
        true,
      );
    }
  }
});

test("skills docs stay aligned with bundled skill folders", async () => {
  const skillsDoc = await fs.readFile(new URL("../docs/skills.md", import.meta.url), "utf8");
  const documentedSkills = [
    ...getBacktickedBulletItems(getMarkdownSection(skillsDoc, "Foundation sequence")),
    ...getBacktickedBulletItems(getMarkdownSection(skillsDoc, "Core workflows")),
    ...getBacktickedBulletItems(getMarkdownSection(skillsDoc, "Domain add-ons")),
  ].sort();
  const bundledSkillEntries = await fs.readdir(new URL("../skills/", import.meta.url), {
    withFileTypes: true,
  });
  const bundledSkillNames = bundledSkillEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  expect(new Set(documentedSkills).size).toBe(documentedSkills.length);
  expect(documentedSkills).toEqual(bundledSkillNames);
});

test("workflow docs stay aligned with the layered skill system", async () => {
  const workflowsDoc = await fs.readFile(new URL("../docs/workflows.md", import.meta.url), "utf8");
  const skillsDoc = await fs.readFile(new URL("../docs/skills.md", import.meta.url), "utf8");
  const bundledSkillEntries = await fs.readdir(new URL("../skills/", import.meta.url), {
    withFileTypes: true,
  });
  const bundledSkillNames = new Set(
    bundledSkillEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  const foundationSequence = getBacktickedBulletItems(
    getMarkdownSection(skillsDoc, "Foundation sequence"),
  );
  const workflowDefaults = getBacktickedNumberedItems(
    getMarkdownLevel2Section(workflowsDoc, "Agent workflow defaults"),
  );
  const commonTaskFlows = getMarkdownLevel2Section(workflowsDoc, "Common task flows");
  const flowSections = [
    ...`${commonTaskFlows}\n### __END__\n`.matchAll(/^### (.+)\r?\n([\s\S]*?)(?=^### )/gm),
  ].filter(([, title]) => title !== "__END__");

  expect(workflowDefaults).toEqual(foundationSequence);
  expect(flowSections.length).toBeGreaterThan(0);

  for (const [, title, body] of flowSections) {
    const skills = getBacktickedItemsFromBulletLines(body);

    expect(skills.length, `${title} should list at least one skill`).toBeGreaterThan(0);
    expect(skills[0], `${title} should start with askr-agent-execution`).toBe(
      "askr-agent-execution",
    );
    expect(skills.at(-1), `${title} should end with askr-testing-determinism`).toBe(
      "askr-testing-determinism",
    );

    for (const skill of skills) {
      expect(bundledSkillNames.has(skill), `${title} references unknown skill ${skill}`).toBe(true);
    }
  }
});

test("skill review prompt docs stay aligned with the prompt registry", async () => {
  const prompts = listSkillReviewPrompts();
  const promptDoc = await fs.readFile(
    new URL("../docs/skill-review-prompts.md", import.meta.url),
    "utf8",
  );
  const documentedPrompts = getSkillReviewDocEntries(promptDoc).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const registryPrompts = prompts
    .map(({ id, prompt, title }) => ({ id, prompt: normalizePromptText(prompt), title }))
    .sort((left, right) => left.id.localeCompare(right.id));

  expect(new Set(documentedPrompts.map((entry) => entry.id)).size).toBe(documentedPrompts.length);
  expect(documentedPrompts).toEqual(registryPrompts);
});

test("runSkillsCli reviews a generated candidate with JSON output", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "jobs.tsx"),
      [
        "import { For, state } from '@askrjs/askr';",
        "",
        "export default function JobsPage() {",
        "  const [filter, setFilter] = state('queued');",
        "  const jobs = [",
        "    { id: 'a', status: 'queued' },",
        "    { id: 'b', status: 'running' },",
        "  ];",
        "",
        "  return (",
        "    <section>",
        "      <button onPress={() => setFilter('running')}>{filter()}</button>",
        "      <For each={jobs}>{(job) => <div>{job.status}</div>}</For>",
        "    </section>",
        "  );",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "foundation", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      filesScanned: number;
      passedChecks: number;
      repairFocus: string;
      relatedSkills: string[];
      totalChecks: number;
    };
    expect(result.promptId).toBe("foundation");
    expect(result.status).toBe("pass");
    expect(result.filesScanned).toBe(1);
    expect(result.relatedSkills).toContain("askr-mental-model");
    expect(result.repairFocus).toMatch(/state\(\), derive\(\), selector\(\), and For/);
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes routing-layouts review for an idiomatic route tree", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages", "app"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "app", "_routes.tsx"),
      [
        "import { requirePermission, requireUser } from '@askrjs/auth';",
        "import { fallback, group, index, page, route } from '@askrjs/askr/router';",
        "",
        "import SettingsLayout from './_layout';",
        "import SettingsIndexPage from './settings-index';",
        "import WorkspaceSettingsPage from './settings';",
        "import NotFoundPage from '../not-found';",
        "",
        "export function registerWorkspaceSettingsRoutes() {",
        "  group({ auth: requireUser() }, () => {",
        "    page('/app/workspaces/{workspaceId}', SettingsLayout, () => {",
        "      index(SettingsIndexPage);",
        "      route('settings', WorkspaceSettingsPage, {",
        "        auth: requirePermission('workspace.settings.manage'),",
        "      });",
        "      fallback(NotFoundPage);",
        "    });",
        "  });",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "routing-layouts", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("routing-layouts");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-routing-layouts");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes auth-authorization review for route-owned access policy", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages", "app", "billing"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "app", "billing", "admin.tsx"),
      [
        "import { requirePermission } from '@askrjs/auth';",
        "import { route } from '@askrjs/askr/router';",
        "",
        "export const billingAdminRoute = route('/app/billing/admin', BillingAdminPage, {",
        "  auth: requirePermission('billing.manage'),",
        "});",
        "",
        "export default function BillingAdminPage() {",
        "  return <section>Billing admin</section>;",
        "}",
        "",
        "export function BillingAdminForbiddenPage() {",
        '  return <p role="alert">Access denied</p>;',
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "auth-authorization", "--cwd", tempRoot, "--json"],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("auth-authorization");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-auth-access");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes shared-data-consistency review for truthful query ownership", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "features", "accounts"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "features", "accounts", "accounts.query.ts"),
      [
        "import { createMutation, createQuery } from '@askrjs/askr/query';",
        "",
        "export const accountsQuery = createQuery({",
        "  key: ['accounts'],",
        "  load: async () => ({ items: [], status: 'stale' }),",
        "});",
        "",
        "export const updateAccountMutation = createMutation({",
        "  execute: async () => ({ state: 'pending-write', detail: 'syncing projection' }),",
        "});",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "shared-data-consistency", "--cwd", tempRoot, "--json"],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("shared-data-consistency");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-query-mutation");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes crud-forms review for explicit form and error state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "features", "accounts"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "features", "accounts", "account-form.tsx"),
      [
        "import { state } from '@askrjs/askr';",
        "",
        "export default function AccountForm() {",
        "  const [name, setName] = state('');",
        "  const pending = false;",
        "  const validation = name().trim() ? null : 'Name is required';",
        "",
        "  return (",
        "    <form>",
        "      <input value={name()} onInput={(event) => setName(event.currentTarget.value)} />",
        '      {validation ? <p role="alert">validation error: {validation}</p> : null}',
        "      <button disabled={pending}>Save</button>",
        "    </form>",
        "  );",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "crud-forms", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("crud-forms");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-forms-tables-crud");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes realtime review for bounded reconnecting streams", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "features", "timeline"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "features", "timeline", "operator-stream.ts"),
      [
        "const MAX_EVENTS = 200;",
        "",
        "type TimelineEvent = { eventId: string; cursor: string };",
        "",
        "export function reconcileEvents(events: TimelineEvent[], incoming: TimelineEvent[], retry = false) {",
        "  const reconnect = retry ? 'reconnect' : 'live';",
        "  const merged = [...events, ...incoming].slice(-MAX_EVENTS);",
        "  return { reconnect, merged, lastEventId: merged.at(-1)?.eventId ?? null };",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "realtime", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("realtime");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-realtime-streaming");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes agent-workflow-ui review for lifecycle-driven run screens", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages", "app"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "app", "agent-run.tsx"),
      [
        "export default function AgentRunPage() {",
        "  const runStates = ['draft', 'queued', 'running', 'requires-action', 'failed', 'succeeded'];",
        "  const approval = { status: 'requires-action' };",
        "  const timeline = [{ event: 'queued' }, { event: 'running' }, { event: 'failed' }];",
        "",
        "  return (",
        "    <section>",
        "      <h1>Agent approval timeline</h1>",
        "      <p>{approval.status}</p>",
        "      <ul>{timeline.map((item) => <li key={item.event}>{item.event}</li>)}</ul>",
        "      <p>{runStates.join(', ')}</p>",
        "    </section>",
        "  );",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "agent-workflow-ui", "--cwd", tempRoot, "--json"],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("agent-workflow-ui");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-agent-workflows");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes theming-ui review for token-based theme primitives", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages", "app"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "app", "settings-panel.tsx"),
      [
        "import { Button } from '@askrjs/ui';",
        "import { Surface } from '@askrjs/themes';",
        "",
        "export default function SettingsPanel() {",
        "  return (",
        "    <Surface data-slot=\"settings-panel\" style={{ background: 'var(--surface-elevated)' }}>",
        "      <h1>Theme settings</h1>",
        "      <p>Preserve dark mode across this panel.</p>",
        "      <Button>Save theme</Button>",
        "    </Surface>",
        "  );",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "theming-ui", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("theming-ui");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-theming");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli passes ssr-ssg review for environment-safe static routes", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "pages", "docs"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "pages", "docs", "_routes.tsx"),
      [
        "import { route } from '@askrjs/askr/router';",
        "",
        "export const docsManifest = { type: 'static manifest' };",
        "export const docsRoutes = [route('/docs/:slug', () => null)];",
        "export const renderMode = 'SSG';",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "ssr-ssg", "--cwd", tempRoot, "--json"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);

    const result = JSON.parse(logs.join("\n")) as {
      promptId: string;
      status: string;
      relatedSkills: string[];
      passedChecks: number;
      totalChecks: number;
    };
    expect(result.promptId).toBe("ssr-ssg");
    expect(result.status).toBe("pass");
    expect(result.relatedSkills).toContain("askr-ssr-ssg");
    expect(result.passedChecks).toBe(result.totalChecks);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("ssr-ssg skill teaches registry-only route setup", async () => {
  const skill = await fs.readFile(
    new URL("../skills/askr-ssr-ssg/SKILL.md", import.meta.url),
    "utf8",
  );

  expect(skill).toMatch(/createRouteRegistry/);
  expect(skill).not.toMatch(/registerRoutes/);
});

test("runSkillsCli fails a negative review when React defaults appear", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "bad.tsx"),
      [
        "import React, { useEffect, useState } from 'react';",
        "import { useQuery } from '@tanstack/react-query';",
        "",
        "export default function BadPage() {",
        "  const [count, setCount] = useState(0);",
        "  useEffect(() => setCount((value) => value + 1), []);",
        "  useQuery({ queryKey: ['bad'], queryFn: async () => [] });",
        "  return <div>{count}</div>;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "reject-react-query", "--cwd", tempRoot], io);

    expect(code).toBe(1);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Repair focus:/);
    expect(logs.join("\n")).toMatch(/FAIL Does not import React hooks or React itself/);
    expect(logs.join("\n")).toMatch(/FAIL Does not import TanStack Query/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli fails a negative review when app-local primitive clones appear", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "primitives.tsx"),
      [
        "import { Surface } from '@askrjs/themes';",
        "",
        "export function Button() {",
        "  return <button>Save</button>;",
        "}",
        "",
        "export function Card() {",
        "  return <Surface>Card</Surface>;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "reject-custom-primitives", "--cwd", tempRoot], io);

    expect(code).toBe(1);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(
      /FAIL Does not define local Button, Card, or Sidebar primitives by default/,
    );
    expect(logs.join("\n")).toMatch(/PASS Uses askr-ui or askr-themes imports instead/);
    expect(logs.join("\n")).toMatch(/Repair focus:/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli flags custom accessibility primitives with package guidance", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "dialog.tsx"),
      [
        "export function Dialog() {",
        '  return <div role="dialog" aria-modal="true">Dialog</div>;',
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "reject-custom-accessibility-primitives", "--cwd", tempRoot],
      io,
    );

    expect(code).toBe(1);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/FAIL Does not hand-roll dialog primitives/);
    expect(logs.join("\n")).toMatch(/missing: askr-ui, askr-themes/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli supports inline accessibility review suppression", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "dialog.tsx"),
      [
        "// askr-review-ignore reject-custom-accessibility-primitives",
        "export function Dialog() {",
        '  return <div role="dialog">Intentional custom dialog</div>;',
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "reject-custom-accessibility-primitives", "--cwd", tempRoot],
      io,
    );

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli fails a negative review when one spinner models all async states", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "loading.tsx"),
      [
        "export default function LoadingState({ isLoading }: { isLoading: boolean }) {",
        "  return isLoading ? <div>Loading...</div> : <div>Ready</div>;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["review", "reject-single-spinner", "--cwd", tempRoot], io);

    expect(code).toBe(1);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/FAIL Distinguishes truthful async states/);
    expect(logs.join("\n")).toMatch(/FAIL Does not only model async state as isLoading/);
    expect(logs.join("\n")).toMatch(/Repair focus:/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli fails a negative review when parallel architecture drift appears", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-review-"));

  try {
    await fs.mkdir(path.join(tempRoot, "src", "stores"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "src", "stores", "app-store.ts"),
      [
        "export const serviceLocator = new Map();",
        "export function createStore() {",
        "  return {};",
        "}",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "src", "router.tsx"),
      [
        "import { registerRoutes } from '@askrjs/askr/router';",
        "",
        "export const routes = [];",
        "",
        "export function AppRouter() {",
        "  registerRoutes(() => {});",
        "  return null;",
        "}",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "src", "button.tsx"),
      [
        "import { state } from '@askrjs/askr';",
        "",
        "export function Button() {",
        "  const [open] = state(false);",
        "  return <button aria-pressed={open()}>Open</button>;",
        "}",
      ].join("\n"),
      "utf8",
    );

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(
      ["review", "reject-parallel-architecture", "--cwd", tempRoot],
      io,
    );

    expect(code).toBe(1);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/FAIL Does not add a custom router or router provider layer/);
    expect(logs.join("\n")).toMatch(
      /FAIL Does not add a duplicate global store or service locator layer/,
    );
    expect(logs.join("\n")).toMatch(
      /FAIL Does not create app-local Button, Card, or Sidebar systems/,
    );
    expect(logs.join("\n")).toMatch(/PASS Keeps Askr-native route or state primitives in use/);
    expect(logs.join("\n")).toMatch(/Repair focus:/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli installs bundled skills into project skills", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-"));

  try {
    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["install", "--cwd", tempRoot], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Installed 26 Askr skills/);

    const skillFile = await fs.readFile(
      path.join(tempRoot, "skills", "askr-app-builder", "SKILL.md"),
      "utf8",
    );
    const metadataFile = await fs.readFile(
      path.join(tempRoot, "skills", "askr-app-builder", "agents", "openai.yaml"),
      "utf8",
    );

    expect(skillFile).toMatch(/name: askr-app-builder/);
    expect(metadataFile).toMatch(/display_name: "Askr App Builder"/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSkillsCli refuses install into non-empty skills without force", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-skills-"));

  try {
    await fs.mkdir(path.join(tempRoot, "skills"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "skills", "note.md"), "keep me", "utf8");

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
    const skillsRoot = path.join(tempRoot, "skills");
    await fs.mkdir(path.join(skillsRoot, "custom-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, "custom-skill", "SKILL.md"), "custom", "utf8");
    await fs.mkdir(path.join(skillsRoot, "askr-old-skill"), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, "askr-old-skill", "SKILL.md"), "old", "utf8");
    await fs.writeFile(path.join(skillsRoot, "askr-routing.md"), "old flat skill", "utf8");

    const { io, logs, errors } = createIo();
    const code = await runSkillsCli(["sync", "--cwd", tempRoot], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/Synced 26 Askr skills/);

    await expect(
      fs.access(path.join(skillsRoot, "custom-skill", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(skillsRoot, "askr-old-skill"))).rejects.toThrow();
    await expect(fs.access(path.join(skillsRoot, "askr-routing.md"))).rejects.toThrow();
    await expect(
      fs.access(path.join(skillsRoot, "askr-app-builder", "SKILL.md")),
    ).resolves.toBeUndefined();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
