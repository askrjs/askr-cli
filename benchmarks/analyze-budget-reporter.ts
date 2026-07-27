import type { Reporter, TestModule } from "vitest/node";

const ANALYZE_BUDGETS_MS: Readonly<Record<string, number>> = {
  "50-file workspace": 100,
  "250-file workspace": 250,
  "5-workspace monorepo with 250 files": 300,
  "diagnostic-heavy registered-rule sweep": 5,
  "deep cyclic wrapper graph through barrels": 6,
  "deep cyclic wrapper full analysis": 100,
  "lifecycle cleanup matching": 5,
  "realistic shipped startkit workspace": 100,
};

interface BenchmarkMeta {
  readonly benchmark?: boolean;
  readonly result?: {
    readonly mean: number;
  };
}

export class AnalyzeBudgetReporter implements Reporter {
  onTestRunEnd(testModules: readonly TestModule[]): void {
    const failures: string[] = [];
    const measurements: string[] = [];
    const seen = new Set<string>();
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        const meta = test.meta() as BenchmarkMeta;
        if (!meta.benchmark) continue;
        seen.add(test.name);
        const budget = ANALYZE_BUDGETS_MS[test.name];
        if (budget === undefined) {
          failures.push(`${test.name}: missing performance budget`);
          continue;
        }
        const mean = meta.result?.mean;
        if (mean === undefined || !Number.isFinite(mean) || mean <= 0) {
          failures.push(`${test.name}: missing benchmark result`);
        } else {
          measurements.push(`${test.name}: ${mean.toFixed(2)} ms / ${budget} ms`);
          if (mean > budget) {
            failures.push(`${test.name}: mean ${mean.toFixed(1)} ms exceeds ${budget} ms`);
          }
        }
      }
    }
    for (const name of Object.keys(ANALYZE_BUDGETS_MS)) {
      if (!seen.has(name)) failures.push(`${name}: stale performance budget`);
    }
    if (measurements.length > 0) {
      console.log(`Analyzer performance budgets:\n${measurements.join("\n")}`);
    }
    if (failures.length > 0) {
      throw new Error(`Analyzer performance budget failed:\n${failures.join("\n")}`);
    }
  }
}
