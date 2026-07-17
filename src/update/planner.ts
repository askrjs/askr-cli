import semver from "semver";
import { analyzeRange, isBreakingChange, rewriteRange } from "./range";
import { parseDependencySpecification } from "./specification";
import type {
  DependencyOccurrence,
  PackageDecision,
  Packument,
  PlannedOccurrence,
  UpdatePlan,
  UpdateStatus,
  UpdateSummary,
} from "./types";

interface PlannerOptions {
  occurrences: DependencyOccurrence[];
  contextOccurrences?: DependencyOccurrence[];
  packuments: Map<string, Packument>;
  failures?: Map<string, string>;
  tags?: Record<string, string>;
  cliTag?: string;
  force?: boolean;
}

interface VersionMetadata extends Record<string, unknown> {
  peerDependencies?: Record<string, unknown>;
}

const STATUS_PRIORITY: Record<UpdateStatus, number> = {
  current: 0,
  local: 1,
  safe: 2,
  breaking: 3,
  manual: 4,
  error: 5,
};

function publishedVersions(packument: Packument): string[] {
  return Object.keys(packument.versions ?? {})
    .filter((version) => semver.valid(version) !== null)
    .sort(semver.compare);
}

function selectedTarget(packument: Packument, tag: string): string | null {
  const value = packument["dist-tags"]?.[tag];
  return typeof value === "string" && semver.valid(value) ? value : null;
}

function plannedOccurrence(
  occurrence: DependencyOccurrence,
  packument: Packument | undefined,
  failure: string | undefined,
  selectedTag: string,
  force: boolean,
): { occurrence: PlannedOccurrence; targetVersion: string | null } {
  const base = {
    workspace: occurrence.workspace,
    manifestPath: occurrence.manifestPath,
    relativeManifestPath: occurrence.relativeManifestPath,
    section: occurrence.section,
    currentSpecification: occurrence.currentSpecification,
    proposedSpecification: null,
    allowedVersion: null,
  };

  if (occurrence.kind === "local") {
    return {
      targetVersion: null,
      occurrence: { ...base, status: "local", reason: occurrence.reason },
    };
  }
  if (occurrence.kind === "manual") {
    return {
      targetVersion: null,
      occurrence: { ...base, status: "manual", reason: occurrence.reason },
    };
  }
  if (failure) {
    return {
      targetVersion: null,
      occurrence: { ...base, status: "error", reason: failure },
    };
  }
  if (occurrence.kind === "current") {
    return {
      targetVersion: packument ? selectedTarget(packument, selectedTag) : null,
      occurrence: { ...base, status: "current", reason: occurrence.reason },
    };
  }
  if (!packument) {
    return {
      targetVersion: null,
      occurrence: { ...base, status: "error", reason: "package metadata is unavailable" },
    };
  }

  const targetVersion = selectedTarget(packument, selectedTag);
  if (!targetVersion) {
    return {
      targetVersion: null,
      occurrence: {
        ...base,
        status: "error",
        reason: `dist-tag '${selectedTag}' is not published`,
      },
    };
  }

  const versions = publishedVersions(packument);
  if (!versions.includes(targetVersion)) {
    return {
      targetVersion: null,
      occurrence: {
        ...base,
        status: "error",
        reason: `dist-tag '${selectedTag}' does not identify a published version`,
      },
    };
  }
  const allowedVersion = semver.maxSatisfying(versions, occurrence.currentSpecification);
  if (!allowedVersion) {
    return {
      targetVersion,
      occurrence: {
        ...base,
        status: "manual",
        reason: "no published version satisfies the current specification",
      },
    };
  }
  if (
    semver.satisfies(targetVersion, occurrence.currentSpecification) ||
    !semver.gt(targetVersion, allowedVersion)
  ) {
    return {
      targetVersion,
      occurrence: {
        ...base,
        allowedVersion,
        status: "current",
        reason: "selected target is already covered by the current specification",
      },
    };
  }

  const analysis = analyzeRange(occurrence.currentSpecification);
  if (!analysis.shape) {
    return {
      targetVersion,
      occurrence: { ...base, allowedVersion, status: "manual", reason: analysis.reason },
    };
  }

  const breaking = isBreakingChange(allowedVersion, targetVersion);
  const eligible = !breaking || force;
  return {
    targetVersion,
    occurrence: {
      ...base,
      allowedVersion,
      proposedSpecification: eligible
        ? rewriteRange(analysis.shape, targetVersion, breaking)
        : null,
      status: breaking ? "breaking" : "safe",
      reason: breaking
        ? eligible
          ? "latest version is eligible for askr upgrade"
          : "breaking update is available via askr upgrade"
        : "compatible update is available",
    },
  };
}

