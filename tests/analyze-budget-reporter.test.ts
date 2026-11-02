import type { Reporter } from "vite-plus/test/node";
import { describe, expect, it } from "vite-plus/test";
import { AnalyzeBudgetReporter } from "../benchmarks/analyze-budget-reporter";

type BudgetProfile = "local" | "hosted-linux";
type ReportedTestCase = Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0];

function benchmarkCase(
  name: string,
  mean: number | undefined,
  sampleCount = 8,
  benchmark = true,
  state = "passed",
): ReportedTestCase {
  return {
    name,
    result: () => ({ state }),
    benchmarks: () =>
      benchmark && mean !== undefined
        ? [{ name, tasks: [{ name, latency: { mean, samplesCount: sampleCount } }] }]
        : [],
  } as unknown as ReportedTestCase;
}

function runReporter(cases: readonly ReportedTestCase[], profile: BudgetProfile = "local") {
  let failed = false;
  let output = "";
  const reporter = new AnalyzeBudgetReporter(
    {
      fail: () => {
        failed = true;
      },
      write: (message) => {
        output += message;
      },
    },
    profile,
  );
  reporter.onTestRunStart();
  for (const testCase of cases) reporter.onTestCaseResult(testCase);
  reporter.onTestRunEnd();
  return { failed, output };
}

describe("AnalyzeBudgetReporter", () => {
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 0])(
    "rejects invalid means (%s)",
    (mean) => {
      const result = runReporter([benchmarkCase("50-file workspace", mean)]);
      expect(result.failed).toBe(true);
      expect(result.output).toMatch(
        /successful benchmark result missing|benchmark mean must be finite and positive/,
      );
    },
  );

  it("accepts finite positive results within the local budgets", () => {
    const result = runReporter([
      benchmarkCase("50-file workspace", 10),
      benchmarkCase("250-file workspace", 200),
      benchmarkCase("5-workspace monorepo with 250 files", 250),
    ]);
    expect(result.failed).toBe(false);
    expect(result.output).toContain("PASS 50-file workspace: mean 10.0 ms");
  });

  it("rejects over-budget, failed, and missing results", () => {
    const result = runReporter([
      benchmarkCase("50-file workspace", 101),
      benchmarkCase("250-file workspace", 10, 8, true, "failed"),
    ]);
    expect(result.failed).toBe(true);
    expect(result.output).toContain("50-file workspace: mean 101.0 ms exceeds 100 ms");
    expect(result.output).toContain("250-file workspace: successful benchmark result missing");
    expect(result.output).toContain(
      "5-workspace monorepo with 250 files: successful benchmark result missing",
    );
  });

  it("rejects missing measured samples and duplicate benchmark rows", () => {
    const missingSamples = runReporter([
      benchmarkCase("50-file workspace", 10, 0),
      benchmarkCase("250-file workspace", 10),
      benchmarkCase("5-workspace monorepo with 250 files", 10),
    ]);
    expect(missingSamples.failed).toBe(true);
    expect(missingSamples.output).toContain(
      "50-file workspace: measured benchmark samples missing",
    );

    const duplicate = runReporter([
      benchmarkCase("50-file workspace", 10),
      benchmarkCase("50-file workspace", 10),
      benchmarkCase("250-file workspace", 10),
      benchmarkCase("5-workspace monorepo with 250 files", 10),
    ]);
    expect(duplicate.failed).toBe(true);
    expect(duplicate.output).toContain("50-file workspace: reported more than once");
  });

  it("uses the separately measured hosted Linux budget profile", () => {
    const withinHostedBudget = runReporter(
      [
        benchmarkCase("50-file workspace", 150),
        benchmarkCase("250-file workspace", 550),
        benchmarkCase("5-workspace monorepo with 250 files", 550),
      ],
      "hosted-linux",
    );
    expect(withinHostedBudget.failed).toBe(false);

    const overHostedBudget = runReporter(
      [
        benchmarkCase("50-file workspace", 151),
        benchmarkCase("250-file workspace", 200),
        benchmarkCase("5-workspace monorepo with 250 files", 250),
      ],
      "hosted-linux",
    );
    expect(overHostedBudget.failed).toBe(true);
    expect(overHostedBudget.output).toContain("50-file workspace: mean 151.0 ms exceeds 150 ms");
  });
});
