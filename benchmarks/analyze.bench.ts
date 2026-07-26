import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, bench, describe, expect } from "vite-plus/test";
import { runAnalysis } from "../src/analyze/runner";

const roots: string[] = [];
const benchOptions = {
  iterations: 8,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
} as const;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function componentSource(index: number): string {
  return `
    import { For, derive, resource, state } from "@askrjs/askr";

    export function Page${index}() {
      const [items] = state([{ id: ${index}, label: "Item ${index}" }]);
      const count = derive(() => items().length);
      const status = resource(({ signal }) =>
        fetch("/api/items/${index}", { signal }), [count()]);
      return <main data-count={count()} data-pending={status.pending}>
        <For each={items()} by={(item) => item.id}>
          {(item) => <span>{item.label}</span>}
        </For>
      </main>;
    }
  `;
}

async function createWorkspace(
  root: string,
  relativeDirectory: string,
  name: string,
  sourceCount: number,
): Promise<void> {
  const directory = path.join(root, relativeDirectory);
  await writeJson(path.join(directory, "package.json"), {
    name,
    dependencies: { "@askrjs/askr": "^0.0.70" },
  });
  await writeJson(path.join(directory, "tsconfig.json"), {
    compilerOptions: {
      jsx: "react-jsx",
      jsxImportSource: "@askrjs/askr",
      module: "ESNext",
      moduleResolution: "Bundler",
      target: "ES2022",
    },
    include: ["src"],
  });
  await fs.mkdir(path.join(directory, "src"), { recursive: true });
  await Promise.all(
    Array.from({ length: sourceCount }, (_, index) =>
      fs.writeFile(
        path.join(directory, "src", `page-${String(index).padStart(4, "0")}.tsx`),
        componentSource(index),
      ),
    ),
  );
}

async function createSingleWorkspaceFixture(sourceCount: number): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-bench-single-"));
  roots.push(root);
  await createWorkspace(root, ".", "single-app", sourceCount);
  return root;
}

async function createMonorepoFixture(
  workspaceCount: number,
  sourcesPerWorkspace: number,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-analyze-bench-monorepo-"));
  roots.push(root);
  await writeJson(path.join(root, "package.json"), {
    name: "bench-root",
    workspaces: ["packages/*"],
  });
  await Promise.all(
    Array.from({ length: workspaceCount }, (_, index) =>
      createWorkspace(
        root,
        path.join("packages", `app-${index}`),
        `app-${index}`,
        sourcesPerWorkspace,
      ),
    ),
  );
  return root;
}

let mediumWorkspace: string;
let largeWorkspace: string;
let monorepo: string;

beforeAll(async () => {
  [mediumWorkspace, largeWorkspace, monorepo] = await Promise.all([
    createSingleWorkspaceFixture(50),
    createSingleWorkspaceFixture(250),
    createMonorepoFixture(5, 50),
  ]);
});

afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

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
