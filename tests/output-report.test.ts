import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectSsgDocuments } from "../src/ssg/documents";
import { writeSsgOutputReport } from "../src/ssg/output-report";

const directories: string[] = [];

async function fixture(): Promise<{
  outputDir: string;
  routes: Array<{ path: string; filePath: string; status: string }>;
}> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "askr-output-report-"));
  directories.push(outputDir);
  await fs.mkdir(path.join(outputDir, "guide"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "assets"), { recursive: true });
  await fs.mkdir(path.join(outputDir, ".askr"), { recursive: true });
  const hydration = JSON.stringify({ version: 1, route: { value: "x".repeat(40) } });
  await fs.writeFile(
    path.join(outputDir, "guide/index.html"),
    '<!doctype html><link rel="stylesheet" href="/assets/app.css">' +
      '<link rel="modulepreload" href="/assets/chunk.js">' +
      '<script type="module" src="/assets/app.js"></script>' +
      `<main>${"content ".repeat(30)}</main>` +
      `<script type="application/json" data-askr-render-data="true">${hydration}</script>`,
  );
  await fs.writeFile(
    path.join(outputDir, "index.html"),
    '<link rel="stylesheet" href="/assets/app.css">' +
      '<script type="module" src="/assets/app.js"></script><main>Home</main>',
  );
  await fs.writeFile(
    path.join(outputDir, "assets/app.js"),
    "export const app = 'app';\n".repeat(8),
  );
  await fs.writeFile(path.join(outputDir, "assets/chunk.js"), "export const chunk = 1;\n");
  await fs.writeFile(path.join(outputDir, "assets/app.css"), ".app{color:rebeccapurple}\n");
  await fs.writeFile(path.join(outputDir, "assets/photo.bin"), Buffer.alloc(64, 7));
  await fs.writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({ internal: true }));
  await fs.writeFile(path.join(outputDir, ".askr/sitemap-manifest.json"), "{}");
  await fs.writeFile(path.join(outputDir, ".askr/ssg-manifest.json"), "{}");
  await fs.writeFile(path.join(outputDir, ".askr/user-asset.bin"), "reported");
  return {
    outputDir,
    routes: [
      { path: "/", filePath: "index.html", status: "skipped" },
      { path: "/guide", filePath: "guide/index.html", status: "success" },
    ],
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("SSG output report", () => {
  it("should report the complete stage deterministically with gzip and hydration metrics", async () => {
    const { outputDir, routes } = await fixture();
    const inspections = await inspectSsgDocuments(outputDir, routes);
    const destination = await writeSsgOutputReport(outputDir, routes, inspections, {
      largestPages: 2,
      largestAssets: 3,
    });
    const first = await fs.readFile(destination, "utf8");
    const report = JSON.parse(first);

    expect(report.routes.map((route: { route: string }) => route.route)).toEqual(["/", "/guide"]);
    expect(report.routes[1].html.raw).toBeGreaterThan(report.routes[1].html.gzip);
    expect(report.routes[1].hydration.raw).toBeGreaterThan(0);
    expect(report.routes[1].hydration.share).toBeGreaterThan(0);
    expect(
      report.routes[1].initial.javascript.map((asset: { path: string }) => asset.path),
    ).toEqual(["assets/app.js", "assets/chunk.js"]);
    expect(report.routes[1].initial.css[0].path).toBe("assets/app.css");
    expect(report.routes[0].initial.javascript[0].path).toBe("assets/app.js");
    expect(report.routes[0].initial.css[0].path).toBe("assets/app.css");
    expect(report.aggregate.javascript.raw).toBeGreaterThan(0);
    expect(report.aggregate.css.raw).toBeGreaterThan(0);
    expect(report.assets.map((asset: { path: string }) => asset.path)).not.toContain(
      "metadata.json",
    );
    expect(report.assets.map((asset: { path: string }) => asset.path)).not.toContain(
      ".askr/sitemap-manifest.json",
    );
    expect(report.assets.map((asset: { path: string }) => asset.path)).not.toContain(
      ".askr/ssg-manifest.json",
    );
    expect(report.assets.map((asset: { path: string }) => asset.path)).toContain(
      ".askr/user-asset.bin",
    );
    expect(report.largest.pages).toHaveLength(2);
    expect(report.largest.assets).toHaveLength(3);

    await writeSsgOutputReport(outputDir, routes, inspections, {
      largestPages: 2,
      largestAssets: 3,
    });
    expect(await fs.readFile(destination, "utf8")).toBe(first);
  });

  it("should resolve relative initial assets from portable document paths", async () => {
    const { outputDir, routes } = await fixture();
    await fs.writeFile(
      path.join(outputDir, "guide/index.html"),
      '<link rel="stylesheet" href="../assets/app.css">' +
        '<script type="module" src="../assets/app.js"></script>',
    );
    const inspections = await inspectSsgDocuments(outputDir, routes);
    const guide = inspections.get("/guide")!;
    inspections.set("/guide", { ...guide, filePath: "guide\\index.html" });

    const destination = await writeSsgOutputReport(outputDir, routes, inspections);
    const report = JSON.parse(await fs.readFile(destination, "utf8"));

    expect(report.routes[1].initial.javascript[0].path).toBe("assets/app.js");
    expect(report.routes[1].initial.css[0].path).toBe("assets/app.css");
  });

  it("should reject missing local initial assets instead of dropping the reference", async () => {
    const { outputDir, routes } = await fixture();
    await fs.writeFile(
      path.join(outputDir, "guide/index.html"),
      '<script type="module" src="../assets/missing.js"></script>',
    );
    const inspections = await inspectSsgDocuments(outputDir, routes);

    await expect(writeSsgOutputReport(outputDir, routes, inspections)).rejects.toThrow(
      /route \/guide references missing javascript asset assets\/missing\.js/,
    );
  });

  it("should ignore emitted assets whose type does not match the reference", async () => {
    const { outputDir, routes } = await fixture();
    await fs.writeFile(path.join(outputDir, "assets/data.json"), "{}\n");
    await fs.writeFile(
      path.join(outputDir, "guide/index.html"),
      '<script type="module" src="../assets/data.json"></script>',
    );
    const inspections = await inspectSsgDocuments(outputDir, routes);

    await expect(writeSsgOutputReport(outputDir, routes, inspections)).resolves.toBeTruthy();
  });

  it("should list every configured budget violation and withhold the report", async () => {
    const { outputDir, routes } = await fixture();
    const inspections = await inspectSsgDocuments(outputDir, routes);

    await expect(
      writeSsgOutputReport(outputDir, routes, inspections, {
        budgets: {
          routes: { raw: 1, gzip: 1 },
          routeOverrides: { "/": false, "/guide": { raw: 2 } },
          hydration: { share: 0, routes: { "/": false } },
          assets: { "assets/app.js": { raw: 1, gzip: 1 } },
          aggregate: { javascript: { raw: 1, gzip: 1 }, css: { raw: 1 } },
        },
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /route \/guide HTML raw[\s\S]*route \/guide HTML gzip[\s\S]*hydration share[\s\S]*asset assets\/app\.js raw[\s\S]*asset assets\/app\.js gzip[\s\S]*aggregate JavaScript raw[\s\S]*aggregate JavaScript gzip[\s\S]*aggregate CSS raw/,
        ),
      }),
    );
    await expect(fs.access(path.join(outputDir, ".askr/ssg-output.json"))).rejects.toThrow();
  });

  it("should reject unknown budget measurements", async () => {
    const { outputDir, routes } = await fixture();
    const inspections = await inspectSsgDocuments(outputDir, routes);

    await expect(
      writeSsgOutputReport(outputDir, routes, inspections, {
        budgets: { routes: { graaw: 1 } as never },
      }),
    ).rejects.toThrow(/routes\.graaw is not supported; use raw or gzip/);
  });
});
