import type { Reporter, TestModule } from "vitest/node";

const ANALYZE_BUDGETS_MS: Readonly<Record<string, number>> = {
  "50-file workspace": 100,
  "250-file workspace": 250,
  "5-workspace monorepo with 250 files": 300,
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
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        const budget = ANALYZE_BUDGETS_MS[test.name];
        if (budget === undefined) continue;
        const meta = test.meta() as BenchmarkMeta;
        const mean = meta.result?.mean;
        if (!meta.benchmark || mean === undefined) {
          failures.push(`${test.name}: missing benchmark result`);
        } else if (mean > budget) {
          failures.push(`${test.name}: mean ${mean.toFixed(1)} ms exceeds ${budget} ms`);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`Analyzer performance budget failed:\n${failures.join("\n")}`);
    }
  }
}
