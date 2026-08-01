import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSsgDocuments } from "../src/ssg/documents";
import { generateSitemap } from "../src/ssg/sitemap";

const directories: string[] = [];

async function outputDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "askr-ssg-documents-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function writeRoute(outputDir: string, filePath: string, html: string): Promise<void> {
  const destination = path.join(outputDir, filePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, html);
}

describe("generated SSG document inspection", () => {
  it("should use one rendered canonical and expose it to sitemap resolvers", async () => {
    const outputDir = await outputDirectory();
    const routes = [{ path: "/guide", filePath: "guide/index.html", status: "success" }];
    await writeRoute(
      outputDir,
      "guide/index.html",
      '<!doctype html><link rel="canonical" href="guide/"><main>Guide</main>',
    );
    const inspections = await inspectSsgDocuments(outputDir, routes);
    let resolverCanonical: string | undefined;

    await generateSitemap(
      outputDir,
      "https://example.com/docs/",
      routes.map((route) => ({ ...route, canonical: inspections.get(route.path)?.canonical })),
      {
        resolve(context) {
          resolverCanonical = context.canonical;
          return {};
        },
      },
    );

    expect(resolverCanonical).toBe("https://example.com/docs/guide/");
    await expect(fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8")).resolves.toContain(
      "<loc>https://example.com/docs/guide/</loc>",
    );
  });

  it("should fall back to the concrete route when no canonical is rendered", async () => {
    const outputDir = await outputDirectory();
    const routes = [{ path: "/guide", filePath: "guide/index.html", status: "success" }];
    await writeRoute(outputDir, "guide/index.html", "<main>Guide</main>");
    const inspections = await inspectSsgDocuments(outputDir, routes);

    await generateSitemap(
      outputDir,
      "https://example.com/docs/",
      routes.map((route) => ({ ...route, canonical: inspections.get(route.path)?.canonical })),
    );

    await expect(fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8")).resolves.toContain(
      "<loc>https://example.com/docs/guide</loc>",
    );
  });

  it("should reject duplicate rendered canonicals before sitemap publication", async () => {
    const outputDir = await outputDirectory();
    const routes = [{ path: "/guide", filePath: "guide/index.html", status: "success" }];
    await writeRoute(
      outputDir,
      "guide/index.html",
      '<link rel="canonical" href="/guide"><link rel="canonical alternate" href="/other">',
    );

    await expect(inspectSsgDocuments(outputDir, routes)).rejects.toThrow(
      /\/guide.*multiple canonical links.*\/guide.*\/other/,
    );
  });

  it.each([
    ["exact override", { routes: { "/guide": { url: "/wrong" } } }],
    ["resolver override", { resolve: () => ({ url: "/wrong" }) }],
  ])("should reject a rendered canonical mismatch from %s", async (_label, config) => {
    await expect(
      generateSitemap(
        await outputDirectory(),
        "https://example.com",
        [
          {
            path: "/guide",
            filePath: "guide/index.html",
            status: "success",
            canonical: "/guide/",
          },
        ],
        config,
      ),
    ).rejects.toThrow(/Sitemap URL mismatch.*\/guide\/.*\/wrong/);
  });

  it("should compare root-relative overrides with document canonical URL semantics", async () => {
    const outputDir = await outputDirectory();
    await generateSitemap(
      outputDir,
      "https://example.com/docs/",
      [
        {
          path: "/guide",
          filePath: "guide/index.html",
          status: "success",
          canonical: "/guide/",
        },
      ],
      { routes: { "/guide": { url: "/guide/" } } },
    );

    await expect(fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8")).resolves.toContain(
      "<loc>https://example.com/guide/</loc>",
    );
  });
});
