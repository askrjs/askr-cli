import { describe, it, expect } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nextAppearance } from "../src/lib/mock-data";

const templateRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path: string): Promise<string> {
  return readFile(join(templateRoot, path), "utf8");
}

describe("startkit app contracts", () => {
  it("should register the shipped public, auth, and workspace routes", async () => {
    const [appRoutes, publicRoutes, authRoutes, workspaceIndex, accountRoutes] = await Promise.all([
      source("src/routes/index.ts"),
      source("src/routes/public.ts"),
      source("src/routes/auth.ts"),
      source("src/routes/workspace/index.ts"),
      source("src/routes/workspace/accounts.ts"),
    ]);
    expect(appRoutes).toContain("registerPublicRoutes();");
    expect(appRoutes).toContain("registerAuthRoutes();");
    expect(appRoutes).toContain("registerWorkspaceRoutes();");
    expect(publicRoutes).toContain('"/"');
    expect(authRoutes).toContain('"/login"');
    expect(workspaceIndex).toContain('"/dashboard"');
    expect(workspaceIndex).toContain('"/settings"');
    expect(accountRoutes).toContain('"/accounts"');
  });

  it("should use the shipped primary navigation labels", async () => {
    const [navigation, routes] = await Promise.all([
      source("src/components/app-sidebar.tsx"),
      source("src/lib/routes.ts"),
    ]);
    for (const label of ["Dashboard", "Accounts", "Settings"]) {
      expect(navigation).toContain(`label: ${label.toLowerCase()}Route.navLabel`);
      expect(routes).toContain(`navLabel: "${label}"`);
    }
  });

  it("should cycle through the appearance presets from the shipped model", () => {
    expect(nextAppearance("default")).toBe("harbor");
    expect(nextAppearance("harbor")).toBe("ink");
    expect(nextAppearance("ink")).toBe("default");
  });

  it("should list only existing files in the generated agent file tree", async () => {
    const agents = await source("AGENTS.md");
    const tree = agents.match(/```\n(src\/[\s\S]*?)\n```/)?.[1];
    expect(tree).toBeDefined();
    const directories = ["src/"];
    for (const line of tree!.split("\n")) {
      const indent = line.match(/^\s*/u)![0].length;
      const entry = line.trim().split(/\s+#/u)[0];
      if (!entry || entry === "src/") continue;
      const depth = Math.floor(indent / 2) - 1;
      directories.length = depth + 1;
      const candidate = [...directories, entry].join("");
      if (entry.endsWith("/")) {
        directories[depth + 1] = entry;
      } else {
        await expect(source(candidate)).resolves.toBeTruthy();
      }
    }
  });
});
