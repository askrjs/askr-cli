// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

function readSource(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

describe("SPA template structure", () => {
  it("should boot from the route registry and mount the public, auth, and app layouts", () => {
    expect(readSource("main.tsx")).toMatch(/registry:\s*pageRegistry\b/);
    const registry = readSource("pages/_routes.tsx");
    expect(registry).toMatch(/group\(\{ layout: RootLayout \}/);

    for (const [directory, layout, register, route] of [
      ["public", "PublicLayout", "registerPublicRoutes", "/"],
      ["auth", "AuthLayout", "registerAuthRoutes", "/login"],
      ["app", "AppLayout", "registerAppRoutes", "/app"],
    ]) {
      expect(registry).toContain(`group({ layout: ${layout} }, () => {`);
      expect(registry).toContain(`${register}();`);
      expect(readSource(`pages/${directory}/_layout.tsx`)).toContain("export default");
      expect(readSource(`pages/${directory}/_routes.tsx`)).toContain(`route("${route}",`);
    }
  });

  it("should load the theme and local CSS layers from the SPA entry", () => {
    expect(readSource("main.tsx")).toContain('import "./styles.css"');
    const styles = readSource("styles.css");
    expect(styles).toContain('@import "@askrjs/themes/default";');
    for (const layer of ["reset", "tokens", "theme", "layout", "components"]) {
      expect(styles).toContain(`@import "./styles/${layer}.css";`);
      expect(readSource(`styles/${layer}.css`).trim()).not.toBe("");
    }
  });
});