function occurrenceKey(
  occurrence: {
    manifestPath: string;
    section: string;
    currentSpecification: string;
  } & ({ package: string } | { package?: never }),
  packageName?: string,
): string {
  return [
    occurrence.manifestPath,
    occurrence.section,
    packageName ?? occurrence.package,
    occurrence.currentSpecification,
  ].join("\u0000");
}

function resolveSpecificationVersion(specification: string, packument: Packument): string | null {
  const versions = publishedVersions(packument);
  const parsed = parseDependencySpecification(specification);
  if (parsed.type === "tag") {
    const tagged = packument["dist-tags"]?.[parsed.rawSpec];
    return typeof tagged === "string" && semver.valid(tagged) ? tagged : null;
  }
  if (parsed.type === "version") return semver.valid(parsed.rawSpec);
  if (parsed.type === "range") return semver.maxSatisfying(versions, parsed.rawSpec);
  return null;
}

function versionMetadata(packument: Packument, version: string): VersionMetadata | null {
  const metadata = packument.versions?.[version];
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as VersionMetadata)
    : null;
}

function applyPeerCompatibilityGuard(
  decisions: PackageDecision[],
  contextOccurrences: DependencyOccurrence[],
  packuments: Map<string, Packument>,
): void {
  const plannedByKey = new Map<string, PlannedOccurrence>();
  for (const decision of decisions) {
    for (const occurrence of decision.occurrences) {
      plannedByKey.set(occurrenceKey(occurrence, decision.package), occurrence);
    }
  }

  const contextByWorkspace = new Map<string, DependencyOccurrence[]>();
  for (const occurrence of contextOccurrences) {
    const entries = contextByWorkspace.get(occurrence.workspace) ?? [];
    entries.push(occurrence);
    contextByWorkspace.set(occurrence.workspace, entries);
  }

  for (const [workspace, context] of contextByWorkspace) {
    const states = context.flatMap((dependency) => {
      if (!dependency.registryManaged) return [];
      const packument = packuments.get(dependency.package);
      if (!packument) return [];
      const planned = plannedByKey.get(occurrenceKey(dependency));
      const currentVersion = resolveSpecificationVersion(
        dependency.currentSpecification,
        packument,
      );
      const futureSpecification = planned?.proposedSpecification ?? dependency.currentSpecification;
      const futureVersion = resolveSpecificationVersion(futureSpecification, packument);
      return currentVersion && futureVersion
        ? [
            {
              dependency,
              packument,
              planned,
              currentVersion,
              futureVersion,
              changed: Boolean(planned?.proposedSpecification),
            },
          ]
        : [];
    });
    const blockers = new Map<PlannedOccurrence, string>();

    for (const provider of states) {
      const currentPeers =
        versionMetadata(provider.packument, provider.currentVersion)?.peerDependencies ?? {};
      const futurePeers =
        versionMetadata(provider.packument, provider.futureVersion)?.peerDependencies ?? {};
      const peerNames = new Set([...Object.keys(currentPeers), ...Object.keys(futurePeers)]);
      for (const peerName of peerNames) {
        const currentRequirement = currentPeers[peerName];
        const futureRequirement = futurePeers[peerName];
        if (futureRequirement !== undefined && typeof futureRequirement !== "string") continue;

        for (const peer of states.filter((state) => state.dependency.package === peerName)) {
          const currentAccepted =
            typeof currentRequirement !== "string" ||
            semver.satisfies(peer.currentVersion, currentRequirement);
          const futureAccepted =
            typeof futureRequirement !== "string" ||
            semver.satisfies(peer.futureVersion, futureRequirement);
          if (!currentAccepted || futureAccepted) continue;

          const reason = `${provider.dependency.package}@${provider.futureVersion} requires ${peerName}@${futureRequirement}`;
          if (provider.changed && provider.planned) blockers.set(provider.planned, reason);
          if (peer.changed && peer.planned) blockers.set(peer.planned, reason);
        }
      }
    }

    for (const [planned, reason] of blockers) {
      planned.status = "manual";
      planned.proposedSpecification = null;
      planned.reason = reason;
    }

    void workspace;
  }
}

