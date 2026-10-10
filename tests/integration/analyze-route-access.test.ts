import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));

test("should enforce explicit protected registry configuration through the normally installed CLI", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-route-access-consumer-"));
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run this integration through npm.");
  const run = async (args: string[], cwd: string, expectedExit = 0) => {
    const result = await exec(process.execPath, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 20 * 1024 * 1024,
    })
      .then((value) => ({ ...value, code: 0 }))
      .catch((error: Error & { code?: number; stdout?: string; stderr?: string }) => {
        if (typeof error.code !== "number") throw error;
        return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
      });
    expect(result.code, result.stderr).toBe(expectedExit);
    return result;
  };
  try {
    const packed = await run([npmCli, "pack", "--pack-destination", root], repository);
    const filename = packed.stdout.trim().split(/\r?\n/).at(-1)!;
    expect(filename).toMatch(/^[^/\\]+\.tgz$/);
    const producer = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8"));
    const manifest = {
      name: "route-access-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@askrjs/cli": `file:${path.join(root, filename)}`,
        "@askrjs/askr": producer.devDependencies["@askrjs/askr"],
      },
      devDependencies: {
        "@typescript/native": producer.devDependencies["@typescript/native"],
      },
      askr: {
        analyze: {
          protectedRegistries: [{ file: "src/routes.ts", export: "reports" }],
          rules: {} as Record<string, string>,
        },
      },
    };
    const manifestPath = path.join(root, "package.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await run([npmCli, "install", "--no-audit", "--no-fund"], root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM"],
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        include: ["src"],
      }),
    );
    const sourcePath = path.join(root, "src/routes.ts");
    const source = (access: boolean) =>
      [
        'import { createRouteRegistry, route, group } from "@askrjs/askr/router";',
        "const View = () => null;",
        "export const reports = createRouteRegistry(() => {",
        `  group(${access ? "{ auth: () => ({ allowed: true }) }" : "{}"}, () => {`,
        '    route("/reports", View);',
        "  });",
        "});",
        'export const publicRoutes = createRouteRegistry(() => route("/public", View));',
      ].join("\n");
    const cli = path.join(root, "node_modules/@askrjs/cli/dist/cli.js");
    const compilers = [
      path.join(root, "node_modules/typescript/bin/tsc6"),
      path.join(root, "node_modules/@typescript/native/bin/tsc"),
    ];
    for (const [index, compiler] of compilers.entries()) {
      const version = (await run([compiler, "--version"], root)).stdout.trim();
      expect(version).toMatch(new RegExp(`^Version ${index + 6}\\.`));
      console.info(`Installed protected-registry compiler: ${version}`);
    }
    for (const access of [false, true]) {
      const text = source(access);
      await fs.writeFile(sourcePath, text);
      for (const compiler of compilers) await run([compiler, "-p", "tsconfig.json"], root);
      for (const severity of ["warning", "error", "info", "off"]) {
        manifest.askr.analyze.rules = { "askr/route-access-policy": severity };
        await fs.writeFile(manifestPath, JSON.stringify(manifest));
        const exit = !access && (severity === "warning" || severity === "error") ? 1 : 0;
        const args = [cli, "analyze", "--json", "--check"];
        const report = JSON.parse((await run(args, root, exit)).stdout);
        expect(
          report.diagnostics.map(
            (entry: { ruleId: string; severity: string; file: string; line: number }) => ({
              ruleId: entry.ruleId,
              severity: entry.severity,
              file: entry.file,
              line: entry.line,
            }),
          ),
        ).toEqual(
          access || severity === "off"
            ? []
            : [{ ruleId: "askr/route-access-policy", severity, file: "src/routes.ts", line: 5 }],
        );
        expect(JSON.parse((await run(args, root, exit)).stdout)).toEqual(report);
        expect(await fs.readFile(sourcePath, "utf8")).toBe(text);
      }
    }
    manifest.askr.analyze.protectedRegistries[0].export = "missing";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    expect((await run([cli, "analyze", "--json", "--check"], root, 1)).stderr).toContain(
      "src/routes.ts#missing",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
