#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { isDirectExecution } from "./is-direct-execution";
import { writeFileChanges } from "../file-changes";

type CliIo = Pick<Console, "error" | "log">;
type WriteChanges = typeof writeFileChanges;

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
  positionals: string[];
}

function helpText(): string {
  return [
    "askr add - Generate code into an existing Askr project",
    "",
    "Usage:",
    "  askr add page <name> [--branch app|public] [--cwd <dir>] [--title <title>] [--route <path>] [--force]",
    "  askr add action <name> --route <path> [--cwd <dir>] [--force]",
    "  askr add database postgres|sqlite [--cwd <dir>]",
    "",
    "Commands:",
    "  page      Scaffold a route page and register it in a route-first SPA branch",
    "  action    Scaffold a browser descriptor, server handler, registration, authorization, and test",
    "  database  Scaffold a dialect-specific Askr ORM database definition",
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
    "  askr add action approve-request --route /requests/{id}",
    "  askr add database sqlite",
    "",
    "Notes:",
    "  Page generation supports route-first SPA projects created from `askr create spa`.",
    "  Action generation supports projects created from `askr create full-stack`.",
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
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        parsed.errors.push("Missing value for --branch");
      } else {
        parsed.branch = args[index + 1];
        index += 1;
      }
    } else if (arg === "--cwd") {
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        parsed.errors.push("Missing value for --cwd");
      } else {
        parsed.cwd = args[index + 1];
        index += 1;
      }
    } else if (arg === "--title") {
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        parsed.errors.push("Missing value for --title");
      } else {
        parsed.title = args[index + 1].trim();
        index += 1;
      }
    } else if (arg === "--route") {
      if (index + 1 >= args.length || args[index + 1].startsWith("-")) {
        parsed.errors.push("Missing value for --route");
      } else {
        parsed.routePath = args[index + 1].trim();
        index += 1;
      }
    } else if (arg.startsWith("-")) {
      parsed.errors.push(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return {
    ...parsed,
    command: positional[0] || "",
    name: positional[1] || "",
    positionals: positional,
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

function buildIdentifier(segments: string[]): string {
  const [first = "action", ...rest] = toWords(segments);
  return [first.toLowerCase(), ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1))]
    .join("")
    .replace(/^[^a-z_$]/i, "action");
}

interface DeclaredAction {
  readonly slug: string;
  readonly descriptorName: string;
  readonly handlerName: string;
  readonly routePath: string;
}

function renderAuthorizationRegistry(actions: readonly DeclaredAction[]): string {
  const imports = actions.map(
    (action) => `import { ${action.descriptorName} } from './actions/${action.slug}.js';`,
  );
  const routes = new Map<string, DeclaredAction[]>();
  for (const action of actions) {
    const entries = routes.get(action.routePath) ?? [];
    entries.push(action);
    routes.set(action.routePath, entries);
  }
  const routeLines = [...routes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([routePath, entries]) =>
        `  ${JSON.stringify(routePath)}: [${entries.map((entry) => entry.descriptorName).join(", ")}],`,
    );
  return [
    "import type { ActionDescriptor } from '@askrjs/askr/actions';",
    ...imports,
    "",
    "const actionsByRoute: Readonly<Record<string, readonly ActionDescriptor[]>> = Object.freeze({",
    ...routeLines,
    "});",
    "",
    "export function actionsFor(path: string): readonly ActionDescriptor[] {",
    "  return actionsByRoute[path] ?? [];",
    "}",
    "",
  ].join("\n");
}

function renderServerActionRegistry(actions: readonly DeclaredAction[]): string {
  return [
    "import { defineServerActions, handleAction } from '@askrjs/server/askr';",
    ...actions.map(
      (action) => `import { ${action.descriptorName} } from '../actions/${action.slug}.js';`,
    ),
    ...actions.map(
      (action) => `import { ${action.handlerName} } from './actions/${action.slug}.js';`,
    ),
    "import type { AppDependencies } from './dependencies.js';",
    "",
    "function csrfSecret(): string {",
    "  const secret = process.env.CSRF_SECRET;",
    "  if (process.env.NODE_ENV !== 'production') return secret ?? 'development-only-secret';",
    "  if (!secret || secret.length < 32 || new Set(secret).size < 12) {",
    "    throw new Error('Production requires a strong CSRF_SECRET (at least 32 varied characters).');",
    "  }",
    "  return secret;",
    "}",
    "",
    "export function createActions(deps: AppDependencies) {",
    "  return defineServerActions({ dependencies: deps,",
    "    csrf: { secret: csrfSecret() },",
    "  },",
    ...actions.map(
      (action) => `    handleAction(${action.descriptorName}, ${action.handlerName}),`,
    ),
    "  );",
    "}",
    "",
  ].join("\n");
}

async function discoverDeclaredActions(
  projectRoot: string,
  replacement: { readonly filePath: string; readonly content: string },
): Promise<DeclaredAction[]> {
  const actionsDir = path.join(projectRoot, "src", "actions");
  const names = await fs.readdir(actionsDir).catch(() => []);
  const files = new Set(
    names.filter((name) => name.endsWith(".ts")).map((name) => path.join(actionsDir, name)),
  );
  files.add(replacement.filePath);
  const actions: DeclaredAction[] = [];
  for (const filePath of [...files].sort()) {
    const content =
      filePath === replacement.filePath ? replacement.content : await fs.readFile(filePath, "utf8");
    const descriptor = /export const (\w+Action) = defineAction\(/.exec(content)?.[1];
    if (!descriptor) continue;
    const routeName = `${descriptor}Route`;
    const routeMatch = new RegExp(`export const ${routeName} = (['"])(.*?)\\1;`).exec(content);
    if (!routeMatch)
      throw new Error(`Action descriptor ${path.basename(filePath)} must declare ${routeName}.`);
    const slug = path.basename(filePath, ".ts");
    actions.push({
      slug,
      descriptorName: descriptor,
      handlerName: buildIdentifier([slug]),
      routePath: routeMatch[2]!,
    });
  }
  return actions.sort((left, right) => left.slug.localeCompare(right.slug));
}

function renderActionDescriptor(options: {
  descriptorName: string;
  routePath: string;
  slug: string;
}): string {
  return [
    "import { defineAction } from '@askrjs/askr/actions';",
    "import { schema } from '@askrjs/schema';",
    "",
    `export const ${options.descriptorName}Route = ${JSON.stringify(options.routePath)};`,
    "",
    `export const ${options.descriptorName} = defineAction({`,
    `  id: '${options.slug}',`,
    "  input: schema.object({ value: schema.string({ minLength: 1 }) }),",
    "  invalidates: [],",
    "});",
    "",
  ].join("\n");
}

function renderActionHandler(options: {
  descriptorName: string;
  handlerName: string;
  slug: string;
}): string {
  return [
    "import type { InferSchema } from '@askrjs/schema';",
    `import { ${options.descriptorName} } from '../../actions/${options.slug}.js';`,
    "import type { AppDependencies } from '../dependencies.js';",
    "",
    `type Input = InferSchema<typeof ${options.descriptorName}.input>;`,
    "",
    `export async function ${options.handlerName}(`,
    "  _context: unknown,",
    "  input: Input,",
    "  deps: Pick<AppDependencies, 'actions'>,",
    ") {",
    "  await deps.actions.record({ action: " +
      JSON.stringify(options.slug) +
      ", value: input.value });",
    "  return { result: { accepted: true } };",
    "}",
    "",
  ].join("\n");
}

function renderActionTest(options: { descriptorName: string; slug: string }): string {
  return [
    "import { describe, expect, it } from 'vitest';",
    `import { ${options.descriptorName} } from '../../src/actions/${options.slug}.js';`,
    "",
    `describe('${options.slug} action', () => {`,
    "  it('should expose a browser-safe executable input contract', () => {",
    `    expect(${options.descriptorName}.id).toBe('${options.slug}');`,
    `    expect(${options.descriptorName}.input.safeParse({ value: 'example' }).success).toBe(true);`,
    `    expect(${options.descriptorName}.input.safeParse({ value: '' }).success).toBe(false);`,
    "  });",
    "});",
    "",
  ].join("\n");
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
  const importLine = `import ${options.componentName} from '${options.importSpecifier}';`;
  if (
    normalized.includes(importLine) ||
    normalized.includes(`route('${options.routePath}',`) ||
    normalized.includes(`route("${options.routePath}",`)
  ) {
    throw new Error(`Route '${options.routePath}' is already registered.`);
  }

  const importMarker = "// askr:imports";
  const routeMarker = "  // askr:routes";
  if (normalized.split(importMarker).length !== 2 || normalized.split(routeMarker).length !== 2) {
    throw new Error(
      "Unsupported route file: expected exactly one // askr:imports and // askr:routes marker.",
    );
  }
  return `${normalized
    .replace(importMarker, `${importMarker}\n${importLine}`)
    .replace(
      routeMarker,
      `${routeMarker}\n  route('${options.routePath}', ${options.componentName});`,
    )
    .replace(/\n+$/, "")}\n`;
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

async function addPage(parsed: ParsedArgs, io: CliIo, writeChanges: WriteChanges): Promise<number> {
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
    await writeChanges([
      {
        filePath: pageFile,
        content: renderPageFile({
          badge: branchConfig.badge,
          componentName,
          routePath,
          title,
        }),
      },
      { filePath: routesFile, content: updatedRoutes },
    ]);
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

async function addAction(
  parsed: ParsedArgs,
  io: CliIo,
  writeChanges: WriteChanges,
): Promise<number> {
  if (!parsed.name) {
    io.error("Action name is required.");
    return 1;
  }
  if (!parsed.routePath || !parsed.routePath.startsWith("/")) {
    io.error("Action generation requires an absolute --route path.");
    return 1;
  }

  const segments = normalizePageSegments(parsed.name);
  if (segments.length === 0) {
    io.error("Action name must contain at least one non-empty path segment.");
    return 1;
  }

  const projectRoot = path.resolve(parsed.cwd);
  const slug = segments.join("-");
  const handlerName = buildIdentifier(segments);
  const descriptorName = `${handlerName}Action`;
  const descriptorFile = path.join(projectRoot, "src", "actions", `${slug}.ts`);
  const handlerFile = path.join(projectRoot, "src", "server", "actions", `${slug}.ts`);
  const registryFile = path.join(projectRoot, "src", "server", "action-registry.ts");
  const authorizationFile = path.join(projectRoot, "src", "action-authorizations.ts");
  const testFile = path.join(projectRoot, "tests", "actions", `${slug}.test.ts`);

  if (!(await pathExists(registryFile)) || !(await pathExists(authorizationFile))) {
    io.error("Unsupported project layout. Expected an `askr create full-stack` project.");
    return 1;
  }
  if (!parsed.force && ((await pathExists(descriptorFile)) || (await pathExists(handlerFile)))) {
    io.error(`Action '${slug}' already exists. Pass --force to replace its generated files.`);
    return 1;
  }

  try {
    const descriptor = renderActionDescriptor({
      descriptorName,
      routePath: parsed.routePath,
      slug,
    });
    const actions = await discoverDeclaredActions(projectRoot, {
      filePath: descriptorFile,
      content: descriptor,
    });
    await writeChanges([
      { filePath: descriptorFile, content: descriptor },
      {
        filePath: handlerFile,
        content: renderActionHandler({ descriptorName, handlerName, slug }),
      },
      { filePath: testFile, content: renderActionTest({ descriptorName, slug }) },
      { filePath: registryFile, content: renderServerActionRegistry(actions) },
      { filePath: authorizationFile, content: renderAuthorizationRegistry(actions) },
    ]);
  } catch (error) {
    io.error("Failed to write generated action artifacts.");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  io.log(`Added action '${slug}' for ${parsed.routePath}.`);
  io.log(`  Descriptor: ${path.relative(projectRoot, descriptorFile).replace(/\\/g, "/")}`);
  io.log(`  Handler: ${path.relative(projectRoot, handlerFile).replace(/\\/g, "/")}`);
  io.log(`  Test: ${path.relative(projectRoot, testFile).replace(/\\/g, "/")}`);
  return 0;
}

async function addDatabase(
  parsed: ParsedArgs,
  io: CliIo,
  writeChanges: WriteChanges,
): Promise<number> {
  if (parsed.name !== "postgres" && parsed.name !== "sqlite") {
    io.error("Database dialect must be `postgres` or `sqlite`.");
    return 1;
  }
  const projectRoot = path.resolve(parsed.cwd);
  const manifestFile = path.join(projectRoot, "package.json");
  const definitionFile = path.join(projectRoot, "src", "database", "index.ts");
  const generatedFile = path.join(projectRoot, "src", "database", "generated.ts");
  const migrationKeep = path.join(projectRoot, "src", "database", "migrations", ".gitkeep");
  const environmentFile = path.join(projectRoot, ".env.example");
  if (!(await pathExists(manifestFile))) {
    io.error("Database generation requires a project package.json.");
    return 1;
  }
  if (!parsed.force && ((await pathExists(definitionFile)) || (await pathExists(generatedFile)))) {
    io.error("Database files already exist. Pass --force to replace generated scaffolding.");
    return 1;
  }
  try {
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    manifest.dependencies = {
      ...manifest.dependencies,
      "@askrjs/orm": "0.0.0",
      ...(parsed.name === "postgres" ? { pg: "^8.16.0", "pg-query-stream": "^4.10.0" } : {}),
    };
    manifest.dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies).sort(([left], [right]) => left.localeCompare(right)),
    );
    const currentEnvironment = await fs.readFile(environmentFile, "utf8").catch(() => "");
    const environmentLines =
      parsed.name === "postgres"
        ? [
            "DATABASE_URL=postgres://postgres:postgres@localhost:5432/app",
            "DATABASE_SHADOW_URL=postgres://postgres:postgres@localhost:5432/app_shadow",
          ]
        : ["DATABASE_PATH=./data/app.sqlite"];
    const additions = environmentLines.filter(
      (line) => !currentEnvironment.includes(`${line.split("=")[0]}=`),
    );
    const environment = `${currentEnvironment}${currentEnvironment && !currentEnvironment.endsWith("\n") ? "\n" : ""}${additions.join("\n")}${additions.length ? "\n" : ""}`;
    const driverImport = parsed.name;
    const definition = [
      "import { defineDatabase } from '@askrjs/orm';",
      `import { ${driverImport} } from '@askrjs/orm/${driverImport}';`,
      "import { generated } from './generated.js';",
      "",
      "export const database = defineDatabase({",
      `  driver: ${driverImport}(),`,
      "  tables: {},",
      "  queries: {},",
      "  generated,",
      "});",
      "",
    ].join("\n");
    const generated = [
      "import type { GeneratedDatabaseArtifact } from '@askrjs/orm';",
      "",
      "// Generated by `askr database generate`; commit this file.",
      "export const generated = {",
      "  manifest: { migrations: [] },",
      "  queries: {},",
      "} as const satisfies GeneratedDatabaseArtifact;",
      "",
    ].join("\n");
    await writeChanges([
      { filePath: definitionFile, content: definition },
      { filePath: generatedFile, content: generated },
      { filePath: migrationKeep, content: "" },
      { filePath: environmentFile, content: environment },
      { filePath: manifestFile, content: `${JSON.stringify(manifest, null, 2)}\n` },
    ]);
  } catch (error) {
    io.error("Failed to write generated database artifacts.");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  io.log(`Added ${parsed.name} database support.`);
  io.log("  Definition: src/database/index.ts");
  io.log("  Migrations: src/database/migrations");
  return 0;
}

export async function runAddCli(
  args: string[] = process.argv.slice(2),
  io: CliIo = console,
  writeChanges: WriteChanges = writeFileChanges,
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

  if (parsed.positionals.length !== 2 || !parsed.name) {
    io.error("A command and exactly one generator name are required.");
    return 1;
  }

  if (parsed.command === "page") {
    return addPage(parsed, io, writeChanges);
  }

  if (parsed.command === "action") {
    return addAction(parsed, io, writeChanges);
  }

  if (parsed.command === "database") {
    return addDatabase(parsed, io, writeChanges);
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
