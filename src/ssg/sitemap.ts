import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type SitemapChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapRouteConfig {
  /** Canonical URL. Relative values resolve against siteUrl. */
  url?: string;
  /** W3C date/datetime or Date describing the last meaningful page update. */
  lastModified?: string | Date;
  changeFrequency?: SitemapChangeFrequency;
  /** Relative crawl priority from 0 through 1. */
  priority?: number;
  /** hreflang to canonical URL mapping, including optional x-default. */
  alternates?: Readonly<Record<string, string>>;
}

export interface SitemapRouteContext {
  path: string;
  filePath: string;
  status: string;
  /** Resolved rendered canonical URL, when the document declares one. */
  canonical?: string;
}

export interface SitemapConfig {
  /** Site-wide values inherited by included routes. */
  defaults?: Omit<SitemapRouteConfig, "url" | "alternates">;
  /** Exact concrete route overrides. Set a route to false to exclude it. */
  routes?: Readonly<Record<string, SitemapRouteConfig | false>>;
  /** Compute or override sitemap data. Returning false excludes the route. */
  resolve?: (
    route: SitemapRouteContext,
  ) =>
    | SitemapRouteConfig
    | false
    | null
    | undefined
    | Promise<SitemapRouteConfig | false | null | undefined>;
  /** Output path relative to the SSG output directory. */
  output?: string;
  /** Maintain a Sitemap directive in robots.txt. Defaults to true. */
  robots?: boolean | { output?: string };
  /** Optional lower limits for deterministic partitioning and tests. */
  limits?: { urlsPerFile?: number; bytesPerFile?: number };
  /** Maximum concurrent async route metadata resolvers. Defaults to 16. */
  resolverConcurrency?: number;
}

interface GeneratedRoute {
  location: string;
  lastModified?: string;
  changeFrequency?: SitemapChangeFrequency;
  priority?: number;
  alternates: Array<{ language: string; location: string }>;
}

const datePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2})))?$/;
const languagePattern = /^(?:x-default|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/;
const changeFrequencies = new Set<SitemapChangeFrequency>([
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
]);
const MAX_URLS_PER_SITEMAP = 50_000;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MANIFEST_PATH = ".askr/sitemap-manifest.json";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return replacements[character];
  });
}

function resolveSiteUrl(siteUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error(`SSG siteUrl must be an absolute HTTP(S) URL: ${siteUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSG siteUrl must use HTTP or HTTPS: ${siteUrl}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error("SSG siteUrl must not contain a query string or fragment");
  }
  if (parsed.username || parsed.password) {
    throw new Error("SSG siteUrl must not contain credentials");
  }
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed;
}

function resolveLocation(value: string, siteUrl: URL): string {
  let resolved: URL;
  try {
    resolved = new URL(value.replace(/^\//, ""), siteUrl);
  } catch {
    throw new Error(`Invalid sitemap URL: ${value}`);
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error(`Sitemap URLs must use HTTP or HTTPS: ${value}`);
  }
  if (resolved.hash) throw new Error(`Sitemap URLs must not contain fragments: ${value}`);
  return resolved.href;
}

function resolveDocumentCanonical(
  value: string,
  siteUrl: URL,
  label = "rendered canonical",
): string {
  let resolved: URL;
  try {
    resolved = new URL(value, siteUrl);
  } catch {
    throw new Error(`Invalid ${label} URL: ${value}`);
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error(`${label} URLs must use HTTP or HTTPS: ${value}`);
  }
  if (resolved.hash) {
    throw new Error(`${label} URLs must not contain fragments: ${value}`);
  }
  return resolved.href;
}

function formatLastModified(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid sitemap lastModified Date");
    return value.toISOString();
  }
  const match = datePattern.exec(value);
  if (!match) {
    throw new Error(`Invalid sitemap lastModified value: ${value}`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zone,
    offsetHour,
    offsetMinute,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const invalidTime =
    hourText !== undefined &&
    (Number(hourText) > 23 ||
      Number(minuteText) > 59 ||
      Number(secondText) > 59 ||
      (zone !== "Z" &&
        (Number(offsetHour) > 14 ||
          Number(offsetMinute) > 59 ||
          (Number(offsetHour) === 14 && Number(offsetMinute) !== 0))));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    invalidTime ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`Invalid sitemap lastModified value: ${value}`);
  }
  return value;
}

function validateChangeFrequency(value: SitemapChangeFrequency): SitemapChangeFrequency {
  if (!changeFrequencies.has(value)) {
    throw new Error(`Invalid sitemap changeFrequency value: ${value}`);
  }
  return value;
}

function validatePriority(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Sitemap priority must be between 0 and 1: ${value}`);
  }
  return value;
}

