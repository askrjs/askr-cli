import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import manifest from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

async function installRegistryArtifacts(root: string, versions: readonly string[]): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await run(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...versions],
        root,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  throw lastError;
}

test("should validate a database using only public registry artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-cli-registry-database-"));
  const cliVersion = process.env.ASKR_CLI_REGISTRY_VERSION ?? manifest.version;
  const ormVersion = process.env.ASKR_ORM_REGISTRY_VERSION ?? "0.0.1";
  try {
    await fs.writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "askr-registry-database", private: true, type: "module" }, null, 2)}\n`,
    );
    await installRegistryArtifacts(root, [
      `@askrjs/cli@${cliVersion}`,
      `@askrjs/orm@${ormVersion}`,
    ]);
    await fs.mkdir(path.join(root, "database"));
    await fs.writeFile(
      path.join(root, "database", "index.ts"),
      `import { defineDatabase } from "@askrjs/orm";
import { sqlite } from "@askrjs/orm/sqlite";

export default defineDatabase({ driver: sqlite({ filename: "./database.sqlite" }), tables: {} });
`,
    );

    const askr = path.join(root, "node_modules", ".bin", "askr");
    await run(askr, ["database", "generate"], root);
    const output = await run(askr, ["database", "validate"], root);

    expect(output).toContain("valid");
    expect(await fs.readFile(path.join(root, "database", "generated.ts"), "utf8")).toContain(
      "GeneratedDatabaseArtifact",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 360_000);
