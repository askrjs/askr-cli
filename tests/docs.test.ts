import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDocs } from "../src/docs";

describe("API documentation contract", () => {
  it("inspects shipped declarations, members, parameters, and returns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-docs-"));
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@fixture/docs", exports: { ".": { types: "./dist/index.d.ts" } } }),
    );
    await fs.writeFile(
      path.join(root, "dist/index.d.ts"),
      `/** Adds two values. */\nexport declare function add(/** left value */ left: number, right: number): number;\n/** Options for a widget. */\nexport interface WidgetOptions {\n  /** Widget label. */\n  label: string;\n}\n`,
    );
    const result = await inspectDocs(root);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ symbol: "add", missing: "@param left" }),
      expect.objectContaining({ symbol: "add", missing: "@param right" }),
      expect.objectContaining({ symbol: "add", missing: "@returns" }),
    ]);
    expect(result.snapshot.symbols.map((symbol) => symbol.name)).toEqual(["add", "WidgetOptions"]);
    expect(
      result.snapshot.symbols.find((symbol) => symbol.name === "WidgetOptions")?.members[0]
        ?.summary,
    ).toBe("Widget label.");
  });

  it("checks .d.mts declarations, exact parameter names, and overload signatures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-docs-esm-"));
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "@fixture/esm-docs",
        exports: { ".": { types: "./dist/index.d.mts" } },
      }),
    );
    await fs.writeFile(
      path.join(root, "dist/index.d.mts"),
      `/** Supports both strings and numbers. @param identifier Input value. @returns Converted value. */
export declare function convert(id: string): string;
export declare function convert(identifier: number): number;
/** A named payload. */
export type Payload = { value: string };
`,
    );
    const result = await inspectDocs(root);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ symbol: "convert", missing: "@param id" }),
    ]);
    const signature =
      result.snapshot.symbols.find((symbol) => symbol.name === "convert")?.signature ?? "";
    expect(signature).toContain("string");
    expect(signature).toContain("number");
    expect(
      result.snapshot.symbols.find((symbol) => symbol.name === "Payload")?.signature,
    ).toContain("value");
  });
});
