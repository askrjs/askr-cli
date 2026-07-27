export const ANALYZE_BENCHMARK_WORKLOADS = [
  "clean-full-workspace",
  "deep-cyclic-wrapper-graph",
  "diagnostic-heavy-rule-sweep",
  "lifecycle-cleanup-matching",
  "realistic-multi-file-workspace",
] as const;

export type AnalyzeBenchmarkWorkload = (typeof ANALYZE_BENCHMARK_WORKLOADS)[number];

export const ANALYZE_RULE_BENCHMARK_COVERAGE: Readonly<
  Record<string, readonly AnalyzeBenchmarkWorkload[]>
> = {
  "askr/action-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/action-promise": ["diagnostic-heavy-rule-sweep"],
  "askr/boot-registry": ["diagnostic-heavy-rule-sweep"],
  "askr/control-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/data-cancellation": ["diagnostic-heavy-rule-sweep"],
  "askr/data-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/execution-model": ["diagnostic-heavy-rule-sweep"],
  "askr/for-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/framework-config": ["clean-full-workspace", "diagnostic-heavy-rule-sweep"],
  "askr/invalidation-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/island-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/lifecycle-contract": ["diagnostic-heavy-rule-sweep"],
  "askr/no-async-component": ["diagnostic-heavy-rule-sweep"],
  "askr/parse-error": ["diagnostic-heavy-rule-sweep"],
  "askr/prefer-for": ["diagnostic-heavy-rule-sweep"],
  "askr/render-allocation": ["diagnostic-heavy-rule-sweep"],
  "askr/render-side-effect": ["diagnostic-heavy-rule-sweep", "lifecycle-cleanup-matching"],
  "askr/resource-cancellation": ["diagnostic-heavy-rule-sweep"],
  "askr/route-path-syntax": ["diagnostic-heavy-rule-sweep"],
  "askr/route-registry": ["diagnostic-heavy-rule-sweep"],
  "askr/ssr-browser-global": ["diagnostic-heavy-rule-sweep"],
  "askr/stable-dependencies": ["diagnostic-heavy-rule-sweep"],
  "askr/stable-key": ["diagnostic-heavy-rule-sweep"],
  "askr/stable-render-call": ["deep-cyclic-wrapper-graph", "diagnostic-heavy-rule-sweep"],
  "askr/state-access": ["diagnostic-heavy-rule-sweep"],
  "askr/state-render-write": ["diagnostic-heavy-rule-sweep"],
  "askr/stream-contract": ["diagnostic-heavy-rule-sweep"],
};

export function uncoveredAnalyzeRuleIds(registeredRuleIds: readonly string[]): {
  readonly missing: readonly string[];
  readonly stale: readonly string[];
} {
  const registered = new Set(registeredRuleIds);
  const covered = new Set(Object.keys(ANALYZE_RULE_BENCHMARK_COVERAGE));
  return {
    missing: [...registered].filter((id) => !covered.has(id)).sort(),
    stale: [...covered].filter((id) => !registered.has(id)).sort(),
  };
}
