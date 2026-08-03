import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const allTemplates = ["full-stack", "spa", "ssr", "ssg", "startkit"];

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

test("packed CLI passes checks for every shipped template", async () => {
  const selected = process.env.ASKR_TEMPLATE
    ? allTemplates.filter((template) => template === process.env.ASKR_TEMPLATE)
    : allTemplates;
  expect(selected, `Unknown ASKR_TEMPLATE: ${process.env.ASKR_TEMPLATE}`).not.toHaveLength(0);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-packed-templates-"));
  try {
    await run("npm", ["run", "build"], repository);
    const packed = await run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", root],
      repository,
    );
    const archive = path.join(root, packed.trim().split(/\r?\n/).at(-1)!);

    for (const template of selected) {
      const fixtureRoot = path.join(root, template);
      const project = path.join(fixtureRoot, `fixture-${template}`);
      await fs.mkdir(fixtureRoot, { recursive: true });
      await run(
        process.execPath,
        [
          path.join(repository, "dist", "cli.js"),
          "create",
          template,
          `fixture-${template}`,
          "--dir",
          project,
          "--no-install",
          "--no-skills",
        ],
        fixtureRoot,
      );

      const manifestPath = path.join(project, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        devDependencies?: Record<string, string>;
      };
      manifest.devDependencies = {
        ...manifest.devDependencies,
        "@askrjs/cli": `file:${archive}`,
      };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], project);
      await run("npm", ["run", "check"], project);

      if (template === "ssg") {
        for (const relative of ["sitemap.xml", "robots.txt", ".askr/sitemap-manifest.json"]) {
          await fs.access(path.join(project, "dist", relative));
        }
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 180_000);