function aggregateStatus(occurrences: PlannedOccurrence[]): UpdateStatus {
  return occurrences.reduce<UpdateStatus>(
    (status, occurrence) =>
      STATUS_PRIORITY[occurrence.status] > STATUS_PRIORITY[status] ? occurrence.status : status,
    "current",
  );
}

function summarize(decisions: PackageDecision[]): UpdateSummary {
  const summary: UpdateSummary = {
    packages: decisions.length,
    occurrences: 0,
    changedOccurrences: 0,
    current: 0,
    safe: 0,
    breaking: 0,
    local: 0,
    manual: 0,
    error: 0,
  };
  for (const decision of decisions) {
    decision.status = aggregateStatus(decision.occurrences);
    decision.reason =
      decision.occurrences.find((entry) => entry.status === decision.status)?.reason ?? "";
    summary[decision.status] += 1;
    summary.occurrences += decision.occurrences.length;
    summary.changedOccurrences += decision.occurrences.filter(
      (entry) => entry.proposedSpecification,
    ).length;
  }
  return summary;
}

export function planUpdates(options: PlannerOptions): UpdatePlan {
  const failures = options.failures ?? new Map<string, string>();
  const tags = options.tags ?? {};
  const grouped = new Map<string, DependencyOccurrence[]>();
  for (const occurrence of options.occurrences) {
    const entries = grouped.get(occurrence.package) ?? [];
    entries.push(occurrence);
    grouped.set(occurrence.package, entries);
  }

  const decisions = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, occurrences]): PackageDecision => {
      const selectedTag = options.cliTag ?? tags[packageName] ?? "latest";
      const planned = occurrences.map((occurrence) =>
        plannedOccurrence(
          occurrence,
          options.packuments.get(packageName),
          failures.get(packageName),
          selectedTag,
          options.force ?? false,
        ),
      );
      const targetVersion = planned.find((entry) => entry.targetVersion)?.targetVersion ?? null;
      const plannedOccurrences = planned.map((entry) => entry.occurrence);
      const status = aggregateStatus(plannedOccurrences);
      return {
        package: packageName,
        selectedTag,
        targetVersion,
        status,
        reason: plannedOccurrences.find((entry) => entry.status === status)?.reason ?? "",
        occurrences: plannedOccurrences,
      };
    });

  const selectedNames = new Set(grouped.keys());
  for (const [packageName, failure] of [...failures].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (selectedNames.has(packageName)) continue;
    const context = (options.contextOccurrences ?? [])
      .filter((occurrence) => occurrence.package === packageName)
      .map(
        (occurrence): PlannedOccurrence => ({
          workspace: occurrence.workspace,
          manifestPath: occurrence.manifestPath,
          relativeManifestPath: occurrence.relativeManifestPath,
          section: occurrence.section,
          currentSpecification: occurrence.currentSpecification,
          proposedSpecification: null,
          allowedVersion: null,
          status: "error",
          reason: `peer compatibility lookup failed: ${failure}`,
        }),
      );
    decisions.push({
      package: packageName,
      selectedTag: options.cliTag ?? tags[packageName] ?? "latest",
      targetVersion: null,
      status: "error",
      reason: `peer compatibility lookup failed: ${failure}`,
      occurrences: context,
    });
  }
  decisions.sort((left, right) => left.package.localeCompare(right.package));

  applyPeerCompatibilityGuard(
    decisions,
    options.contextOccurrences ?? options.occurrences,
    options.packuments,
  );
  const summary = summarize(decisions);
  return { decisions, summary, hasErrors: summary.error > 0 };
}
