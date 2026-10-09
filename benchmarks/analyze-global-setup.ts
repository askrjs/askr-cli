import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    analyzerFixtures: { mediumWorkspace: string; largeWorkspace: string; monorepo: string };
  }
}

const roots: string[] = [];

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function componentSource(index: number): string {
  return `
    import { derive, state } from "@askrjs/askr";
    import { For } from "@askrjs/askr/control";
    import { resource } from "@askrjs/askr/resources";

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

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cleanup = async (): Promise<void> => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  };
  try {
    const mediumWorkspace = await createSingleWorkspaceFixture(50);
    const largeWorkspace = await createSingleWorkspaceFixture(250);
    const monorepo = await createMonorepoFixture(5, 50);
    project.provide("analyzerFixtures", { mediumWorkspace, largeWorkspace, monorepo });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
