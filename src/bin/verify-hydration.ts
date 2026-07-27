#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { isDirectExecution } from "./is-direct-execution";

type CliIo = Pick<Console, "error" | "log">;

interface ParsedVerifyHydrationArgs {
  cwd: string;
  outputDir: string;
  routes: string[];
  rootSelector: string;
  buildScript: string;
  build: boolean;
  timeoutMs: number;
  browserChannel?: string;
  help: boolean;
  errors: string[];
}

interface RouteMetadata {
  path: string;
  filePath: string;
  status?: string;
}

interface StaticOutputServer {
  origin: string;
  close(): Promise<void>;
}

interface VerifyHydrationDeps {
  runBuild?: (cwd: string, script: string) => Promise<void>;
  launchBrowser?: (channel?: string) => Promise<Browser>;
  startServer?: (
    outputDir: string,
    routes: readonly RouteMetadata[],
  ) => Promise<StaticOutputServer>;
}

interface DomSnapshot {
  lines: string[];
}

const helpText = `
askr verify-hydration - Verify SSG DOM structure in a real browser

Usage:
  askr verify-hydration [--output <dir>] [--route <path> ...]

Options:
  --cwd <dir>             Project directory (default: current directory)
  --output <dir>          Generated SSG output (default: dist)
  --route <path>          Route to verify; repeat to select a route set
  --root <selector>       Hydrated application root (default: #app)
  --build-script <name>   npm script that builds SSG output (default: build)
  --no-build              Verify existing output without running a build
  --timeout <ms>          Per-route browser timeout (default: 10000)
  --browser-channel <id>  Browser channel: chrome, msedge, or playwright
  --help                  Show this help message

When --route is omitted, routes are read from <output>/metadata.json.
`;

function parsePositiveInteger(value: string, option: string, errors: string[]): number | undefined {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    errors.push(`${option} must be a positive integer`);
    return undefined;
  }
  return parsed;
}

export function parseVerifyHydrationArgs(
  args: string[],
  defaultCwd = process.cwd(),
): ParsedVerifyHydrationArgs {
  const parsed: ParsedVerifyHydrationArgs = {
    cwd: defaultCwd,
    outputDir: "dist",
    routes: [],
    rootSelector: "#app",
    buildScript: "build",
    build: true,
    timeoutMs: 10_000,
    help: false,
    errors: [],
  };
  const takeValue = (index: number, option: string): string | undefined => {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      parsed.errors.push(`Missing value for ${option}`);
      return undefined;
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--cwd" ||
      argument === "--output" ||
      argument === "--route" ||
      argument === "--root" ||
      argument === "--build-script" ||
      argument === "--timeout" ||
      argument === "--browser-channel"
    ) {
      const value = takeValue(index, argument);
      if (!value) continue;
      index += 1;
      if (argument === "--cwd") parsed.cwd = value;
      else if (argument === "--output") parsed.outputDir = value;
      else if (argument === "--route") parsed.routes.push(value);
      else if (argument === "--root") parsed.rootSelector = value;
      else if (argument === "--build-script") parsed.buildScript = value;
      else if (argument === "--browser-channel") parsed.browserChannel = value;
      else {
        const timeout = parsePositiveInteger(value, "--timeout", parsed.errors);
        if (timeout) parsed.timeoutMs = timeout;
      }
    } else if (argument === "--no-build") parsed.build = false;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else parsed.errors.push(`Unknown option: ${argument}`);
  }

  parsed.cwd = path.resolve(defaultCwd, parsed.cwd);
  parsed.outputDir = path.resolve(parsed.cwd, parsed.outputDir);
  return parsed;
}

function normalizeRoute(route: string): string {
  const pathname = new URL(route, "http://askr.local").pathname;
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
}