function outputPath(outputDir: string, configuredPath: string | undefined): string {
  const relativePath = configuredPath ?? "sitemap.xml";
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Sitemap output must be relative to the SSG output directory: ${relativePath}`);
  }
  const resolved = path.resolve(outputDir, relativePath);
  const relative = path.relative(path.resolve(outputDir), resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Sitemap output must stay inside the SSG output directory: ${relativePath}`);
  }
  return resolved;
}

function relativeOutputPath(outputDir: string, absolutePath: string): string {
  return path.relative(path.resolve(outputDir), absolutePath).replace(/\\/g, "/");
}

function validateLimit(value: number | undefined, maximum: number, label: string): number {
  const resolved = value ?? maximum;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
  return resolved;
}

async function atomicWrite(destination: string, contents: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function renderUrlSet(routes: readonly GeneratedRoute[]): string {
  const hasAlternates = routes.some((route) => route.alternates.length > 0);
  const namespace = hasAlternates
    ? ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset${namespace}>\n${routes
    .map(renderRoute)
    .join("\n")}\n</urlset>\n`;
}

function partitionRoutes(
  routes: readonly GeneratedRoute[],
  urlsPerFile: number,
  bytesPerFile: number,
): GeneratedRoute[][] {
  if (routes.length === 0) return [[]];
  const chunks: GeneratedRoute[][] = [];
  let current: GeneratedRoute[] = [];
  let currentEntryBytes = 0;
  let currentHasAlternates = false;
  const envelopeBytes = {
    plain: Buffer.byteLength(renderUrlSet([])),
    alternates: Buffer.byteLength(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n\n</urlset>\n',
    ),
  };
  const envelope = (hasAlternates: boolean): number =>
    hasAlternates ? envelopeBytes.alternates : envelopeBytes.plain;
  for (const route of routes) {
    const routeBytes = Buffer.byteLength(renderRoute(route));
    const nextHasAlternates: boolean = currentHasAlternates || route.alternates.length > 0;
    const separatorBytes = current.length > 0 ? 1 : 0;
    const nextBytes = envelope(nextHasAlternates) + currentEntryBytes + separatorBytes + routeBytes;
    if (current.length > 0 && (current.length + 1 > urlsPerFile || nextBytes > bytesPerFile)) {
      chunks.push(current);
      current = [route];
      currentEntryBytes = routeBytes;
      currentHasAlternates = route.alternates.length > 0;
    } else {
      current.push(route);
      currentEntryBytes += separatorBytes + routeBytes;
      currentHasAlternates = nextHasAlternates;
    }
    if (envelope(currentHasAlternates) + currentEntryBytes > bytesPerFile) {
      throw new Error(`A sitemap URL entry exceeds the configured ${bytesPerFile}-byte limit`);
    }
  }
  chunks.push(current);
  return chunks;
}

function sitemapIndex(locations: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations
    .map((location) => `  <sitemap>\n    <loc>${escapeXml(location)}</loc>\n  </sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;
}

interface SitemapManifest {
  files: string[];
  robots?: string;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: values.length });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readManifest(outputDir: string): Promise<SitemapManifest> {
  try {
    const parsed = JSON.parse(await readFile(outputPath(outputDir, MANIFEST_PATH), "utf8"));
    return {
      files: Array.isArray(parsed.files)
        ? parsed.files.filter((value: unknown) => typeof value === "string")
        : [],
      ...(typeof parsed.robots === "string" ? { robots: parsed.robots } : {}),
    };
  } catch {
    return { files: [] };
  }
}

