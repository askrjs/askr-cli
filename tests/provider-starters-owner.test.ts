import fs from "node:fs/promises";
import { expect, test } from "vite-plus/test";

test("the final provider matrix has an explicit executable test owner", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(manifest.scripts["test:provider-starters"]).toBe(
    "vp test run -c vitest.integration.config.ts tests/integration/provider-starters.test.ts",
  );
  await expect(
    fs.access(new URL("./integration/provider-starters.test.ts", import.meta.url)),
  ).resolves.toBeUndefined();
});
