import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));

test("should check typed endpoint cancellation through the installed CLI and packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-client-cancellation-"));
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run this integration through npm.");
  const run = async (args: string[], cwd: string, expectedExit = 0) => {
    try {
      const result = await exec(process.execPath, args, {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 20 * 1024 * 1024,
      });
      expect(expectedExit).toBe(0);
      return result.stdout;
    } catch (error) {
      const failure = error as Error & { code?: number; stdout?: string };
      if (failure.code !== expectedExit) throw error;
      return failure.stdout ?? "";
    }
  };
  try {
    // Normal pack executes prepack; no aliases redirect installed package files.
    const packed = await run([npmCli, "pack", "--pack-destination", root], repository);
    const filename = packed.trim().split(/\r?\n/).at(-1)!;
    expect(filename).toMatch(/^[^/\\]+\.tgz$/);
    const manifest = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8"));
    const range = manifest.devDependencies["@askrjs/askr"];
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "typed-cancellation-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@askrjs/cli": `file:${path.join(root, filename)}`,
          "@askrjs/askr": range,
          "@askrjs/fetch": range,
        },
      }),
    );
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
    const source = (forward: boolean) =>
      [
        'import { createQuery, createMutation } from "@askrjs/askr/data";',
        'import { createClient, createFetch, defineApi, get, json } from "@askrjs/fetch";',
        'const api = defineApi({ records: get("/api/records").returns(json<readonly string[]>()) });',
        "const client = createClient(api);",
        "const request = createFetch();",
        "export function Records() {",
        `  return createQuery({ key: "records", fetch: ({ signal }) => client.records(${forward ? "{ signal }" : ""}) });`,
        "}",
        "export function Save() {",
        `  return createMutation({ action: (input: string, { signal }) => request({ url: "/api/records", method: "POST", body: input${forward ? ", signal" : ""} }) });`,
        "}",
      ].join("\n");
    const sourcePath = path.join(root, "src/records.ts");
    const cli = path.join(root, "node_modules/@askrjs/cli/dist/cli.js");
    const compiler = path.join(root, "node_modules/typescript/bin/tsc6");
    for (const forward of [false, true]) {
      const text = source(forward);
      await fs.writeFile(sourcePath, text);
      await run([compiler, "-p", "tsconfig.json"], root);
      const args = [cli, "analyze", "--json", "--check"];
      const report = JSON.parse(await run(args, root, forward ? 0 : 1));
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
        forward
          ? []
          : [7, 10].map((line) => ({
              ruleId: "askr/data-cancellation",
              severity: "warning",
              file: "src/records.ts",
              line,
            })),
      );
      expect(JSON.parse(await run(args, root, forward ? 0 : 1))).toEqual(report);
      expect(await fs.readFile(sourcePath, "utf8")).toBe(text);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
