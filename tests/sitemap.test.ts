import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSitemap, removeGeneratedSitemap } from "../src/ssg/sitemap";

const temporaryDirectories: string[] = [];

async function outputDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "askr-sitemap-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("SSG sitemap generation", () => {
  it("should populate canonical route metadata given a successful SSG build", async () => {
    const outputDir = await outputDirectory();
    await generateSitemap(
      outputDir,
      "https://example.com/docs/",
      [
        { path: "/guide", filePath: "guide/index.html", status: "success" },
        { path: "/", filePath: "index.html", status: "skipped" },
        { path: "/404", filePath: "404/index.html", status: "success" },
        { path: "/*", filePath: "wildcard/index.html", status: "success" },
        { path: "/broken", filePath: "broken/index.html", status: "error" },
      ],
      {
        defaults: { changeFrequency: "weekly", priority: 0.5 },
        routes: {
          "/404": false,
          "/guide": {
            lastModified: "2026-07-18",
            priority: 0.8,
            alternates: {
              en: "/guide",
              fr: "/fr/guide",
              "x-default": "/guide",
            },
          },
        },
      },
    );

    const sitemap = await fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8");
    expect(sitemap).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(sitemap).toContain("<loc>https://example.com/docs/</loc>");
    expect(sitemap).toContain("<loc>https://example.com/docs/guide</loc>");
    expect(sitemap).toContain("<lastmod>2026-07-18</lastmod>");
    expect(sitemap).toContain("<changefreq>weekly</changefreq>");
    expect(sitemap).toContain("<priority>0.8</priority>");
    expect(sitemap).toContain('hreflang="fr" href="https://example.com/docs/fr/guide"');
    expect(sitemap).not.toContain("404");
    expect(sitemap).not.toContain("broken");
  });

  it("should escape XML and honor resolver exclusions and canonical overrides", async () => {
    const outputDir = await outputDirectory();
    await generateSitemap(
      outputDir,
      "https://example.com",
      [
        { path: "/products?a&b", filePath: "products/index.html", status: "success" },
        { path: "/private", filePath: "private/index.html", status: "success" },
      ],
      {
        resolve: ({ path: routePath }) =>
          routePath === "/private" ? false : { url: "https://canonical.example/products?a=1&b=2" },
      },
    );

    const sitemap = await fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("<loc>https://canonical.example/products?a=1&amp;b=2</loc>");
    expect(sitemap).not.toContain("private");
  });

  it.each([
    ["an invalid origin", "example.com", {}, /absolute HTTP\(S\) URL/],
    [
      "an invalid priority",
      "https://example.com",
      { defaults: { priority: 2 } },
      /between 0 and 1/,
    ],
    [
      "an escaping output path",
      "https://example.com",
      { output: "../sitemap.xml" },
      /must stay inside/,
    ],
    [
      "an absolute output path",
      "https://example.com",
      { output: path.resolve("sitemap.xml") },
      /must be relative/,
    ],
  ])("should reject %s", async (_label, siteUrl, config, expected) => {
    await expect(
      generateSitemap(
        await outputDirectory(),
        siteUrl,
        [{ path: "/", filePath: "index.html", status: "success" }],
        config,
      ),
    ).rejects.toThrow(expected);
  });

  it("should reject duplicate canonical URLs", async () => {
    await expect(
      generateSitemap(
        await outputDirectory(),
        "https://example.com",
        [
          { path: "/one", filePath: "one/index.html", status: "success" },
          { path: "/two", filePath: "two/index.html", status: "success" },
        ],
        { routes: { "/one": { url: "/same" }, "/two": { url: "/same" } } },
      ),
    ).rejects.toThrow(/duplicate canonical URL/);
  });

  it.each(["2026-02-30", "2025-13-01", "2025-01-01T24:00:00Z", "2025-01-01T12:60:00Z"])(
    "should reject impossible calendar value %s",
    async (lastModified) => {
      await expect(
        generateSitemap(
          await outputDirectory(),
          "https://example.com",
          [{ path: "/", filePath: "index.html", status: "success" }],
          { defaults: { lastModified } },
        ),
      ).rejects.toThrow(/Invalid sitemap lastModified/);
    },
  );

  it("should partition large route sets and advertise the sitemap index in robots.txt", async () => {
    const outputDir = await outputDirectory();
    await generateSitemap(
      outputDir,
      "https://example.com/docs/",
      ["a", "b", "c", "d", "e"].map((name) => ({
        path: `/${name}`,
        filePath: `${name}/index.html`,
        status: "success",
      })),
      { limits: { urlsPerFile: 2 } },
    );

    const index = await fs.readFile(path.join(outputDir, "sitemap.xml"), "utf8");
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("https://example.com/docs/sitemap-1.xml");
    expect(index).toContain("https://example.com/docs/sitemap-3.xml");
    expect(await fs.readFile(path.join(outputDir, "sitemap-1.xml"), "utf8")).toContain(
      "https://example.com/docs/a",
    );
    expect(await fs.readFile(path.join(outputDir, "robots.txt"), "utf8")).toContain(
      "Sitemap: https://example.com/docs/sitemap.xml",
    );
    expect(
      JSON.parse(await fs.readFile(path.join(outputDir, ".askr/sitemap-manifest.json"), "utf8"))
        .files,
    ).toEqual(["sitemap.xml", "sitemap-1.xml", "sitemap-2.xml", "sitemap-3.xml"]);
  });

  it("should remove stale sitemap files and preserve custom robots rules", async () => {
    const outputDir = await outputDirectory();
    await fs.writeFile(
      path.join(outputDir, "robots.txt"),
      "User-agent: private-bot\nDisallow: /private\nSitemap: https://stale.example/map.xml\n",
    );
    const routes = ["one", "two", "three"].map((name) => ({
      path: `/${name}`,
      filePath: `${name}/index.html`,
      status: "success",
    }));
    await generateSitemap(outputDir, "https://example.com", routes, {
      limits: { urlsPerFile: 1 },
    });
    await generateSitemap(outputDir, "https://example.com", routes.slice(0, 1), {
      output: "seo/site-map.xml",
    });

    await expect(fs.access(path.join(outputDir, "sitemap-1.xml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const robots = await fs.readFile(path.join(outputDir, "robots.txt"), "utf8");
    expect(robots).toContain("Disallow: /private");
    expect(robots.match(/^Sitemap:/gm)).toHaveLength(1);
    expect(robots).toContain("Sitemap: https://example.com/seo/site-map.xml");
  });

  it("should bound concurrent async route metadata resolution", async () => {
    const outputDir = await outputDirectory();
    let active = 0;
    let peak = 0;
    await generateSitemap(
      outputDir,
      "https://example.com",
      Array.from({ length: 20 }, (_, index) => ({
        path: `/route-${index}`,
        filePath: `route-${index}/index.html`,
        status: "success",
      })),
      {
        resolverConcurrency: 3,
        async resolve() {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return {};
        },
      },
    );
    expect(peak).toBe(3);
  });

  it("should remove owned sitemap artifacts without deleting unrelated robots rules", async () => {
    const outputDir = await outputDirectory();
    await fs.writeFile(path.join(outputDir, "robots.txt"), "User-agent: *\nDisallow: /private\n");
    await generateSitemap(outputDir, "https://example.com", [
      { path: "/", filePath: "index.html", status: "success" },
    ]);
    await removeGeneratedSitemap(outputDir);

    await expect(fs.access(path.join(outputDir, "sitemap.xml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.access(path.join(outputDir, ".askr/sitemap-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(outputDir, "robots.txt"), "utf8")).toBe(
      "User-agent: *\nDisallow: /private\n",
    );
  });
});
