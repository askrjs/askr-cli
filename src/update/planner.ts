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

export type PlannerMode = "update" | "upgrade" | "force";

interface PlannerOptions {
  occurrences: DependencyOccurrence[];
  contextOccurrences?: DependencyOccurrence[];
  packuments: Map<string, Packument>;
  failures?: Map<string, string>;
  tags?: Record<string, string>;
  cliTag?: string;
  mode?: PlannerMode;
  /** @deprecated Use mode. Retained for callers compiled against the original planner. */
  force?: boolean;
  localVersions?: ReadonlyMap<string, string>;
}

interface VersionMetadata extends Record<string, unknown> {
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, unknown>;
}

const STATUS_PRIORITY: Record<UpdateStatus, number> = {
  current: 0,
  local: 1,
  safe: 2,
  breaking: 3,
  manual: 4,
  error: 5,
};

const publishedVersions = (packument: Packument): string[] =>
  Object.keys(packument.versions ?? {})
    .filter((version) => semver.valid(version) !== null)
    .sort(semver.compare);

function selectedTarget(packument: Packument, tag: string): string | null {
  const value = packument["dist-tags"]?.[tag];
  return typeof value === "string" && semver.valid(value) ? value : null;
}

function resolveSpecificationVersion(specification: string, packument: Packument): string | null {
  const parsed = parseDependencySpecification(specification);
  if (parsed.type === "tag") {
    const value = packument["dist-tags"]?.[parsed.rawSpec];
    return typeof value === "string" && semver.valid(value) ? value : null;
  }
  if (parsed.type === "version") return semver.valid(parsed.rawSpec);
  if (parsed.type === "range")
    return semver.maxSatisfying(publishedVersions(packument), parsed.rawSpec);
  return null;
}

function metadata(packument: Packument, version: string): VersionMetadata | null {
  const value = packument.versions?.[version];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as VersionMetadata)
    : null;
}

function baseOccurrence(
  occurrence: DependencyOccurrence,
): Omit<PlannedOccurrence, "status" | "reason"> {
  return {
    workspace: occurrence.workspace,
    manifestPath: occurrence.manifestPath,
    relativeManifestPath: occurrence.relativeManifestPath,
    section: occurrence.section,
    currentSpecification: occurrence.currentSpecification,
    proposedSpecification: null,
    allowedVersion: null,
    selectedVersion: null,
  };
}

function planOne(
  occurrence: DependencyOccurrence,
  packument: Packument | undefined,
  failure: string | undefined,
  tag: string,
  mode: PlannerMode,
  chosen?: string,
  blocker?: string,
): { occurrence: PlannedOccurrence; targetVersion: string | null } {
  const base = baseOccurrence(occurrence);
  if (occurrence.kind === "local")
    return {
      targetVersion: null,
      occurrence: { ...base, status: "local", reason: occurrence.reason },
    };
  if (occurrence.kind === "manual")
    return {
      targetVersion: null,
      occurrence: { ...base, status: "manual", reason: occurrence.reason },
    };
  if (failure)
    return { targetVersion: null, occurrence: { ...base, status: "error", reason: failure } };
  if (!packument)
    return {
      targetVersion: null,
      occurrence: { ...base, status: "error", reason: "package metadata is unavailable" },
    };
  const target = selectedTarget(packument, tag);
  if (!target)
    return {
      targetVersion: null,
      occurrence: { ...base, status: "error", reason: `dist-tag '${tag}' is not published` },
    };
  if (!publishedVersions(packument).includes(target))
    return {
      targetVersion: null,
      occurrence: {
        ...base,
        status: "error",
        reason: `dist-tag '${tag}' does not identify a published version`,
      },
    };
  if (occurrence.kind === "current")
    return {
      targetVersion: target,
      occurrence: { ...base, status: "current", reason: occurrence.reason },
    };
  const allowed = resolveSpecificationVersion(occurrence.currentSpecification, packument);
  if (!allowed)
    return {
      targetVersion: target,
      occurrence: {
        ...base,
        status: "manual",
        reason: "no published version satisfies the current specification",
      },
    };
  const selected = chosen ?? target;
  const withVersions = { ...base, allowedVersion: allowed, selectedVersion: selected };
  if (blocker)
    return {
      targetVersion: target,
      occurrence: { ...withVersions, status: "manual", reason: blocker },
    };
  if (
    semver.satisfies(selected, occurrence.currentSpecification) ||
    !semver.gt(selected, allowed)
  ) {
    return {
      targetVersion: target,
      occurrence: {
        ...withVersions,
        status: "current",
        reason: blocker ?? "selected version is already covered by the current specification",
      },
    };
  }
  const analysis = analyzeRange(occurrence.currentSpecification);
  if (!analysis.shape)
    return {
      targetVersion: target,
      occurrence: { ...withVersions, status: "manual", reason: analysis.reason },
    };
  const breaking = isBreakingChange(allowed, selected);
  if (mode === "update" && breaking)
    return {
      targetVersion: target,
      occurrence: {
        ...withVersions,
        status: "breaking",
        reason: "breaking update is available via askr upgrade",
      },
    };
  return {
    targetVersion: target,
    occurrence: {
      ...withVersions,
      proposedSpecification: rewriteRange(analysis.shape, selected, breaking),
      status: breaking ? "breaking" : "safe",
      reason:
        selected === target
          ? "selected tag target is eligible"
          : `compatible version ${selected} selected below ${tag}@${target}`,
    },
  };
}

