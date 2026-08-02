import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "..");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-peer-floor-"));

async function command(executable, args, cwd) {
  const { stdout, stderr } = await run(executable, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

try {
  await command("npm", ["run", "build"], repository);
  const packed = await command(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", root],
    repository,
  );
  const archive = path.join(root, packed.trim().split(/\r?\n/).at(-1));

  await fs.writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "askr-cli-peer-floor-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@askrjs/askr": "0.0.53",
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

  await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], root);
  await command(
    path.join(root, "node_modules", ".bin", "askr"),
    ["ssg", "--config", "./ssg.config.ts", "--output", "./dist"],
    root,
  );

  const [html, sitemap, report] = await Promise.all([
    fs.readFile(path.join(root, "dist", "index.html"), "utf8"),
    fs.readFile(path.join(root, "dist", "sitemap.xml"), "utf8"),
    fs.readFile(path.join(root, "dist", ".askr", "ssg-output.json"), "utf8"),
  ]);
  if (!html.includes("Askr peer floor")) throw new Error("peer-floor route did not render");
  if (!sitemap.includes("https://example.com/")) throw new Error("peer-floor sitemap is invalid");
  if (JSON.parse(report).routes?.[0]?.route !== "/") {
    throw new Error("peer-floor output report is invalid");
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
