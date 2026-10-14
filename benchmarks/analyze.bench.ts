import { bench, describe, expect, inject } from "vite-plus/test";
import { runAnalysis } from "../src/analyze/runner";

const { mediumWorkspace, largeWorkspace, monorepo } = inject("analyzerFixtures");

const benchOptions = {
  iterations: 8,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
  throws: true,
} as const;

async function analyzeFixture(root: string, expectedFiles: number): Promise<void> {
  const report = await runAnalysis({
    cwd: root,
    workspacePatterns: [],
    check: true,
  });
  expect(report.summary.diagnostics).toBe(0);
  expect(report.workspaces.reduce((sum, workspace) => sum + workspace.files, 0)).toBe(
    expectedFiles,
  );
}

describe("askr analyze", () => {
  bench("50-file workspace", () => analyzeFixture(mediumWorkspace, 50), benchOptions);
  bench("250-file workspace", () => analyzeFixture(largeWorkspace, 250), benchOptions);
  bench("5-workspace monorepo with 250 files", () => analyzeFixture(monorepo, 250), benchOptions);
});