async function readRouteMetadata(
  outputDir: string,
  selectedRoutes: readonly string[],
): Promise<RouteMetadata[]> {
  const metadataPath = path.join(outputDir, "metadata.json");
  let metadata: unknown;
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read SSG route metadata at ${metadataPath}: ${detail}`);
  }
  const routes = (metadata as { routes?: unknown }).routes;
  if (!Array.isArray(routes)) {
    throw new Error(`Invalid SSG route metadata at ${metadataPath}: routes must be an array.`);
  }
  const valid = routes.filter((entry): entry is RouteMetadata =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      typeof (entry as RouteMetadata).path === "string" &&
      typeof (entry as RouteMetadata).filePath === "string" &&
      (entry as RouteMetadata).status !== "error" &&
      (entry as RouteMetadata).status !== "removed",
    ),
  );
  const byPath = new Map(valid.map((entry) => [normalizeRoute(entry.path), entry]));
  if (selectedRoutes.length === 0) {
    return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  return [...new Set(selectedRoutes.map(normalizeRoute))].map((route) => {
    const entry = byPath.get(route);
    if (!entry) throw new Error(`Route ${route} is not present in ${metadataPath}.`);
    return entry;
  });
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startStaticOutputServer(
  outputDir: string,
  routes: readonly RouteMetadata[],
): Promise<StaticOutputServer> {
  const outputRoot = path.resolve(outputDir);
  const routeFiles = new Map(
    routes.map((entry) => [normalizeRoute(entry.path), path.resolve(outputRoot, entry.filePath)]),
  );
  for (const [route, filePath] of routeFiles) {
    const relative = path.relative(outputRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Route ${route} resolves outside the SSG output directory.`);
    }
  }
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = normalizeRoute(new URL(request.url ?? "/", "http://askr.local").pathname);
      const candidate = routeFiles.get(pathname) ?? path.resolve(outputRoot, `.${pathname}`);
      const relative = path.relative(outputRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const stat = await fs.stat(candidate).catch(() => null);
      const filePath = stat?.isDirectory() ? path.join(candidate, "index.html") : candidate;
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentType(filePath),
      });
      response.end(content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Hydration verification server did not bind a TCP port.");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function runNpmBuild(cwd: string, script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(executable, ["run", script], { cwd, stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`npm run ${script} timed out after 300000ms.`));
    }, 300_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `npm run ${script} failed${
              signal ? ` with signal ${signal}` : ` with exit code ${code}`
            }.`,
          ),
        );
      }
    });
  });
}