function withoutSitemapDirective(contents: string): string {
  return contents
    .split(/\r?\n/)
    .filter((line) => !/^\s*Sitemap\s*:/i.test(line))
    .join("\n")
    .replace(/\n+$/, "");
}

async function updateRobots(
  outputDir: string,
  previousPath: string | undefined,
  configured: SitemapConfig["robots"],
  sitemapUrl: string,
): Promise<string | undefined> {
  const nextPath =
    configured === false
      ? undefined
      : configured && typeof configured === "object"
        ? (configured.output ?? "robots.txt")
        : "robots.txt";
  const paths = new Set(
    [previousPath, nextPath].filter((value): value is string => Boolean(value)),
  );
  for (const relativePath of paths) {
    const destination = outputPath(outputDir, relativePath);
    const existing = await readFile(destination, "utf8").catch(() => "");
    let contents = withoutSitemapDirective(existing);
    if (relativePath === nextPath) {
      if (!contents) contents = "User-agent: *\nAllow: /";
      contents = `${contents}\nSitemap: ${sitemapUrl}`;
    }
    if (contents) await atomicWrite(destination, `${contents}\n`);
    else await rm(destination, { force: true });
  }
  return nextPath;
}

export async function removeGeneratedSitemap(outputDir: string): Promise<void> {
  const previous = await readManifest(outputDir);
  await mapConcurrent(previous.files, 32, async (file) =>
    rm(outputPath(outputDir, file), { force: true }),
  );
  await updateRobots(outputDir, previous.robots, false, "");
  await rm(outputPath(outputDir, MANIFEST_PATH), { force: true });
}

function renderRoute(route: GeneratedRoute): string {
  const lines = ["  <url>", `    <loc>${escapeXml(route.location)}</loc>`];
  if (route.lastModified) lines.push(`    <lastmod>${escapeXml(route.lastModified)}</lastmod>`);
  if (route.changeFrequency) lines.push(`    <changefreq>${route.changeFrequency}</changefreq>`);
  if (route.priority !== undefined) lines.push(`    <priority>${route.priority}</priority>`);
  for (const alternate of route.alternates) {
    lines.push(
      `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.language)}" href="${escapeXml(alternate.location)}" />`,
    );
  }
  lines.push("  </url>");
  return lines.join("\n");
}

