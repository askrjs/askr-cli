import { describe, expect, test } from "vitest";
import { analyzeRange } from "../src/update/range";
import { planUpdates } from "../src/update/planner";
import type { DependencyOccurrence, Packument } from "../src/update/types";

function occurrence(specification: string, packageName = "fixture"): DependencyOccurrence {
  return {
    package: packageName,
    workspace: "fixture-app",
    manifestPath: "/fixture/package.json",
    relativeManifestPath: "package.json",
    section: "devDependencies",
    currentSpecification: specification,
    kind: "fetch",
    registryManaged: true,
    reason: "",
  };
}

function packument(target: string, versions: string[]): Packument {
  return {
    "dist-tags": { latest: target },
    versions: Object.fromEntries(versions.map((version) => [version, { version }])),
  };
}

function proposal(
  specification: string,
  target: string,
  versions: string[],
  force = false,
): ReturnType<typeof planUpdates>["decisions"][number]["occurrences"][number] {
  return planUpdates({
    occurrences: [occurrence(specification)],
    packuments: new Map([["fixture", packument(target, versions)]]),
    force,
  }).decisions[0].occurrences[0];
}

describe("update range planner", () => {
  test("should leave a covered bounded range unchanged given a target inside it when planning", () => {
    expect(proposal(">=0.0.53 <0.1.0", "0.0.61", ["0.0.53", "0.0.61"])).toMatchObject({
      status: "current",
      proposedSpecification: null,
    });
  });

  test("should widen the upper boundary given a compatible target outside a bounded range when planning", () => {
    expect(proposal(">=1.2 <1.5", "1.8.4", ["1.4.9", "1.8.4"])).toMatchObject({
      status: "safe",
      proposedSpecification: ">=1.2 <2.0.0",
    });
  });

  test("should preserve exact style given a compatible target when planning", () => {
    expect(proposal("1.2.3", "1.8.4", ["1.2.3", "1.8.4"]).proposedSpecification).toBe("1.8.4");
  });

  test("should preserve caret style given a compatible target when planning", () => {
    expect(proposal("^0.0.53", "0.0.61", ["0.0.53", "0.0.61"]).proposedSpecification).toBe(
      "^0.0.61",
    );
  });

  test("should preserve tilde style given a compatible target when planning", () => {
    expect(proposal("~1.2.0", "1.8.4", ["1.2.9", "1.8.4"]).proposedSpecification).toBe("~1.8.4");
  });

  test("should preserve x-range style given a compatible target when planning", () => {
    expect(proposal("1.2.x", "1.8.4", ["1.2.9", "1.8.4"]).proposedSpecification).toBe("1.8.x");
  });

  test("should skip a stable major change given force is absent when planning", () => {
    expect(proposal("^1.4.0", "2.1.0", ["1.9.0", "2.1.0"])).toMatchObject({
      status: "breaking",
      proposedSpecification: null,
    });
  });

  test("should skip a pre-one minor change given force is absent when planning", () => {
    expect(proposal(">=0.0.53 <0.1.0", "0.1.4", ["0.0.61", "0.1.4"])).toMatchObject({
      status: "breaking",
      proposedSpecification: null,
    });
  });

  test("should rebase a bounded range given a breaking target and force when planning", () => {
    expect(proposal(">=0.0.53 <0.1.0", "0.1.4", ["0.0.61", "0.1.4"], true)).toMatchObject({
      status: "breaking",
      proposedSpecification: ">=0.1.4 <0.2.0",
    });
  });

  test("should update only the highest clause given a compatible simple union when planning", () => {
    expect(proposal(">=1.0 <1.3 || >=1.4 <1.6", "1.8.0", ["1.5.0", "1.8.0"])).toMatchObject({
      status: "safe",
      proposedSpecification: ">=1.0 <1.3 || >=1.4 <2.0.0",
    });
  });

  test("should rebase a union to its highest clause style given force when planning", () => {
    expect(proposal("^0.1.0 || ~0.2.0", "0.3.0", ["0.2.9", "0.3.0"], true)).toMatchObject({
      status: "breaking",
      proposedSpecification: "~0.3.0",
    });
  });

  test("should reject a hyphen range given an unsupported complex specification when analyzing", () => {
    expect(analyzeRange("1.2.0 - 1.8.0")).toMatchObject({
      shape: null,
      reason: "unsupported complex semver range",
    });
  });

  test("should block a target given a co-dependency peer range excludes it when planning", () => {
    const typescript = occurrence("^6.0.0", "typescript");
    const vitePlus = occurrence("^0.1.0", "vite-plus");
    const plan = planUpdates({
      occurrences: [typescript],
      contextOccurrences: [typescript, vitePlus],
      packuments: new Map([
        ["typescript", packument("7.0.0", ["6.9.0", "7.0.0"])],
        [
          "vite-plus",
          {
            "dist-tags": { latest: "0.1.2" },
            versions: {
              "0.1.2": {
                version: "0.1.2",
                peerDependencies: { typescript: "^6.0.0" },
              },
            },
          },
        ],
      ]),
      force: true,
    });

    expect(plan.decisions[0].occurrences[0]).toMatchObject({
      status: "manual",
      proposedSpecification: null,
      reason: "vite-plus@0.1.2 requires typescript@^6.0.0",
    });
  });

  test("should block a provider target given its new peer range excludes a co-dependency when planning", () => {
    const vitePlus = occurrence("~1.0.0", "vite-plus");
    const typescript = occurrence("^6.0.0", "typescript");
    const plan = planUpdates({
      occurrences: [vitePlus],
      contextOccurrences: [vitePlus, typescript],
      packuments: new Map([
        [
          "vite-plus",
          {
            "dist-tags": { latest: "1.1.0" },
            versions: {
              "1.0.0": { version: "1.0.0", peerDependencies: { typescript: "^6.0.0" } },
              "1.1.0": { version: "1.1.0", peerDependencies: { typescript: "^7.0.0" } },
            },
          },
        ],
        ["typescript", packument("6.9.0", ["6.9.0"])],
      ]),
    });

    expect(plan.decisions[0].occurrences[0]).toMatchObject({
      status: "manual",
      proposedSpecification: null,
      reason: "vite-plus@1.1.0 requires typescript@^7.0.0",
    });
  });
});
