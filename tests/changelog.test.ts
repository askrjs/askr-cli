import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("should ensure changelog has unreleased and current-version sections", async () => {
  const [manifestSource, changelog] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ]);
  const { version } = JSON.parse(manifestSource) as { version: string };

  expect(changelog).toMatch(/^## \[Unreleased\]$/m);
  expect(changelog).toMatch(
    new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"),
  );
});
