import type { Reporter } from "vite-plus/test/node";

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

type BudgetProfile = "local" | "hosted-linux";
type ReportedTestCase = Parameters<NonNullable<Reporter["onTestCaseResult"]>>[0];

interface BenchmarkObservation {
  readonly mean: number;
  readonly sampleCount: number;
  readonly state: string;
}

interface BenchmarkTaskResult {
  readonly result?: {
    readonly state: string;
    readonly benchmark?: {
      readonly mean: number;
      readonly sampleCount: number;
    };
  };
}

interface ReporterRuntime {
  readonly fail: () => void;
  readonly write: (message: string) => void;
}

const defaultRuntime: ReporterRuntime = {
  fail: () => {
    process.exitCode = 1;
  },
  write: (message) => {
    process.stderr.write(message);
  },
};

/** Enforce measured analyzer results against their local or hosted budgets. */
export class AnalyzeBudgetReporter implements Reporter {
  readonly #runtime: ReporterRuntime;
  readonly #profile: BudgetProfile;
  readonly #observations = new Map<string, BenchmarkObservation | undefined>();
  readonly #duplicates = new Set<string>();

  constructor(
    runtime: ReporterRuntime = defaultRuntime,
    profile: BudgetProfile = process.platform === "linux" && process.env.GITHUB_ACTIONS === "true"
      ? "hosted-linux"
      : "local",
  ) {
    this.#runtime = runtime;
    this.#profile = profile;
  }

  onTestRunStart(): void {
    this.#observations.clear();
    this.#duplicates.clear();
  }

  onTestCaseResult(testCase: ReportedTestCase): void {
    if (!Object.hasOwn(ANALYZE_BUDGETS_MS, testCase.name) || !testCase.meta().benchmark) return;

    const task = testCase as ReportedTestCase & { readonly task: BenchmarkTaskResult };
    const result = task.task.result;
    const benchmark = result?.benchmark;
    if (this.#observations.has(testCase.name)) this.#duplicates.add(testCase.name);
    this.#observations.set(
      testCase.name,
      benchmark
        ? { mean: benchmark.mean, sampleCount: benchmark.sampleCount, state: result.state }
        : undefined,
    );
  }

  onTestRunEnd(): void {
    const budgets = this.#profile === "hosted-linux" ? HOSTED_LINUX_BUDGETS_MS : ANALYZE_BUDGETS_MS;
    const failures: string[] = [];

    for (const [name, budget] of Object.entries(budgets)) {
      if (this.#duplicates.has(name)) {
        failures.push(`${name}: reported more than once`);
        continue;
      }

      const result = this.#observations.get(name);
      if (!result || result.state !== "pass") {
        failures.push(`${name}: successful benchmark result missing`);
      } else if (!Number.isFinite(result.mean) || result.mean <= 0) {
        failures.push(`${name}: benchmark mean must be finite and positive`);
      } else if (!Number.isInteger(result.sampleCount) || result.sampleCount <= 0) {
        failures.push(`${name}: measured benchmark samples missing`);
      } else if (result.mean > budget) {
        failures.push(`${name}: mean ${result.mean.toFixed(1)} ms exceeds ${budget} ms`);
      } else {
        this.#runtime.write(
          `PASS ${name}: mean ${result.mean.toFixed(1)} ms, ${result.sampleCount} samples, budget ${budget} ms\n`,
        );
      }
    }

    if (failures.length === 0) return;
    this.#runtime.write(
      `\nAnalyzer performance budget failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}\n`,
    );
    this.#runtime.fail();
  }
}