export async function generateSitemap(
  outputDir: string,
  siteUrl: string,
  routes: readonly SitemapRouteContext[],
  config: SitemapConfig = {},
): Promise<string> {
  const baseUrl = resolveSiteUrl(siteUrl);
  const resolverConcurrency = validateLimit(
    config.resolverConcurrency ?? 16,
    128,
    "Sitemap resolver concurrency",
  );
  const includedRoutes = routes.filter(
    (route) =>
      (route.status === "success" || route.status === "skipped") && !route.path.includes("*"),
  );
  const resolvedRoutes = await mapConcurrent(includedRoutes, resolverConcurrency, async (route) => {
    const exact = config.routes?.[route.path];
    if (exact === false) return undefined;
    const canonical = route.canonical
      ? resolveDocumentCanonical(route.canonical, baseUrl)
      : undefined;
    const resolved = await config.resolve?.({
      ...route,
      ...(canonical ? { canonical } : {}),
    });
    if (resolved === false) return undefined;
    const merged = { ...config.defaults, ...exact, ...resolved };
    for (const [source, value] of [
      ["sitemap.routes", exact?.url],
      ["sitemap.resolve", resolved?.url],
    ] as const) {
      const explicitUrl = value
        ? resolveDocumentCanonical(value, baseUrl, `${source} override`)
        : undefined;
      if (canonical && explicitUrl && explicitUrl !== canonical) {
        throw new Error(
          `Sitemap URL mismatch for ${route.path}: rendered canonical ${canonical} disagrees with ${source} URL ${explicitUrl}`,
        );
      }
    }
    const alternates: GeneratedRoute["alternates"] = [];
    for (const [language, location] of Object.entries(merged.alternates ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!languagePattern.test(language)) {
        throw new Error(`Invalid sitemap hreflang value: ${language}`);
      }
      alternates.push({ language, location: resolveLocation(location, baseUrl) });
    }

    return {
      location: canonical ?? resolveLocation(merged.url ?? route.path, baseUrl),
      ...(merged.lastModified !== undefined
        ? { lastModified: formatLastModified(merged.lastModified) }
        : {}),
      ...(merged.changeFrequency
        ? { changeFrequency: validateChangeFrequency(merged.changeFrequency) }
        : {}),
      ...(merged.priority !== undefined ? { priority: validatePriority(merged.priority) } : {}),
      alternates,
    } satisfies GeneratedRoute;
  });
  const generated = resolvedRoutes.filter((route): route is GeneratedRoute => Boolean(route));

  generated.sort((a, b) => a.location.localeCompare(b.location));
  const locations = new Set<string>();
  for (const route of generated) {
    if (locations.has(route.location)) {
      throw new Error(`Sitemap contains a duplicate canonical URL: ${route.location}`);
    }
    locations.add(route.location);
  }

  const destination = outputPath(outputDir, config.output);
  const urlsPerFile = validateLimit(
    config.limits?.urlsPerFile,
    MAX_URLS_PER_SITEMAP,
    "Sitemap URL limit",
  );
  const bytesPerFile = validateLimit(
    config.limits?.bytesPerFile,
    MAX_SITEMAP_BYTES,
    "Sitemap byte limit",
  );
  const chunks = partitionRoutes(generated, urlsPerFile, bytesPerFile);
  if (chunks.length > MAX_URLS_PER_SITEMAP) {
    throw new Error(`Sitemap index exceeds ${MAX_URLS_PER_SITEMAP} sitemap entries`);
  }
  const generatedFiles: string[] = [];
  if (chunks.length === 1) {
    await atomicWrite(destination, renderUrlSet(chunks[0]));
    generatedFiles.push(relativeOutputPath(outputDir, destination));
  } else {
    const extension = path.extname(destination);
    const base = destination.slice(0, extension ? -extension.length : undefined);
    const chunkDestinations = chunks.map((_, index) => `${base}-${index + 1}.xml`);
    await mapConcurrent(chunks, 16, async (chunk, index) =>
      atomicWrite(chunkDestinations[index]!, renderUrlSet(chunk)),
    );
    const indexXml = sitemapIndex(
      chunkDestinations.map((chunkPath) =>
        resolveLocation(relativeOutputPath(outputDir, chunkPath), baseUrl),
      ),
    );
    if (Buffer.byteLength(indexXml) > MAX_SITEMAP_BYTES) {
      throw new Error(`Sitemap index exceeds ${MAX_SITEMAP_BYTES} bytes`);
    }
    await atomicWrite(destination, indexXml);
    generatedFiles.push(
      relativeOutputPath(outputDir, destination),
      ...chunkDestinations.map((chunkPath) => relativeOutputPath(outputDir, chunkPath)),
    );
  }

  const previous = await readManifest(outputDir);
  const current = new Set(generatedFiles);
  await mapConcurrent(
    previous.files.filter((file) => !current.has(file)),
    32,
    async (file) => rm(outputPath(outputDir, file), { force: true }),
  );
  const sitemapUrl = resolveLocation(relativeOutputPath(outputDir, destination), baseUrl);
  const robots = await updateRobots(outputDir, previous.robots, config.robots, sitemapUrl);
  await atomicWrite(
    outputPath(outputDir, MANIFEST_PATH),
    `${JSON.stringify({ files: generatedFiles, ...(robots ? { robots } : {}) }, null, 2)}\n`,
  );
  return destination;
}
