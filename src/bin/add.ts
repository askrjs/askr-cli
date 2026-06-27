#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

const BRANCH_CONFIG = {
  app: {
    badge: "app route",
    pagesDir: ["src", "pages", "app"],
    routesFile: ["src", "pages", "app", "_routes.tsx"],
  },
  public: {
    badge: "public route",
    pagesDir: ["src", "pages", "public"],
    routesFile: ["src", "pages", "public", "_routes.tsx"],
  },
} as const;

type BranchName = keyof typeof BRANCH_CONFIG;

interface ParsedArgs {
  branch: string;
  cwd: string;
  force: boolean;
  help: boolean;
  routePath: string;
  title: string;
  errors: string[];
  command: string;
  name: string;
}

function helpText(): string {
  return [
    "askr add - Generate code into an existing Askr project",
    "",
    "Usage:",
    "  askr add page <name> [--branch app|public] [--cwd <dir>] [--title <title>] [--route <path>] [--force]",
    "",
    "Commands:",
    "  page      Scaffold a route page and register it in a route-first SPA branch",
    "",
    "Options:",
    "  --branch <name>  Route branch to target (default: app)",
    "  --cwd <dir>      Project directory (default: current directory)",
    "  --title <text>   Override the generated page title",
    "  --route <path>   Override the generated route path",
    "  --force          Overwrite an existing page file",
    "  --help           Show this help message",
    "",
    "Examples:",
    "  askr add page audit-log",
    "  askr add page ops/audit-log --branch public",
    '  askr add page approvals --title "Human approvals" --route /app/approvals',
    "",
    "Notes:",
    "  The initial shipped generator supports route-first SPA projects created from `askr create spa`.",
  ].join("\n");
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const parsed = {
    branch: "app",
    cwd: process.cwd(),
    force: false,
    help: false,
    routePath: "",
    title: "",
    errors: [] as string[],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--branch") {
      if (index + 1 >= args.length) {
        parsed.errors.push("Missing value for --branch");
      } else {
        parsed.branch = args[index + 1];
        index += 1;
      }
    } else if (arg === "--cwd") {
      if (index + 1 >= args.length) {
        parsed.errors.push("Missing value for --cwd");
      } else {
        parsed.cwd = args[index + 1];
        index += 1;
      }
    } else if (arg === "--title") {
      if (index + 1 >= args.length) {
        parsed.errors.push("Missing value for --title");
      } else {
        parsed.title = args[index + 1].trim();
        index += 1;
      }
    } else if (arg === "--route") {
      if (index + 1 >= args.length) {
        parsed.errors.push("Missing value for --route");
      } else {
        parsed.routePath = args[index + 1].trim();
        index += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  return {
    ...parsed,
    command: positional[0] || "",
    name: positional[1] || "",
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

function slugifySegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePageSegments(input: string): string[] {
  const segments = input
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => slugifySegment(segment.trim()))
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment.startsWith("_"))) {
    return [];
  }

  return segments;
}

function toWords(segments: string[]): string[] {
  return segments.flatMap((segment) => segment.split("-").filter(Boolean));
}

function toTitleCase(words: string[]): string {
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function buildComponentName(segments: string[]): string {
  return `${toWords(segments)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")}Page`;
}

function buildRoutePath(branch: BranchName, segments: string[], overridePath = ""): string {
  if (!overridePath) {
    const suffix = segments.join("/");
    return branch === "app" ? `/app/${suffix}` : `/${suffix}`;
  }

  const normalized = overridePath.startsWith("/") ? overridePath : `/${overridePath}`;
  if (branch === "app") {
    return normalized === "/app" || normalized.startsWith("/app/")
      ? normalized
      : `/app${normalized}`;
  }

  if (normalized === "/app" || normalized.startsWith("/app/")) {
    throw new Error("Public branch routes cannot live under /app.");
  }

  return normalized;
}

function toImportSpecifier(fromFile: string, toFile: string): string {
  const relativePath = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  const withoutExtension = relativePath.replace(/\.tsx$/i, "");
  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
}

function createUpdatedRouteFile(
  routeFileContent: string,
  options: { componentName: string; importSpecifier: string; routePath: string },
): string {
  const normalized = routeFileContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const lastImportIndex = lines.reduce(
    (currentIndex, line, index) => (line.startsWith("import ") ? index : currentIndex),
    -1,
  );

  if (lastImportIndex === -1) {
    throw new Error("Unsupported route file: could not find import block.");
  }

  const importLine = `import ${options.componentName} from '${options.importSpecifier}';`;
  if (
    normalized.includes(importLine) ||
    normalized.includes(`route('${options.routePath}',`) ||
    normalized.includes(`route("${options.routePath}",`)
  ) {
    throw new Error(`Route '${options.routePath}' is already registered.`);
  }

  lines.splice(lastImportIndex + 1, 0, importLine);

  const closingIndex = lines.map((line) => line.trim()).lastIndexOf("}");
  if (closingIndex === -1) {
    throw new Error("Unsupported route file: could not find registration function body.");
  }

  lines.splice(closingIndex, 0, `  route('${options.routePath}', ${options.componentName});`);
  return `${lines.join("\n")}\n`;
}

function renderPageFile(options: {
  badge: string;
  componentName: string;
  routePath: string;
  title: string;
}): string {
  return [
    "import {",
    "  Badge,",
    "  Card,",
    "  CardContent,",
    "  CardDescription,",
    "  CardHeader,",
    "  CardTitle,",
    "} from '@askrjs/themes/components';",
    "import { Stack } from '@askrjs/themes/components';",
    "",
    `export default function ${options.componentName}() {`,
    "  return (",
    '    <Stack gap="5">',
    '      <section class="page-heading">',
    '        <Stack gap="2">',
    `          <Badge>${options.badge}</Badge>`,
    `          <h1>${options.title}</h1>`,
    '          <p class="lead">',
    `            Route-first scaffold for ${options.routePath}. Keep adapters, queries, and mutations outside the page as this surface grows.`,
    "          </p>",
    "        </Stack>",
    "      </section>",
    "",
    "      <Card>",
    "        <CardHeader>",
    "          <CardTitle>Next step</CardTitle>",
    "          <CardDescription>",
    "            Move view logic into feature folders and keep loading, empty, error, and success states explicit.",
    "          </CardDescription>",
    "        </CardHeader>",
    "        <CardContent>",
    '          <Stack gap="3">',
    "            <p>Start with a focused feature boundary instead of inline data fetching.</p>",
    "            <p>Prefer resource(), derive(), and For once the page takes on real state.</p>",
    "          </Stack>",
    "        </CardContent>",
    "      </Card>",
    "    </Stack>",
    "  );",
    "}",
    "",
  ].join("\n");
}

async function addPage(parsed: ParsedArgs, io: CliIo): Promise<number> {
  if (!parsed.name) {
    io.error("Page name is required.");
    return 1;
  }

  const branch = parsed.branch.toLowerCase() as BranchName;
  const branchConfig = BRANCH_CONFIG[branch];
  if (!branchConfig) {
    io.error(`Unsupported branch '${parsed.branch}'. Use app or public.`);
    return 1;
  }

  const segments = normalizePageSegments(parsed.name);
  if (segments.length === 0) {
    io.error("Page name must contain at least one non-empty path segment.");
    return 1;
  }

  const projectRoot = path.resolve(parsed.cwd);
  const routesFile = path.join(projectRoot, ...branchConfig.routesFile);
  if (!(await pathExists(routesFile))) {
    io.error(`Unsupported project layout. Expected route file: ${routesFile}`);
    io.error(
      "askr add page currently supports route-first SPA projects created by `askr create spa`.",
    );
    return 1;
  }

  const pageFile = path.join(projectRoot, ...branchConfig.pagesDir, ...segments).concat(".tsx");
  if ((await pathExists(pageFile)) && !parsed.force) {
    io.error(`Page file already exists: ${pageFile}`);
    io.error("Pass --force to overwrite the existing file.");
    return 1;
  }

  const title = parsed.title || toTitleCase(toWords(segments));
  const componentName = buildComponentName(segments);
  let routePath = "";
  try {
    routePath = buildRoutePath(branch, segments, parsed.routePath);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const importSpecifier = toImportSpecifier(routesFile, pageFile);
  let updatedRoutes = "";
  try {
    const routeFileContent = await fs.readFile(routesFile, "utf8");
    updatedRoutes = createUpdatedRouteFile(routeFileContent, {
      componentName,
      importSpecifier,
      routePath,
    });
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    await fs.mkdir(path.dirname(pageFile), { recursive: true });
    await fs.writeFile(
      pageFile,
      renderPageFile({
        badge: branchConfig.badge,
        componentName,
        routePath,
        title,
      }),
      "utf8",
    );
    await fs.writeFile(routesFile, updatedRoutes, "utf8");
  } catch (error) {
    io.error("Failed to write generated page artifacts.");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  io.log(`Added ${branch} page '${title}'.`);
  io.log(`  File: ${path.relative(projectRoot, pageFile).replace(/\\/g, "/")}`);
  io.log(`  Route: ${routePath}`);
  io.log(`  Router: ${path.relative(projectRoot, routesFile).replace(/\\/g, "/")}`);
  return 0;
}

export async function runAddCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.errors.length > 0) {
    for (const message of parsed.errors) {
      io.error(message);
    }
    return 1;
  }

  if (!parsed.command || parsed.help) {
    io.log(helpText());
    return 0;
  }

  if (parsed.command === "page") {
    return addPage(parsed, io);
  }

  io.error(`Unknown add command: ${parsed.command}`);
  io.error("Run `askr add --help` to see available commands.");
  return 1;
}

async function main(): Promise<void> {
  const code = await runAddCli(process.argv.slice(2));
  process.exit(code);
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
