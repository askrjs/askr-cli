import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAnalysis } from "../src/analyze/runner";
import { runCli } from "../src/bin/cli";
import { parseGuardrailArgs, runGuardrailCli } from "../src/bin/guardrails";
import { syncBundledSkills } from "../src/bin/skills";
import { runCheck, runDoctor, runRepair } from "../src/guardrails/runner";

const roots: string[] = [];

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

async function fixture(
  overrides: {
    source?: string;
    manifest?: Record<string, unknown>;
    lockfiles?: string[];
    skills?: boolean;
  } = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-guardrails-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify(
      overrides.manifest ?? {
        name: "fixture",
        dependencies: { "@askrjs/askr": "^0.0.70" },
        scripts: {
          lint: "fixture-lint",
          typecheck: "fixture-typecheck",
          test: "fixture-test",
          build: "fixture-build",
          check: "askr check",
        },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "@askrjs/askr",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(root, "src", "app.ts"),
    overrides.source ?? "export const ready = true;\n",
  );
  for (const lockfile of overrides.lockfiles ?? ["package-lock.json"]) {
    await fs.writeFile(path.join(root, lockfile), "{}\n");
  }
  if (overrides.skills) {
    await fs.mkdir(path.join(root, "skills", "askr-agent-execution"), { recursive: true });
    await fs.writeFile(
      path.join(root, "skills", "askr-agent-execution", "SKILL.md"),
      "# fixture\n",
    );
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("guardrail commands", () => {
  it("parses shared cwd, workspace, JSON, and help options", () => {
    expect(
      parseGuardrailArgs(["--cwd", "./fixture", "--workspace=a*", "--workspace", "b", "--json"]),
    ).toEqual({
      cwd: path.resolve("./fixture"),
      workspacePatterns: ["a*", "b"],
      json: true,
      help: false,
    });
    expect(() => parseGuardrailArgs(["--workspace"])).toThrow(/requires a value/);
    expect(() => parseGuardrailArgs(["--unknown"])).toThrow(/unknown option/i);
  });

  it("diagnoses environment, package manager, skills, framework, and analysis health", async () => {
    const root = await fixture({ skills: true });
    await syncBundledSkills({ cwd: root });
    const report = await runDoctor({ cwd: root, workspacePatterns: [] }, { nodeVersion: "24.0.0" });

    expect(report.summary).toEqual({ passed: 5, warnings: 0, errors: 0 });
    expect(report.findings.map((entry) => entry.id)).toEqual([
      "askr/doctor-node",
      "askr/doctor-package-manager",
      "askr/doctor-framework-dependency",
      "askr/doctor-agent-guidance",
      "askr/doctor-analysis",
    ]);
  });

  it("reports actionable doctor failures without changing the project", async () => {
    const root = await fixture({
      lockfiles: ["package-lock.json", "pnpm-lock.yaml"],
      source: ['import { state } from "@askrjs/askr";', "export const count = state(0);", ""].join(
        "\n",
      ),
    });
    const before = await fs.readFile(path.join(root, "src", "app.ts"), "utf8");
    const report = await runDoctor(
      { cwd: root, workspacePatterns: [] },
      { nodeVersion: "18.20.0" },
    );

    expect(report.summary.errors).toBe(3);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "askr/doctor-node", status: "error" }),
        expect.objectContaining({ id: "askr/doctor-package-manager", status: "error" }),
        expect.objectContaining({ id: "askr/doctor-analysis", status: "error" }),
      ]),
    );
    expect(await fs.readFile(path.join(root, "src", "app.ts"), "utf8")).toBe(before);
  });

  it("runs validation scripts in order after analysis passes", async () => {
    const root = await fixture();
    const executed: string[] = [];
    const report = await runCheck(
      { cwd: root, workspacePatterns: [] },
      {
        runScript: vi.fn(async (executable, args) => {
          executed.push([executable, ...args].join(" "));
          return { status: "passed" as const, exitCode: 0, stdout: "", stderr: "" };
        }),
      },
    );

    expect(report.status).toBe("passed");
    expect(executed).toEqual([
      "npm run lint",
      "npm run typecheck",
      "npm run test",
      "npm run build",
    ]);
  });

  it("automatically validates a discovered database before project scripts", async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, "database"), { recursive: true });
    await fs.writeFile(path.join(root, "database", "index.ts"), "export default {};\n");
    const order: string[] = [];
    const report = await runCheck(
      { cwd: root, workspacePatterns: [] },
      {
        runDatabaseValidation: vi.fn(async () => {
          order.push("database");
          return { status: "passed" as const, exitCode: 0, stdout: "", stderr: "" };
        }),
        runScript: vi.fn(async (_executable, args) => {
          order.push(String(args.at(-1)));
          return { status: "passed" as const, exitCode: 0, stdout: "", stderr: "" };
        }),
      },
    );

    expect(report.status).toBe("passed");
    expect(order).toEqual(["database", "lint", "typecheck", "test", "build"]);
    expect(report.scripts[0]).toMatchObject({
      name: "database",
      command: "askr database validate",
      status: "passed",
    });
  });

  it("does not run project scripts until blocking analysis findings are repaired", async () => {
    const root = await fixture({
      source: ['import { state } from "@askrjs/askr";', "export const count = state(0);", ""].join(
        "\n",
      ),
    });
    const runScript = vi.fn();
    const report = await runCheck({ cwd: root, workspacePatterns: [] }, { runScript });

    expect(report.status).toBe("failed");
    expect(runScript).not.toHaveBeenCalled();
    expect(report.scripts).toHaveLength(4);
    expect(report.scripts.every((entry) => entry.status === "skipped")).toBe(true);
  });

  it("stops after a failed validation script and explains skipped stages", async () => {
    const root = await fixture();
    const report = await runCheck(
      { cwd: root, workspacePatterns: [] },
      {
        runScript: vi.fn(async (_executable, args) => ({
          status: args.at(-1) === "typecheck" ? ("failed" as const) : ("passed" as const),
          exitCode: args.at(-1) === "typecheck" ? 1 : 0,
          stdout: "",
          stderr: "",
        })),
      },
    );

    expect(report.status).toBe("failed");
    expect(report.scripts.map((entry) => [entry.name, entry.status, entry.reason])).toEqual([
      ["lint", "passed", undefined],
      ["typecheck", "failed", undefined],
      ["test", "skipped", "typecheck failed"],
      ["build", "skipped", "typecheck failed"],
    ]);
  });

  it("applies safe repairs, reports semantic leftovers, and converges idempotently", async () => {
    const root = await fixture({
      source: [
        'import { createRouteRegistry, route } from "@askrjs/askr/router";',
        "export const registry = createRouteRegistry(() => {",
        '  route("/users/:id", () => null);',
        "});",
        "",
      ].join("\n"),
    });
    const first = await runRepair({ cwd: root, workspacePatterns: [] });
    const second = await runRepair({ cwd: root, workspacePatterns: [] });

    expect(first.status).toBe("clean");
    expect(first.analysis.appliedFixes).toEqual([
      expect.objectContaining({ ruleId: "askr/route-path-syntax" }),
    ]);
    expect(second.status).toBe("clean");
    expect(second.analysis.appliedFixes).toEqual([]);
    expect(await fs.readFile(path.join(root, "src", "app.ts"), "utf8")).toContain(
      'route("/users/{id}"',
    );
  });

  it("dispatches doctor, repair, and check through the canonical askr CLI", async () => {
    const root = await fixture({ skills: true });
    await syncBundledSkills({ cwd: root });
    const output = io();
    expect(await runCli(["doctor", "--cwd", root, "--json"], output.value)).toBe(0);
    expect(JSON.parse(output.logs[0])).toMatchObject({ command: "doctor" });

    const help = io();
    expect(await runGuardrailCli("repair", ["--help"], help.value)).toBe(0);
    expect(help.logs.join("\n")).toMatch(/askr repair/);
  });
});

describe("shipped template guardrails", () => {
  it("keeps every template analyzer-clean and wired to the unified check", async () => {
    const templatesRoot = fileURLToPath(new URL("../templates/", import.meta.url));
    for (const name of ["full-stack", "spa", "ssg", "ssr", "startkit"]) {
      const root = path.join(templatesRoot, name);
      const report = await runAnalysis({ cwd: root, workspacePatterns: [], check: true });
      const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };

      expect(report.diagnostics, `${name} must be analyzer-clean`).toEqual([]);
      expect(manifest.scripts?.analyze).toBe("askr analyze --check");
      expect(manifest.scripts?.check).toBe("askr check");
    }
  });
});
