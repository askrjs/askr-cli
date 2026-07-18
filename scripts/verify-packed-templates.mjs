import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "..");
const allTemplates = ["full-stack", "spa", "ssr", "ssg", "startkit"];
const templates = process.env.ASKR_TEMPLATE
  ? allTemplates.filter((template) => template === process.env.ASKR_TEMPLATE)
  : allTemplates;
if (templates.length === 0) throw new Error(`Unknown ASKR_TEMPLATE: ${process.env.ASKR_TEMPLATE}`);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-packed-templates-"));

async function command(executable, args, cwd) {
  const { stdout, stderr } = await run(executable, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

try {
  await command("npm", ["run", "build"], repository);
  const { stdout } = await run("npm", ["pack", "--ignore-scripts", "--pack-destination", root], {
    cwd: repository,
  });
  const archive = path.join(root, stdout.trim().split(/\r?\n/).at(-1));

  for (const template of templates) {
    const fixtureRoot = path.join(root, template);
    const project = path.join(fixtureRoot, `fixture-${template}`);
    await fs.mkdir(fixtureRoot, { recursive: true });
    await command(
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
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.devDependencies = {
      ...manifest.devDependencies,
      "@askrjs/cli": `file:${archive}`,
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], project);
    await command("npm", ["run", "check"], project);

    if (template === "ssg") {
      for (const relative of ["sitemap.xml", "robots.txt", ".askr/sitemap-manifest.json"]) {
        await fs.access(path.join(project, "dist", relative));
      }
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
