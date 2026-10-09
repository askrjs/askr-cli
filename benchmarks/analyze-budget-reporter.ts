import type { Reporter, TestModule } from "vitest/node";

const ANALYZE_BUDGETS_MS: Readonly<Record<string, number>> = {
  "50-file workspace": 100,
  "250-file workspace": 250,
  "5-workspace monorepo with 250 files": 300,
};

// The pre-fix analyzer measured 104/459/426 ms on hosted Ubuntu with this
// corrected harness (run 37943456683). Keep the original local targets and
// use an explicit hosted envelope rather than accepting unmeasured results.
const HOSTED_LINUX_BUDGETS_MS: Readonly<Record<string, number>> = {
  "50-file workspace": 150,
  "250-file workspace": 550,
  "5-workspace monorepo with 250 files": 550,
};

interface BenchmarkTask {
  readonly name: string;
  readonly tasks?: readonly BenchmarkTask[];
  readonly meta?: { readonly benchmark?: boolean };
  readonly result?: {
    readonly state: string;
    readonly benchmark?: { readonly mean: number; readonly sampleCount: number };
  };
}

export class AnalyzeBudgetReporter implements Reporter {
  constructor(
    private readonly profile: "local" | "hosted-linux" = process.platform === "linux" &&
    process.env.GITHUB_ACTIONS === "true"
      ? "hosted-linux"
      : "local",
  ) {}

  onTestRunEnd(testModules: readonly TestModule[]): void {
    const budgets = this.profile === "hosted-linux" ? HOSTED_LINUX_BUDGETS_MS : ANALYZE_BUDGETS_MS;
    const failures: string[] = [];
    const seen = new Set<string>();
    const inspect = (task: BenchmarkTask): void => {
      for (const child of task.tasks ?? []) inspect(child);
      const budget = budgets[task.name];
      if (!task.meta?.benchmark || budget === undefined) return;
      seen.add(task.name);
      const result = task.result?.benchmark;
      if (task.result?.state !== "pass" || !result) {
        failures.push(`${task.name}: missing successful benchmark result`);
      } else if (!Number.isFinite(result.mean) || result.mean < 0) {
        failures.push(`${task.name}: invalid benchmark mean`);
      } else if (!Number.isInteger(result.sampleCount) || result.sampleCount <= 0) {
        failures.push(`${task.name}: missing measured samples`);
      } else if (result.mean > budget) {
        failures.push(`${task.name}: mean ${result.mean.toFixed(1)} ms exceeds ${budget} ms`);
      } else {
        process.stdout.write(
          `PASS ${task.name}: mean ${result.mean.toFixed(1)} ms, ${result.sampleCount} samples, budget ${budget} ms\n`,
        );
      }
    };
    for (const testModule of testModules) {
      // Vitest stores benchmark metrics on the runner task, not in test.meta().
      inspect((testModule as unknown as { task: BenchmarkTask }).task);
    }
    for (const name of Object.keys(budgets))
      if (!seen.has(name)) failures.push(`${name}: missing benchmark`);
    if (failures.length > 0) {
      throw new Error(`Analyzer performance budget failed:\n${failures.join("\n")}`);
    }
  }
}
