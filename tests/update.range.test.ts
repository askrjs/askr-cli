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
  test("should rebase a covered bounded range given a newer target inside it when planning", () => {
    expect(proposal(">=0.0.53 <0.1.0", "0.0.61", ["0.0.53", "0.0.61"])).toMatchObject({
      status: "safe",
      proposedSpecification: ">=0.0.61 <0.1.0",
    });
  });

  test("should widen the upper boundary given a compatible target outside a bounded range when planning", () => {
    expect(proposal(">=1.2 <1.5", "1.8.4", ["1.4.9", "1.8.4"])).toMatchObject({
      status: "safe",
      proposedSpecification: ">=1.8.4 <2.0.0",
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
      proposedSpecification: ">=1.0 <1.3 || >=1.8.0 <2.0.0",
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

  test("should move selected peers together given compatible targets when upgrading", () => {
    const app = occurrence("^1.0.0", "app");
    const peer = occurrence("^1.0.0", "peer");
    const plan = planUpdates({
      occurrences: [app, peer],
      contextOccurrences: [app, peer],
      mode: "upgrade",
      packuments: new Map([
        [
          "app",
          {
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": { version: "1.0.0", peerDependencies: { peer: "^1" } },
              "2.0.0": { version: "2.0.0", peerDependencies: { peer: "^2" } },
            },
          },
        ],
        ["peer", packument("2.0.0", ["1.0.0", "2.0.0"])],
      ]),
    });
    expect(plan.decisions.map((decision) => decision.occurrences[0].selectedVersion)).toEqual([
      "2.0.0",
      "2.0.0",
    ]);
  });

  test("should resolve a valid peer set when a singleton domain is assigned", () => {
    const app = occurrence("^1.0.0", "app");
    const peer = occurrence("^1.0.0", "peer");
    const plan = planUpdates({
      occurrences: [app, peer],
      contextOccurrences: [app, peer],
      mode: "upgrade",
      packuments: new Map([
        [
          "app",
          {
            "dist-tags": { latest: "1.1.0" },
            versions: {
              "1.0.0": { version: "1.0.0" },
              "1.1.0": { version: "1.1.0", peerDependencies: { peer: "^1.1.0" } },
            },
          },
        ],
        ["peer", packument("1.1.0", ["1.0.0", "1.1.0"])],
      ]),
    });

    expect(plan.decisions.map((decision) => decision.occurrences[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "safe", selectedVersion: "1.1.0" }),
        expect.objectContaining({ status: "safe", selectedVersion: "1.1.0" }),
      ]),
    );
  });

  test("should choose an older compatible release below latest when upgrading", () => {
    const app = occurrence("^1.0.0", "app");
    const peer = occurrence("^1.0.0", "peer");
    const plan = planUpdates({
      occurrences: [app],
      contextOccurrences: [app, peer],
      mode: "upgrade",
      packuments: new Map([
        [
          "app",
          {
            "dist-tags": { latest: "2.1.0" },
            versions: {
              "1.0.0": { version: "1.0.0" },
              "2.0.0": { version: "2.0.0", peerDependencies: { peer: "^1" } },
              "2.1.0": { version: "2.1.0", peerDependencies: { peer: "^2" } },
            },
          },
        ],
        ["peer", packument("1.9.0", ["1.9.0"])],
      ]),
    });
    expect(plan.decisions[0]).toMatchObject({ targetVersion: "2.1.0" });
    expect(plan.decisions[0].occurrences[0]).toMatchObject({
      selectedVersion: "2.0.0",
      proposedSpecification: "^2.0.0",
    });
  });

  test("should allow a missing optional peer and reject a missing required peer when upgrading", () => {
    const optional = occurrence("1.0.0", "optional-provider");
    const required = occurrence("1.0.0", "required-provider");
    const plan = planUpdates({
      occurrences: [optional, required],
      contextOccurrences: [optional, required],
      mode: "upgrade",
      packuments: new Map([
        [
          "optional-provider",
          {
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": { version: "1.0.0" },
              "2.0.0": {
                version: "2.0.0",
                peerDependencies: { absent: "^1" },
                peerDependenciesMeta: { absent: { optional: true } },
              },
            },
          },
        ],
        [
          "required-provider",
          {
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": { version: "1.0.0" },
              "2.0.0": { version: "2.0.0", peerDependencies: { absent: "^1" } },
            },
          },
        ],
      ]),
    });
    expect(
      plan.decisions.find((decision) => decision.package === "optional-provider")?.occurrences[0]
        .proposedSpecification,
    ).toBe("2.0.0");
    expect(
      plan.decisions.find((decision) => decision.package === "required-provider")?.occurrences[0],
    ).toMatchObject({
      status: "manual",
      reason: "required-provider@2.0.0 requires missing peer absent@^1",
    });
  });

  test("should use the tag target despite peer conflicts in force mode", () => {
    const provider = occurrence("^1.0.0", "provider");
    const peer = occurrence("^1.0.0", "peer");
    const plan = planUpdates({
      occurrences: [provider],
      contextOccurrences: [provider, peer],
      mode: "force",
      packuments: new Map([
        [
          "provider",
          {
            "dist-tags": { next: "2.0.0" },
            versions: {
              "1.0.0": { version: "1.0.0" },
              "2.0.0": { version: "2.0.0", peerDependencies: { peer: "^2" } },
            },
          },
        ],
        ["peer", packument("1.0.0", ["1.0.0"])],
      ]),
      cliTag: "next",
    });
    expect(plan.decisions[0].occurrences[0]).toMatchObject({
      selectedVersion: "2.0.0",
      proposedSpecification: "^2.0.0",
    });
  });

  test("should leave a dense component unchanged when the exact search budget is exhausted", () => {
    const names = Array.from({ length: 7 }, (_, index) => `dense-${index}`);
    const versions = Array.from({ length: 8 }, (_, index) => `1.${index}.0`);
    const occurrences = names.map((name) => occurrence("1.0.0", name));
    const packuments = new Map(
      names.map((name) => [
        name,
        {
          "dist-tags": { latest: versions.at(-1) },
          versions: Object.fromEntries(
            versions.map((version) => [
              version,
              {
                version,
                peerDependencies: Object.fromEntries(
                  names.filter((peer) => peer !== name).map((peer) => [peer, "*"]),
                ),
              },
            ]),
          ),
        },
      ]),
    );
    const plan = planUpdates({
      occurrences,
      contextOccurrences: occurrences,
      mode: "upgrade",
      packuments,
    });

    expect(
      plan.decisions.every((decision) => decision.occurrences[0].selectedVersion === "1.0.0"),
    ).toBe(true);
    expect(
      plan.decisions.every((decision) =>
        decision.occurrences[0].reason.includes("50,000-state budget"),
      ),
    ).toBe(true);
  }, 15_000);
});
