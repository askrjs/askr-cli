import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { InspectableRoute, SsgDocumentInspection } from "./documents";

export interface SsgByteBudget {
  raw?: number;
  gzip?: number;
}

export interface SsgOutputBudgets {
  /** Default raw/gzip HTML limits for every route. */
  routes?: SsgByteBudget;
  /** Exact route overrides merged with defaults; false exempts a route. */
  routeOverrides?: Readonly<Record<string, SsgByteBudget | false>>;
  hydration?: {
    /** Maximum hydration bytes as a 0..1 share of raw HTML. */
    share?: number;
    /** Exact share overrides; false exempts a route. */
    routes?: Readonly<Record<string, number | false>>;
  };
  /** Exact emitted asset raw/gzip limits; false exempts an asset. */
  assets?: Readonly<Record<string, SsgByteBudget | false>>;
  aggregate?: {
    javascript?: SsgByteBudget;
    css?: SsgByteBudget;
  };
}

export interface SsgOutputReportConfig {
  budgets?: SsgOutputBudgets;
  /** Number of largest pages retained in the summary. Defaults to 20. */
  largestPages?: number;
  /** Number of largest assets retained in the summary. Defaults to 20. */
  largestAssets?: number;
}

export interface SsgOutputSize {
  raw: number;
  gzip: number;
}

export interface SsgOutputAsset extends SsgOutputSize {
  path: string;
  type: "javascript" | "css" | "other";
}

export interface SsgOutputRoute {
  route: string;
  filePath: string;
  html: SsgOutputSize;
  hydration: { raw: number; share: number };
  initial: { javascript: SsgOutputAsset[]; css: SsgOutputAsset[] };
}

export interface SsgOutputReport {
  version: 1;
  routes: SsgOutputRoute[];
  assets: SsgOutputAsset[];
  aggregate: { javascript: SsgOutputSize; css: SsgOutputSize };
  largest: { pages: SsgOutputRoute[]; assets: SsgOutputAsset[] };
}

const REPORT_PATH = ".askr/ssg-output.json";
const INTERNAL_OUTPUTS = new Set(["metadata.json", ".askr/sitemap-manifest.json", REPORT_PATH]);

function outputType(filePath: string): SsgOutputAsset["type"] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return "javascript";
  }
  return extension === ".css" ? "css" : "other";
}

function size(value: string | Buffer): SsgOutputSize {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return { raw: buffer.byteLength, gzip: gzipSync(buffer, { level: 9 }).byteLength };
}

