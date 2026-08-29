import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));

async function run(
  command: string,
  args: string[],
  cwd: string,
  expectedExit = 0,
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stderr) process.stderr.write(stderr);
    if (expectedExit !== 0) throw new Error(`Expected exit ${expectedExit}, received 0.`);
    return stdout;
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    if (failure.code !== expectedExit) throw error;
    if (failure.stderr) process.stderr.write(failure.stderr);
    return failure.stdout ?? "";
  }
}

test("should ensure packed CLI works with the minimum supported Askr peer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-peer-floor-"));
  try {
    await run("npm", ["run", "build"], repository);
    const packed = await run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", root],
      repository,
    );
    const archive = path.join(root, packed.trim().split(/\r?\n/).at(-1)!);

    await fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "askr-cli-peer-floor-consumer",
          private: true,
          type: "module",
          dependencies: {
            "@askrjs/askr": "0.2.0",
            "@askrjs/cli": `file:${archive}`,
          },
        },
        null,
        2,
      )}\n`,
    );
    await fs.writeFile(
      path.join(root, "ssg.config.ts"),
      `import { createRouteRegistry, route } from "@askrjs/askr/router";

const registry = createRouteRegistry(() => {
  route("/", () => ({ type: "main", children: ["Askr peer floor"] }));
});

export const staticConfig = {
  registry,
  siteUrl: "https://example.com",
  document: ({ appHtml }) =>
    '<!doctype html><html><head><link rel="canonical" href="/"></head><body>' +
    appHtml +
    "</body></html>",
};
`,
    );

    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "src", "page.ts"),
      'export const token = "--ak-color-text";\n',
    );
    await fs.writeFile(
      path.join(root, "ignored.ts"),
      'export const token = "--ak-color-surface";\n',
    );
    await fs.writeFile(path.join(root, ".gitignore"), "ignored.ts\n");
    const analysis = JSON.parse(
      await run(path.join(root, "node_modules", ".bin", "askr"), ["analyze", "--json"], root, 1),
    );
    expect(
      analysis.diagnostics
        .filter((entry: { ruleId: string }) => entry.ruleId === "askr/no-hardcoded-theme-token")
        .map((entry: { file: string }) => entry.file),
    ).toEqual(["src/page.ts"]);

    await run(
      path.join(root, "node_modules", ".bin", "askr"),
      ["ssg", "--config", "./ssg.config.ts", "--output", "./dist"],
      root,
    );

    const [html, sitemap, report] = await Promise.all([
      fs.readFile(path.join(root, "dist", "index.html"), "utf8"),
      fs.readFile(path.join(root, "dist", "sitemap.xml"), "utf8"),
      fs.readFile(path.join(root, "dist", ".askr", "ssg-output.json"), "utf8"),
    ]);
    expect(html).toContain("Askr peer floor");
    expect(sitemap).toContain("https://example.com/");
    expect(JSON.parse(report).routes?.[0]?.route).toBe("/");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
