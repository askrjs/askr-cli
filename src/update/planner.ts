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
  dependencies?: Record<string, unknown>;
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
    occurrence.section === "peerDependencies" &&
    semver.satisfies(selected, occurrence.currentSpecification, { includePrerelease: true })
  )
    return {
      targetVersion: target,
      occurrence: {
        ...withVersions,
        status: "current",
        reason: "the selected version remains supported by the declared peer range",
      },
    };
  const declared = semver.minVersion(occurrence.currentSpecification)?.version ?? allowed;
  if (!semver.gt(selected, declared)) {
    return {
      targetVersion: target,
      occurrence: {
        ...withVersions,
        status: "current",
        reason:
          selected === target
            ? "the declared version is current"
            : `compatible version ${selected} selected below ${tag}@${target}`,
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
  const proposedSpecification = rewriteRange(analysis.shape, selected, breaking);
  if (proposedSpecification === occurrence.currentSpecification) {
    return {
      targetVersion: target,
      occurrence: {
        ...withVersions,
        status: "current",
        reason: "the selected version cannot further rebase this range style",
      },
    };
  }
  return {
    targetVersion: target,
    occurrence: {
      ...withVersions,
      proposedSpecification,
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
): {
  choices: Map<string, string>;
  blockers: Map<string, string>;
  constrained: Set<string>;
} {
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
      const minimum = semver.minVersion(occurrence.currentSpecification)?.version ?? current;
      if (target)
        candidates = publishedVersions(packument)
          .filter(
            (version) =>
              semver.gte(version, minimum) &&
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
  const fixed = new Map<string, string>(
    [...states].flatMap(([name, state]) =>
      state.selected ? [] : state.current ? [[name, state.current] as const] : [],
    ),
  );
  const currentChoices = new Map(
    variables.flatMap(([name, state]) => (state.current ? [[name, state.current] as const] : [])),
  );

  const validate = (
    choices: ReadonlyMap<string, string>,
    domains?: ReadonlyMap<string, readonly string[]>,
  ): string | null => {
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
        const assignedPeer = choices.get(peer);
        const peerChanged =
          assignedPeer !== undefined && states.get(peer)?.current !== assignedPeer;
        if (!providerChanged && !peerChanged) continue;
        const peerVersion =
          assignedPeer ?? (states.get(peer)?.selected ? undefined : installed.get(peer));
        if (!peerVersion) {
          const peerDomain = domains?.get(peer);
          if (
            peerDomain?.some((candidate) =>
              semver.satisfies(candidate, requirement, { includePrerelease: true }),
            )
          )
            continue;
          if (optionalPeer(meta, peer)) continue;
          return `${name}@${version} requires missing peer ${peer}@${requirement}`;
        }
        if (!semver.satisfies(peerVersion, requirement, { includePrerelease: true }))
          return `${name}@${version} requires ${peer}@${requirement}`;
      }
      for (const [dependency, requirement] of Object.entries(meta.dependencies ?? {}).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        if (typeof requirement !== "string" || !semver.validRange(requirement)) continue;
        const providerChanged = states.get(name)?.current !== version;
        const assignedDependency = choices.get(dependency);
        const dependencyChanged =
          assignedDependency !== undefined &&
          states.get(dependency)?.current !== assignedDependency;
        if (!providerChanged && !dependencyChanged) continue;
        const dependencyVersion = assignedDependency ?? installed.get(dependency);
        if (!dependencyVersion) continue;
        if (!semver.satisfies(dependencyVersion, requirement, { includePrerelease: true }))
          return `${name}@${version} requires ${dependency}@${requirement}`;
      }
    }
    return null;
  };

  // Join only packages that can constrain one another. Independent packages are
  // resolved immediately instead of inflating a whole-workspace Cartesian search.
  const edges = new Map(variables.map(([name]) => [name, new Set<string>()]));
  const constrained = new Set<string>();
  for (const [name, state] of variables) {
    for (const version of state.candidates) {
      const meta = metadata(packuments.get(name)!, version);
      for (const constraints of [meta?.dependencies, meta?.peerDependencies]) {
        for (const dependency of Object.keys(constraints ?? {})) {
          if (states.has(dependency)) constrained.add(name);
          if (!edges.has(dependency)) continue;
          constrained.add(dependency);
          edges.get(name)!.add(dependency);
          edges.get(dependency)!.add(name);
        }
      }
    }
  }
  const components: string[][] = [];
  const unseen = new Set(edges.keys());
  while (unseen.size > 0) {
    const start = [...unseen].sort()[0];
    const component: string[] = [];
    const pending = [start];
    unseen.delete(start);
    while (pending.length > 0) {
      const name = pending.pop()!;
      component.push(name);
      for (const neighbor of [...edges.get(name)!].sort().reverse()) {
        if (!unseen.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }
    components.push(component.sort());
  }

  const choices = new Map(currentChoices);
  const blockers = new Map<string, string>();
  for (const component of components) {
    const componentSet = new Set(component);
    const baseChoices = new Map([...choices].filter(([name]) => !componentSet.has(name)));
    const domains = new Map(component.map((name) => [name, states.get(name)!.candidates] as const));
    let best: Map<string, string> | null = null;
    let bestVector: number[] = [];
    let statesVisited = 0;
    let exhausted = false;
    let firstFailure = "no jointly peer-compatible published version set exists";
    const memo = new Set<string>();

    const visit = (assigned: Map<string, string>): void => {
      if (exhausted) return;
      statesVisited += 1;
      if (statesVisited > 50_000) {
        exhausted = true;
        return;
      }
      const merged = new Map([...baseChoices, ...assigned]);
      const remaining = component.filter((name) => !assigned.has(name));
      const pruned = new Map<string, readonly string[]>();
      for (const name of remaining) {
        const viable = domains
          .get(name)!
          .filter((version) => validate(new Map([...merged, [name, version]]), domains) === null);
        if (viable.length === 0) {
          firstFailure = validate(merged, domains) ?? firstFailure;
          return;
        }
        pruned.set(name, viable);
      }
      const failure = validate(merged, new Map([...domains, ...pruned]));
      if (failure) {
        firstFailure = failure;
        return;
      }
      if (remaining.length === 0) {
        const vector = component.map((name) =>
          states.get(name)!.candidates.indexOf(assigned.get(name)!),
        );
        const newer = vector.some(
          (value, index) =>
            value < (bestVector[index] ?? Number.POSITIVE_INFINITY) &&
            vector.slice(0, index).every((prior, priorIndex) => prior === bestVector[priorIndex]),
        );
        if (!best || newer) {
          best = new Map(assigned);
          bestVector = vector;
        }
        return;
      }
      const next = remaining
        .map((name) => [name, pruned.get(name)!] as const)
        .sort(
          ([leftName, left], [rightName, right]) =>
            left.length - right.length || leftName.localeCompare(rightName),
        )[0];
      const signature = component
        .map((name) =>
          assigned.has(name)
            ? `${name}=assigned:${assigned.get(name)}`
            : `${name}=domain:${(pruned.get(name) ?? []).join(",")}`,
        )
        .join("|");
      if (memo.has(signature)) return;
      memo.add(signature);
      for (const version of next[1]) {
        assigned.set(next[0], version);
        visit(assigned);
        assigned.delete(next[0]);
      }
    };
    visit(new Map());

    if (exhausted) {
      const reason =
        "peer compatibility search exceeded the 50,000-state budget; resolve this component manually";
      for (const name of component) blockers.set(name, reason);
    } else if (!best) {
      for (const name of component) blockers.set(name, firstFailure);
    } else {
      for (const [name, version] of best as Map<string, string>) choices.set(name, version);
    }
  }

  for (const [name, state] of variables) {
    if (blockers.has(name)) continue;
    if (choices.get(name) !== state.current || state.candidates[0] === state.current) continue;
    const attempted = new Map(choices).set(name, state.candidates[0]);
    blockers.set(
      name,
      validate(attempted) ?? "no jointly peer-compatible update advances this dependency",
    );
  }
  return { choices, blockers, constrained };
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
          mode === "update" && !solution?.constrained.has(packageName)
            ? undefined
            : solution?.choices.get(packageName);
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
      .map((entry): PlannedOccurrence => ({
        ...baseOccurrence(entry),
        status: "error",
        reason: `peer compatibility lookup failed: ${failure}`,
      }));
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
