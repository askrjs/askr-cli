import { describe, expect, it } from "vitest";
import { isTestSourcePath } from "../src/analyze/source-paths";

describe("color fixture path classification", () => {
  it.each([
    "C:\\workspace\\tests\\nested\\palette.ts",
    "C:\\workspace\\src\\palette.tests.tsx",
    "/workspace/__tests__/nested/palette.cjs",
    "/workspace/test/palette.mts",
    "/workspace/src/palette.tests.mjs",
    "/workspace/src/palette.spec.jsx",
  ])("should recognize the test source %s", (fileName) => {
    expect(isTestSourcePath(fileName)).toBe(true);
  });

  it.each([
    "C:\\workspace\\tests-utils\\palette.ts",
    "/workspace/testimonials/palette.ts",
    "/workspace/src/contest.ts",
    "/workspace/src/palette.tests-helper.ts",
    "/workspace/src/palette.test.config.ts",
  ])("should retain production color checks for %s", (fileName) => {
    expect(isTestSourcePath(fileName)).toBe(false);
  });
});