async function launchChromium(channel?: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const requested = channel ?? process.env.ASKR_BROWSER_CHANNEL ?? "chrome";
  try {
    return requested === "playwright"
      ? await chromium.launch({ headless: true })
      : await chromium.launch({ channel: requested, headless: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not launch the ${requested} browser channel. Install Chrome, pass ` +
        `--browser-channel msedge, or run "npx playwright-core install chromium" and pass ` +
        `--browser-channel playwright. ${detail}`,
    );
  }
}

async function snapshotRoot(page: Page, selector: string): Promise<DomSnapshot> {
  return page.evaluate((rootSelector) => {
    interface BrowserNode {
      readonly nodeType: number;
      readonly childNodes: Iterable<BrowserNode>;
      matches(selector: string): boolean;
      readonly tagName: string;
    }
    const browserGlobal = globalThis as unknown as {
      document: { querySelector(selector: string): BrowserNode | null };
    };
    const root = browserGlobal.document.querySelector(rootSelector);
    if (!root) throw new Error(`Hydration root not found: ${rootSelector}`);
    const lines: string[] = [];
    const pending: Array<{ node: BrowserNode; path: string }> = [
      { node: root, path: rootSelector },
    ];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) break;
      const { node, path: nodePath } = current;
      if (node.nodeType !== 1) continue;
      if (node.matches("script, style, link, meta, noscript, template")) continue;
      lines.push(`${nodePath} <${node.tagName.toLowerCase()}>`);
      const children = [...node.childNodes].filter(
        (child) =>
          child.nodeType === 1 && !child.matches("script, style, link, meta, noscript, template"),
      );
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: children[index]!, path: `${nodePath}/${index}` });
      }
    }
    return { lines };
  }, selector);
}

function firstDifference(
  expected: DomSnapshot,
  actual: DomSnapshot,
): { index: number; expected: string; actual: string } | null {
  const length = Math.max(expected.lines.length, actual.lines.length);
  for (let index = 0; index < length; index += 1) {
    if (expected.lines[index] !== actual.lines[index]) {
      return {
        index,
        expected: expected.lines[index] ?? "<missing>",
        actual: actual.lines[index] ?? "<missing>",
      };
    }
  }
  return null;
}

async function loadSnapshot(
  context: BrowserContext,
  url: string,
  selector: string,
  timeoutMs: number,
  settleHydration: boolean,
): Promise<{ snapshot: DomSnapshot; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  try {
    page.setDefaultTimeout(timeoutMs);
    const response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    if (!response?.ok()) {
      throw new Error(`HTTP ${response?.status() ?? "failure"} loading ${url}`);
    }
    if (settleHydration) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          page.evaluate(() => {
            const animationFrame = (
              globalThis as unknown as { requestAnimationFrame(callback: () => void): number }
            ).requestAnimationFrame;
            return new Promise<void>((resolve) =>
              animationFrame(() => animationFrame(() => resolve())),
            );
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Hydration timeout: did not settle within ${timeoutMs}ms.`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return { snapshot: await snapshotRoot(page, selector), errors };
  } finally {
    await page.close();
  }
}

export async function verifyHydrationRoutes(
  browser: Browser,
  origin: string,
  routes: readonly RouteMetadata[],
  rootSelector: string,
  timeoutMs: number,
): Promise<string[]> {
  const failures: string[] = [];
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const hydratedContext = await browser.newContext({ javaScriptEnabled: true });
  try {
    for (const route of routes) {
      const url = `${origin}${normalizeRoute(route.path)}`;
      try {
        const expected = await loadSnapshot(staticContext, url, rootSelector, timeoutMs, false);
        const actual = await loadSnapshot(hydratedContext, url, rootSelector, timeoutMs, true);
        const difference = firstDifference(expected.snapshot, actual.snapshot);
        if (difference) {
          failures.push(
            `${route.path}: DOM diverged at normalized entry ${difference.index}\n` +
              `  static:   ${difference.expected}\n` +
              `  hydrated: ${difference.actual}`,
          );
        }
        for (const error of actual.errors) failures.push(`${route.path}: browser error: ${error}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(`${route.path}: ${detail}`);
      }
    }
  } finally {
    await Promise.all([staticContext.close(), hydratedContext.close()]);
  }
  return failures;
}

export async function runVerifyHydrationCli(
  args: string[] = process.argv.slice(2),
  deps: VerifyHydrationDeps = {},
  io: CliIo = console,
): Promise<number> {
  const parsed = parseVerifyHydrationArgs(args);
  if (parsed.help) {
    io.log(helpText);
    return 0;
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) io.error(`Error: ${error}`);
    return 1;
  }

  let server: StaticOutputServer | undefined;
  let browser: Browser | undefined;
  try {
    if (parsed.build) await (deps.runBuild ?? runNpmBuild)(parsed.cwd, parsed.buildScript);
    const routes = await readRouteMetadata(parsed.outputDir, parsed.routes);
    if (routes.length === 0)
      throw new Error("SSG metadata contains no successful routes to verify.");
    server = await (deps.startServer ?? startStaticOutputServer)(parsed.outputDir, routes);
    browser = await (deps.launchBrowser ?? launchChromium)(parsed.browserChannel);
    const failures = await verifyHydrationRoutes(
      browser,
      server.origin,
      routes,
      parsed.rootSelector,
      parsed.timeoutMs,
    );
    if (failures.length > 0) {
      for (const failure of failures) io.error(`Hydration verification failed: ${failure}`);
      return 1;
    }
    io.log(`Verified hydration DOM for ${routes.length} route(s).`);
    return 0;
  } catch (error) {
    io.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  process.exit(await runVerifyHydrationCli());
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
