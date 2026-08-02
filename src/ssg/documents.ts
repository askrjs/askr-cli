import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

export interface InspectableRoute {
  path: string;
  filePath: string;
  status: string;
}

export interface SsgDocumentInspection {
  route: string;
  filePath: string;
  html: { raw: number; gzip: number };
  canonical?: string;
  hydrationBytes: number;
  javascript: string[];
  css: string[];
}

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((candidate) => candidate.name.toLowerCase() === name)?.value;
}

function relTokens(element: Element): Set<string> {
  return new Set((attribute(element, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean));
}

function textContent(node: Node): string {
  if ("value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join("");
}

function walk(node: Node, visit: (element: Element) => void): void {
  if ("tagName" in node) visit(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) walk(child, visit);
  }
  if ("content" in node) walk(node.content, visit);
}

function inspectHtml(route: InspectableRoute, html: string): SsgDocumentInspection {
  const canonicals: string[] = [];
  const javascript = new Set<string>();
  const css = new Set<string>();
  let hydrationBytes = 0;
  const document = parse(html);

  walk(document, (element) => {
    if (element.tagName === "link") {
      const rel = relTokens(element);
      const href = attribute(element, "href");
      if (rel.has("canonical")) {
        if (!href?.trim()) {
          throw new Error(`Generated route ${route.path} contains a canonical link without href`);
        }
        canonicals.push(href.trim());
      }
      if (href && rel.has("stylesheet")) css.add(href);
      if (href && rel.has("modulepreload")) javascript.add(href);
      if (href && rel.has("preload")) {
        const as = attribute(element, "as")?.toLowerCase();
        if (as === "script") javascript.add(href);
        if (as === "style") css.add(href);
      }
    }
    if (element.tagName === "script") {
      const src = attribute(element, "src");
      if (src) javascript.add(src);
      if (attribute(element, "data-askr-render-data") === "true") {
        hydrationBytes += Buffer.byteLength(textContent(element));
      }
    }
  });

  if (canonicals.length > 1) {
    throw new Error(
      `Generated route ${route.path} contains multiple canonical links: ${canonicals.join(", ")}`,
    );
  }

  return {
    route: route.path,
    filePath: route.filePath,
    html: {
      raw: Buffer.byteLength(html),
      gzip: gzipSync(html, { level: 9 }).byteLength,
    },
    ...(canonicals[0] ? { canonical: canonicals[0] } : {}),
    hydrationBytes,
    javascript: [...javascript].sort(),
    css: [...css].sort(),
  };
}

function documentPath(outputDir: string, route: InspectableRoute): string {
  const root = path.resolve(outputDir);
  const resolved = path.resolve(root, route.filePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated route ${route.path} has an invalid output path: ${route.filePath}`);
  }
  return resolved;
}

export async function inspectSsgDocuments(
  outputDir: string,
  routes: readonly InspectableRoute[],
): Promise<Map<string, SsgDocumentInspection>> {
  const inspections = new Map<string, SsgDocumentInspection>();
  const included = routes
    .filter(
      (route) =>
        (route.status === "success" || route.status === "skipped") && !route.path.includes("*"),
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const route of included) {
    let html: string;
    try {
      html = await fs.readFile(documentPath(outputDir, route), "utf8");
    } catch (error) {
      throw new Error(`Unable to inspect generated document for ${route.path}: ${route.filePath}`, {
        cause: error,
      });
    }
    inspections.set(route.path, inspectHtml(route, html));
  }
  return inspections;
}
