import { describe, expect, it } from "vitest";
import {
  ANALYZE_RULE_BENCHMARK_COVERAGE,
  uncoveredAnalyzeRuleIds,
} from "../benchmarks/analyze-workloads";
import { ANALYZE_RULES } from "../src/analyze/rules";

describe("analyzer benchmark contract", () => {
  it("classifies every registered analyzer rule in a benchmark workload", () => {
    const registered = ANALYZE_RULES.map((rule) => rule.id);
    expect(uncoveredAnalyzeRuleIds(registered)).toEqual({
      missing: [],
      stale: [],
    });
    expect(
      Object.values(ANALYZE_RULE_BENCHMARK_COVERAGE).every((entries) => entries.length > 0),
    ).toBe(true);
  });
});