async function emittedFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await emittedFiles(directory, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function isReportableAsset(filePath: string): boolean {
  return !filePath.toLowerCase().endsWith(".html") && !INTERNAL_OUTPUTS.has(filePath);
}

export async function removeSsgOutputReport(outputDir: string): Promise<void> {
  await fs.rm(path.join(outputDir, REPORT_PATH), { force: true });
}

function localReference(reference: string, documentPath: string): string | undefined {
  let resolved: URL;
  try {
    const portableDocumentPath = documentPath.replaceAll("\\", "/");
    const base = new URL(
      path.posix.dirname(`/${portableDocumentPath}`) + "/",
      "https://askr.invalid",
    );
    resolved = new URL(reference, base);
  } catch {
    return undefined;
  }
  if (resolved.origin !== "https://askr.invalid") return undefined;
  try {
    return decodeURIComponent(resolved.pathname).replace(/^\/+/, "");
  } catch {
    return undefined;
  }
}

function positiveCount(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
}

function validateByteBudget(budget: SsgByteBudget | undefined, label: string): void {
  for (const [measurement, limit] of Object.entries(budget ?? {})) {
    if (measurement !== "raw" && measurement !== "gzip") {
      throw new Error(`${label}.${measurement} is not supported; use raw or gzip`);
    }
    if (!Number.isSafeInteger(limit) || Number(limit) < 0) {
      throw new Error(`${label}.${measurement} must be a non-negative integer byte limit`);
    }
  }
}

function validateConfig(config: SsgOutputReportConfig): void {
  const budgets = config.budgets;
  validateByteBudget(budgets?.routes, "outputReport.budgets.routes");
  for (const [route, budget] of Object.entries(budgets?.routeOverrides ?? {})) {
    if (budget !== false) validateByteBudget(budget, `route override ${route}`);
  }
  for (const [asset, budget] of Object.entries(budgets?.assets ?? {})) {
    if (budget !== false) validateByteBudget(budget, `asset budget ${asset}`);
  }
  validateByteBudget(budgets?.aggregate?.javascript, "aggregate javascript budget");
  validateByteBudget(budgets?.aggregate?.css, "aggregate css budget");
  const hydrationShares: Array<[string, number | false | undefined]> = [
    ["*", budgets?.hydration?.share],
    ...Object.entries(budgets?.hydration?.routes ?? {}),
  ];
  for (const [route, share] of hydrationShares) {
    if (
      share !== undefined &&
      share !== false &&
      (!Number.isFinite(share) || share < 0 || share > 1)
    ) {
      throw new Error(`hydration share for ${route} must be from 0 through 1`);
    }
  }
  positiveCount(config.largestPages, 20, "outputReport.largestPages");
  positiveCount(config.largestAssets, 20, "outputReport.largestAssets");
}

function budgetViolations(report: SsgOutputReport, budgets: SsgOutputBudgets = {}): string[] {
  const violations: string[] = [];
  const check = (
    subject: string,
    measured: SsgOutputSize,
    budget: SsgByteBudget | undefined,
    remediation: string,
  ) => {
    for (const measurement of ["raw", "gzip"] as const) {
      const limit = budget?.[measurement];
      if (limit !== undefined && measured[measurement] > limit) {
        violations.push(
          `${subject} ${measurement}: ${measured[measurement]} B > ${limit} B. ${remediation}`,
        );
      }
    }
  };

  for (const route of report.routes) {
    const override = budgets.routeOverrides?.[route.route];
    if (override !== false) {
      check(
        `route ${route.route} HTML`,
        route.html,
        { ...budgets.routes, ...override },
        "Reduce rendered markup/data or raise the exact route budget.",
      );
    }
    const shareOverride = budgets.hydration?.routes?.[route.route];
    const shareLimit =
      shareOverride === false ? undefined : (shareOverride ?? budgets.hydration?.share);
    if (shareLimit !== undefined && route.hydration.share > shareLimit) {
      violations.push(
        `route ${route.route} hydration share: ${route.hydration.share} > ${shareLimit}. Use route dehydrate() to omit server-only data or raise the exact route limit.`,
      );
    }
  }

  const assets = new Map(report.assets.map((asset) => [asset.path, asset]));
  for (const [assetPath, budget] of Object.entries(budgets.assets ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (budget === false) continue;
    const asset = assets.get(assetPath);
    if (!asset) continue;
    check(
      `asset ${assetPath}`,
      asset,
      budget,
      "Split, compress, or lazy-load the asset, or raise its exact budget.",
    );
  }
  check(
    "aggregate JavaScript",
    report.aggregate.javascript,
    budgets.aggregate?.javascript,
    "Code-split initial JavaScript or raise the aggregate budget.",
  );
  check(
    "aggregate CSS",
    report.aggregate.css,
    budgets.aggregate?.css,
    "Remove or split unused CSS, or raise the aggregate budget.",
  );
  return violations;
}

export async function writeSsgOutputReport(
  outputDir: string,
  routes: readonly InspectableRoute[],
  inspections: ReadonlyMap<string, SsgDocumentInspection>,
  config: SsgOutputReportConfig = {},
): Promise<string> {
  validateConfig(config);
  const assets: SsgOutputAsset[] = [];
  for (const filePath of (await emittedFiles(outputDir)).filter(isReportableAsset)) {
    const measured = size(await fs.readFile(path.join(outputDir, filePath)));
    assets.push({ path: filePath, type: outputType(filePath), ...measured });
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  const assetMap = new Map(assets.map((asset) => [asset.path, asset]));

  const outputRoutes: SsgOutputRoute[] = [];
  for (const route of [...routes].sort((left, right) => left.path.localeCompare(right.path))) {
    const inspection = inspections.get(route.path);
    if (!inspection) continue;
    const html = inspection.html;
    const referenced = (references: readonly string[], type: SsgOutputAsset["type"]) =>
      references
        .map((reference) => localReference(reference, inspection.filePath))
        .filter((reference): reference is string => Boolean(reference))
        .map((reference) => assetMap.get(reference))
        .filter((asset): asset is SsgOutputAsset => asset?.type === type)
        .sort((left, right) => left.path.localeCompare(right.path));
    outputRoutes.push({
      route: route.path,
      filePath: inspection.filePath,
      html,
      hydration: {
        raw: inspection.hydrationBytes,
        share: html.raw === 0 ? 0 : Number((inspection.hydrationBytes / html.raw).toFixed(6)),
      },
      initial: {
        javascript: referenced(inspection.javascript, "javascript"),
        css: referenced(inspection.css, "css"),
      },
    });
  }

  const total = (type: SsgOutputAsset["type"]): SsgOutputSize =>
    assets
      .filter((asset) => asset.type === type)
      .reduce((sum, asset) => ({ raw: sum.raw + asset.raw, gzip: sum.gzip + asset.gzip }), {
        raw: 0,
        gzip: 0,
      });
  const byLargest = <T extends { raw: number }>(
    values: readonly T[],
    count: number,
    name: (value: T) => string,
  ) =>
    [...values]
      .sort((left, right) => right.raw - left.raw || name(left).localeCompare(name(right)))
      .slice(0, count);
  const report: SsgOutputReport = {
    version: 1,
    routes: outputRoutes,
    assets,
    aggregate: { javascript: total("javascript"), css: total("css") },
    largest: {
      pages: byLargest(
        outputRoutes.map((route) => ({ ...route, raw: route.html.raw })),
        positiveCount(config.largestPages, 20, "outputReport.largestPages"),
        (route) => route.route,
      ).map(({ raw: _raw, ...route }) => route),
      assets: byLargest(
        assets,
        positiveCount(config.largestAssets, 20, "outputReport.largestAssets"),
        (asset) => asset.path,
      ),
    },
  };

  const violations = budgetViolations(report, config.budgets);
  if (violations.length > 0) {
    throw new Error(
      `SSG output budgets exceeded:\n${violations.map((item) => `- ${item}`).join("\n")}`,
    );
  }

  const destination = path.join(outputDir, REPORT_PATH);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return destination;
}