interface WorkspaceState {
  occurrence: DependencyOccurrence;
  selected: boolean;
  current: string | null;
  candidates: string[];
}

function optionalPeer(meta: VersionMetadata, peer: string): boolean {
  const value = meta.peerDependenciesMeta?.[peer];
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).optional === true,
  );
}

function solveWorkspace(
  workspace: string,
  selectedOccurrences: DependencyOccurrence[],
  context: DependencyOccurrence[],
  packuments: Map<string, Packument>,
  tags: Record<string, string>,
  cliTag: string | undefined,
  localVersions: ReadonlyMap<string, string>,
  mode: "update" | "upgrade",
): { choices: Map<string, string>; blockers: Map<string, string> } {
  const selectedNames = new Set(
    selectedOccurrences.filter((entry) => entry.kind === "fetch").map((entry) => entry.package),
  );
  const byName = new Map<string, DependencyOccurrence>();
  for (const item of context.filter((entry) => entry.workspace === workspace))
    if (!byName.has(item.package)) byName.set(item.package, item);
  const states = new Map<string, WorkspaceState>();
  for (const [name, occurrence] of byName) {
    const packument = packuments.get(name);
    const current = packument
      ? resolveSpecificationVersion(occurrence.currentSpecification, packument)
      : (localVersions.get(name) ?? null);
    let candidates = current ? [current] : [];
    if (selectedNames.has(name) && packument && current) {
      const target = selectedTarget(packument, cliTag ?? tags[name] ?? "latest");
      if (target)
        candidates = publishedVersions(packument)
          .filter(
            (version) =>
              semver.gte(version, current) &&
              semver.lte(version, target) &&
              (mode === "upgrade" || !isBreakingChange(current, version)),
          )
          .sort(semver.rcompare);
    }
    states.set(name, { occurrence, selected: selectedNames.has(name), current, candidates });
  }
  const variables = [...states.entries()]
    .filter(([, state]) => state.selected && state.candidates.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const fixed = new Map(
    [...states].flatMap(([name, state]) =>
      state.selected ? [] : state.current ? [[name, state.current] as const] : [],
    ),
  );
  let best: Map<string, string> | null = null;
  let bestChanged = -1;
  let firstFailure = "no jointly peer-compatible published version set exists";

  const validate = (choices: Map<string, string>): string | null => {
    const installed = new Map([...fixed, ...choices]);
    for (const [name, version] of installed) {
      const packument = packuments.get(name);
      if (!packument) continue;
      const meta = metadata(packument, version);
      if (!meta) continue;
      for (const [peer, requirement] of Object.entries(meta.peerDependencies ?? {}).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        if (typeof requirement !== "string") continue;
        const providerChanged = states.get(name)?.current !== version;
        const peerChanged =
          states.get(peer)?.selected && states.get(peer)?.current !== installed.get(peer);
        if (!providerChanged && !peerChanged) continue;
        const peerVersion = installed.get(peer) ?? localVersions.get(peer);
        if (!peerVersion) {
          if (optionalPeer(meta, peer)) continue;
          return `${name}@${version} requires missing peer ${peer}@${requirement}`;
        }
        if (!semver.satisfies(peerVersion, requirement, { includePrerelease: true }))
          return `${name}@${version} requires ${peer}@${requirement}`;
      }
    }
    return null;
  };
  const visit = (index: number, choices: Map<string, string>): void => {
    if (index === variables.length) {
      const failure = validate(choices);
      if (failure) {
        firstFailure = failure;
        return;
      }
      const changed = variables.filter(
        ([name, state]) => choices.get(name) !== state.current,
      ).length;
      if (changed > bestChanged) {
        best = new Map(choices);
        bestChanged = changed;
      }
      return;
    }
    const [name, state] = variables[index];
    for (const version of state.candidates) {
      choices.set(name, version);
      visit(index + 1, choices);
    }
  };
  visit(0, new Map());
  const blockers = new Map<string, string>();
  if (!best) for (const [name] of variables) blockers.set(name, firstFailure);
  const choices =
    best ??
    new Map(
      variables.flatMap(([name, state]) => (state.current ? [[name, state.current] as const] : [])),
    );
  for (const [name, state] of variables) {
    if (choices.get(name) !== state.current || state.candidates[0] === state.current) continue;
    const attempted = new Map(choices).set(name, state.candidates[0]);
    blockers.set(
      name,
      validate(attempted) ?? "no jointly peer-compatible update advances this dependency",
    );
  }
  return { choices, blockers };
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
  const mode: PlannerMode = options.mode ?? (options.force ? "upgrade" : "update");
  const context = options.contextOccurrences ?? options.occurrences;
  const workspaceSolutions = new Map<string, ReturnType<typeof solveWorkspace>>();
  if (mode !== "force") {
    for (const workspace of new Set(options.occurrences.map((entry) => entry.workspace)))
      workspaceSolutions.set(
        workspace,
        solveWorkspace(
          workspace,
          options.occurrences.filter((entry) => entry.workspace === workspace),
          context,
          options.packuments,
          tags,
          options.cliTag,
          options.localVersions ?? new Map(),
          mode,
        ),
      );
  }
  const grouped = new Map<string, DependencyOccurrence[]>();
  for (const occurrence of options.occurrences)
    grouped.set(occurrence.package, [...(grouped.get(occurrence.package) ?? []), occurrence]);
  const decisions = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([packageName, occurrences]): PackageDecision => {
      const selectedTag = options.cliTag ?? tags[packageName] ?? "latest";
      const planned = occurrences.map((occurrence) => {
        const solution = workspaceSolutions.get(occurrence.workspace);
        const blocker = solution?.blockers.get(packageName);
        const chosen =
          mode === "update" && !blocker ? undefined : solution?.choices.get(packageName);
        return planOne(
          occurrence,
          options.packuments.get(packageName),
          failures.get(packageName),
          selectedTag,
          mode,
          chosen,
          blocker,
        );
      });
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
  for (const [packageName, failure] of [...failures].sort(([a], [b]) => a.localeCompare(b))) {
    if (selectedNames.has(packageName)) continue;
    const occurrences = context
      .filter((entry) => entry.package === packageName)
      .map(
        (entry): PlannedOccurrence => ({
          ...baseOccurrence(entry),
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
      occurrences,
    });
  }
  decisions.sort((a, b) => a.package.localeCompare(b.package));
  const summary = summarize(decisions);
  return { decisions, summary, hasErrors: summary.error > 0 };
}
