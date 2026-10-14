import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

import { runOwnedCommand } from "../helpers/owned-command";

interface PackagingContext {
  evidence: string;
  signal: AbortSignal;
  nextCommand: number;
}
const repository = fileURLToPath(new URL("../../", import.meta.url));
const allTemplates = ["full-stack", "spa", "ssr", "ssg", "startkit"];

async function run(
  command: string,
  args: string[],
  cwd: string,
  context: PackagingContext,
): Promise<string> {
  const npmEntry = process.env.npm_execpath;
  if (command === "npm" && !npmEntry) throw new Error("Run packaging tests through npm.");
  return runOwnedCommand({
    command: command === "npm" ? process.execPath : command,
    args: command === "npm" ? [npmEntry!, ...args] : args,
    requested: { command, args },
    cwd,
    evidence: context.evidence,
    label: `command-${++context.nextCommand}`,
    timeoutMs: 180_000,
    signal: context.signal,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function checkScopedSsgJsx(project: string, context: PackagingContext): Promise<void> {
  await fs.copyFile(
    path.join(repository, "tests", "types", "ssg-scoped-jsx.tsx"),
    path.join(project, "src", "scoped-jsx-contract.tsx"),
  );
  await fs.writeFile(
    path.join(project, "tsconfig.scoped-jsx.json"),
    `${JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { skipLibCheck: false },
        include: ["src/scoped-jsx-contract.tsx", "src/**/*.d.ts"],
        references: [],
      },
      null,
      2,
    )}\n`,
  );
  const projectRequire = createRequire(path.join(project, "package.json"));
  const cliManifest = projectRequire.resolve("@askrjs/cli/package.json");
  // The generated app owns TS7; the installed CLI owns its TS6 parser/compiler.
  const compilers = [
    { major: 6, require: createRequire(cliManifest) },
    { major: 7, require: projectRequire },
  ];
  for (const compiler of compilers) {
    const manifestPath = compiler.require.resolve("typescript/package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      bin: Record<string, string>;
    };
    const bin = manifest.bin[compiler.major === 6 ? "tsc6" : "tsc"];
    expect(bin).toBeTypeOf("string");
    const entry = path.resolve(path.dirname(manifestPath), bin!);
    const version = await run(process.execPath, [entry, "--version"], project, context);
    expect(version).toMatch(new RegExp(`^Version ${compiler.major}\\.`));
    for (const jsx of ["react-jsx", "react-jsxdev"]) {
      await run(
        process.execPath,
        [entry, "--project", "tsconfig.scoped-jsx.json", "--jsx", jsx, "--pretty", "false"],
        project,
        context,
      );
    }
  }
}

test("should ensure packed CLI passes checks for every shipped template", async ({ signal }) => {
  const selected = process.env.ASKR_TEMPLATE
    ? allTemplates.filter((template) => template === process.env.ASKR_TEMPLATE)
    : allTemplates;
  expect(selected, `Unknown ASKR_TEMPLATE: ${process.env.ASKR_TEMPLATE}`).not.toHaveLength(0);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-packed-templates-"));
  const context: PackagingContext = {
    evidence: await fs.mkdtemp(path.join(os.tmpdir(), "askr-packed-templates-evidence-")),
    // Observed cold installs take up to 106s. Five ordinary consumer installs
    // and checks get 580s, leaving 20s for owned cancellation before Vitest's bound.
    signal: AbortSignal.any([signal, AbortSignal.timeout(580_000)]),
    nextCommand: 0,
  };
  console.info(`Packed template command evidence: ${context.evidence}`);
  try {
    await run("npm", ["run", "build"], repository, context);
    const packed = await run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", root],
      repository,
      context,
    );
    const archive = path.join(root, packed.trim().split(/\r?\n/).at(-1)!);

    for (const template of selected) {
      console.info(`Checking packed template: ${template}`);
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
        context,
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
      await run("npm", ["install", "--no-audit", "--no-fund"], project, context);
      await run("npm", ["run", "check"], project, context);

      if (template === "ssg") {
        await checkScopedSsgJsx(project, context);
        for (const relative of ["sitemap.xml", "robots.txt", ".askr/sitemap-manifest.json"]) {
          await fs.access(path.join(project, "dist", relative));
        }
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 600_000);
