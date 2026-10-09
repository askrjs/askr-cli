import { describe, expect, it } from "vitest";
import type { TestModule } from "vitest/node";
import { AnalyzeBudgetReporter } from "../benchmarks/analyze-budget-reporter";

function modules(mean = 10, samples = 8): TestModule[] {
  const tasks = [
    "50-file workspace",
    "250-file workspace",
    "5-workspace monorepo with 250 files",
  ].map((name) => ({
    type: "test",
    name,
    meta: { benchmark: true },
    result: { state: "pass", benchmark: { mean, sampleCount: samples } },
  }));
  return [{ task: { type: "suite", tasks } }] as unknown as TestModule[];
}

describe("analyzer benchmark qualification", () => {
  it.each([NaN, Infinity, -1])("should reject invalid mean %s", (mean) => {
    expect(() => new AnalyzeBudgetReporter("local").onTestRunEnd(modules(mean))).toThrow(
      /invalid|missing/,
    );
  });

  it("should reject absent benchmarks and zero measured samples", () => {
    expect(() => new AnalyzeBudgetReporter("local").onTestRunEnd([])).toThrow(/missing/);
    expect(() => new AnalyzeBudgetReporter("local").onTestRunEnd(modules(10, 0))).toThrow(/sample/);
  });

  it("should admit measured results within budget and reject an over-budget mean", () => {
    expect(() => new AnalyzeBudgetReporter("local").onTestRunEnd(modules())).not.toThrow();
    expect(() => new AnalyzeBudgetReporter("local").onTestRunEnd(modules(101))).toThrow(
      /exceeds 100/,
    );
  });

  it("should enforce the separately measured hosted Linux profile", () => {
    expect(() =>
      new AnalyzeBudgetReporter("hosted-linux").onTestRunEnd(modules(100)),
    ).not.toThrow();
    expect(() => new AnalyzeBudgetReporter("hosted-linux").onTestRunEnd(modules(551))).toThrow(
      /exceeds 550/,
    );
    expect(() => new AnalyzeBudgetReporter("hosted-linux").onTestRunEnd(modules(NaN))).toThrow(
      /invalid/,
    );
  });
});
