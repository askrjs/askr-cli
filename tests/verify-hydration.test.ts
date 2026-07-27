import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/bin/cli";
import { parseVerifyHydrationArgs, runVerifyHydrationCli } from "../src/bin/verify-hydration";

const roots: string[] = [];
const browserTestTimeout = 30_000;

function io() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    value: {
      log: (...values: unknown[]) => logs.push(values.join(" ")),
      error: (...values: unknown[]) => errors.push(values.join(" ")),
    },
    logs,
    errors,
  };
}

async function outputFixture(
  documents: Record<string, string>,
): Promise<{ root: string; outputDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-verify-hydration-"));
  roots.push(root);
  const outputDir = path.join(root, "dist");
  const routes = [];
  for (const [route, document] of Object.entries(documents)) {
    const filePath = route === "/" ? "index.html" : `${route.replace(/^\/+/, "")}/index.html`;
    const absolute = path.join(outputDir, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, document);
    routes.push({ path: route, filePath, status: "success" });
  }
  await fs.writeFile(
    path.join(outputDir, "metadata.json"),
    `${JSON.stringify({ routes }, null, 2)}\n`,
  );
  return { root, outputDir };
}

function document(body: string, script = ""): string {
  return `<!doctype html>
    <html>
      <head><link rel="icon" href="data:," /></head>
      <body>
        <div id="app">${body}</div>
        ${script ? `<script type="module">${script}</script>` : ""}
      </body>
    </html>`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("verify hydration", () => {
  it("parses route sets and rejects invalid timeouts", () => {
    const defaultCwd = path.resolve("/workspace");
    expect(
      parseVerifyHydrationArgs(
        [
          "--cwd",
          "fixture",
          "--output",
          ".askr/site",
          "--route",
          "/",
          "--route",
          "/docs",
          "--root",
          "#root",
          "--no-build",
          "--timeout",
          "2500",
        ],
        defaultCwd,
      ),
    ).toMatchObject({
      cwd: path.resolve(defaultCwd, "fixture"),
      outputDir: path.resolve(defaultCwd, "fixture", ".askr", "site"),
      routes: ["/", "/docs"],
      rootSelector: "#root",
      build: false,
      timeoutMs: 2500,
      errors: [],
    });
    expect(parseVerifyHydrationArgs(["--timeout", "0"], "/workspace").errors).toEqual([
      "--timeout must be a positive integer",
    ]);
  });

  it("dispatches help through the unified CLI", async () => {
    const output = io();
    expect(await runCli(["verify-hydration", "--help"], output.value)).toBe(0);
    expect(output.errors).toEqual([]);
    expect(output.logs.join("\n")).toContain("askr verify-hydration");
  });

  it(
    "accepts structural matches across a metadata route set",
    async () => {
      const fixture = await outputFixture({
        "/": document(
          `<main><p>static text</p></main>
         <noscript><aside>JavaScript fallback</aside></noscript>`,
          `document.querySelector("p").textContent = "hydrated text";
         document.querySelector("p").className = "ready";
         document.querySelector("p").setAttribute("aria-live", "polite");`,
        ),
        "/docs": document("<main><article><h1>Docs</h1></article></main>"),
      });
      const output = io();
      const runBuild = vi.fn(async () => undefined);

      const code = await runVerifyHydrationCli(
        ["--cwd", fixture.root, "--output", fixture.outputDir, "--timeout", "2500"],
        { runBuild },
        output.value,
      );

      expect(code, output.errors.join("\n")).toBe(0);
      expect(runBuild).toHaveBeenCalledWith(fixture.root, "build");
      expect(output.errors).toEqual([]);
      expect(output.logs).toEqual(["Verified hydration DOM for 2 route(s)."]);
    },
    browserTestTimeout,
  );

  it(
    "fails when hydration migrates a node into the wrong sibling container",
    async () => {
      const fixture = await outputFixture({
        "/": document("<main><p>Stable</p></main>"),
        "/broken": document(
          `<main>
          <section><span>Owned by section</span></section>
          <aside></aside>
        </main>`,
          `const span = document.querySelector("section span");
         document.querySelector("aside").append(span);`,
        ),
      });
      const output = io();

      const code = await runVerifyHydrationCli(
        [
          "--cwd",
          fixture.root,
          "--output",
          fixture.outputDir,
          "--route",
          "/broken",
          "--no-build",
          "--timeout",
          "2500",
        ],
        {},
        output.value,
      );

      expect(code).toBe(1);
      expect(output.errors.join("\n")).toContain("/broken: DOM diverged");
      expect(output.errors.join("\n")).toContain("static:");
      expect(output.errors.join("\n")).toContain("hydrated:");
      expect(output.errors.join("\n")).not.toContain("/: DOM diverged");
    },
    browserTestTimeout,
  );

  it(
    "fails closed on browser errors and hydration timeouts",
    async () => {
      const failed = await outputFixture({
        "/error": document(
          "<main />",
          `console.error("hydration console failure");
         throw new Error("hydration exploded");`,
        ),
      });
      const errorOutput = io();
      expect(
        await runVerifyHydrationCli(
          ["--cwd", failed.root, "--output", failed.outputDir, "--no-build", "--timeout", "2500"],
          {},
          errorOutput.value,
        ),
      ).toBe(1);
      expect(errorOutput.errors.join("\n")).toContain("hydration exploded");
      expect(errorOutput.errors.join("\n")).toContain("hydration console failure");

      const stalled = await outputFixture({
        "/stalled": document("<main />", "globalThis.requestAnimationFrame = () => 0;"),
      });
      const timeoutOutput = io();
      expect(
        await runVerifyHydrationCli(
          ["--cwd", stalled.root, "--output", stalled.outputDir, "--no-build", "--timeout", "100"],
          {},
          timeoutOutput.value,
        ),
      ).toBe(1);
      expect(timeoutOutput.errors.join("\n")).toMatch(/timeout|Timeout/i);
    },
    browserTestTimeout,
  );

  it("closes the static server when browser launch fails", async () => {
    const fixture = await outputFixture({ "/": document("<main />") });
    const close = vi.fn(async () => undefined);
    const output = io();

    expect(
      await runVerifyHydrationCli(
        ["--cwd", fixture.root, "--output", fixture.outputDir, "--no-build"],
        {
          startServer: async () => ({ origin: "http://127.0.0.1:1", close }),
          launchBrowser: async () => {
            throw new Error("browser unavailable");
          },
        },
        output.value,
      ),
    ).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(output.errors).toEqual(["Error: browser unavailable"]);
  });

  it("rejects route metadata that escapes the output directory", async () => {
    const fixture = await outputFixture({ "/": document("<main />") });
    await fs.writeFile(
      path.join(fixture.outputDir, "metadata.json"),
      `${JSON.stringify({ routes: [{ path: "/", filePath: "../outside.html" }] })}\n`,
    );
    const output = io();

    expect(
      await runVerifyHydrationCli(
        ["--cwd", fixture.root, "--output", fixture.outputDir, "--no-build"],
        {},
        output.value,
      ),
    ).toBe(1);
    expect(output.errors.join("\n")).toContain("outside the SSG output directory");
  });
});
