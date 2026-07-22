import semver from "semver";

export type AtomicRangeShape =
  | { kind: "exact" }
  | { kind: "operator"; operator: "^" | "~" }
  | {
      kind: "x";
      parts: string[];
      wildcard: "x" | "X" | "*" | null;
    }
  | { kind: "bounded"; lower: string };

export type RangeShape =
  | AtomicRangeShape
  | { kind: "union"; clauses: AtomicRangeShape[]; sourceClauses: string[]; highestIndex: number };

export interface RangeAnalysis {
  shape: RangeShape | null;
  tracking: boolean;
  reason: string;
}

const FULL_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const PARTIAL_VERSION = String.raw`\d+(?:\.\d+){0,2}`;

function analyzeAtomicRange(specification: string): RangeAnalysis {
  const value = specification.trim();

  if (/^(?:\*|x|X)$/.test(value)) {
    return { shape: null, tracking: true, reason: "wildcard range tracks the selected tag" };
  }

  if (new RegExp(`^${FULL_VERSION}$`).test(value) && semver.valid(value)) {
    return { shape: { kind: "exact" }, tracking: false, reason: "" };
  }

  const operator = value.match(new RegExp(`^([~^])\\s*(${FULL_VERSION}|${PARTIAL_VERSION})$`));
  if (operator && semver.validRange(value)) {
    return {
      shape: { kind: "operator", operator: operator[1] as "^" | "~" },
      tracking: false,
      reason: "",
    };
  }

  const bounded = value.match(/^((?:>=|>)\s*\d+(?:\.\d+){0,2})\s+(?:<|<=)\s*\d+(?:\.\d+){0,2}$/);
  if (bounded && semver.validRange(value)) {
    return {
      shape: { kind: "bounded", lower: bounded[1].replace(/\s+/g, "") },
      tracking: false,
      reason: "",
    };
  }

  const xRange = value.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
  if (xRange && semver.validRange(value)) {
    const parts = xRange.slice(1).filter((part): part is string => part !== undefined);
    const explicitWildcard = parts.find((part) => /^[xX*]$/.test(part));
    return {
      shape: {
        kind: "x",
        parts,
        wildcard: (explicitWildcard as "x" | "X" | "*" | undefined) ?? null,
      },
      tracking: false,
      reason: "",
    };
  }

  return {
    shape: null,
    tracking: false,
    reason: "unsupported complex semver range",
  };
}

export function analyzeRange(specification: string): RangeAnalysis {
  const clauses = specification.split("||").map((clause) => clause.trim());
  if (clauses.length === 1) return analyzeAtomicRange(specification);

  if (clauses.some((clause) => clause.length === 0)) {
    return { shape: null, tracking: false, reason: "unsupported complex semver range" };
  }

  const analyzed = clauses.map(analyzeAtomicRange);
  if (analyzed.some((entry) => !entry.shape || entry.shape.kind === "union" || entry.tracking)) {
    return { shape: null, tracking: false, reason: "unsupported complex semver union" };
  }

  const minimums = clauses.map((clause) => semver.minVersion(clause));
  if (minimums.some((version) => version === null)) {
    return { shape: null, tracking: false, reason: "unsupported complex semver union" };
  }

  let highestIndex = 0;
  for (let index = 1; index < minimums.length; index += 1) {
    if (semver.gt(minimums[index]!, minimums[highestIndex]!)) highestIndex = index;
  }

  return {
    shape: {
      kind: "union",
      clauses: analyzed.map((entry) => entry.shape as AtomicRangeShape),
      sourceClauses: clauses,
      highestIndex,
    },
    tracking: false,
    reason: "",
  };
}

export function isBreakingChange(allowedVersion: string, targetVersion: string): boolean {
  const allowed = new semver.SemVer(allowedVersion);
  const target = new semver.SemVer(targetVersion);
  if (allowed.major !== target.major) return true;
  return allowed.major === 0 && allowed.minor !== target.minor;
}

export function nextBreakingBoundary(version: string): string {
  const parsed = new semver.SemVer(version);
  return parsed.major === 0 ? `0.${parsed.minor + 1}.0` : `${parsed.major + 1}.0.0`;
}

function rewriteXRange(shape: Extract<AtomicRangeShape, { kind: "x" }>, target: string): string {
  const parsed = new semver.SemVer(target);
  const count = shape.parts.length;

  if (shape.wildcard) {
    const wildcardIndex = shape.parts.findIndex((part) => /^[xX*]$/.test(part));
    if (wildcardIndex === 0) return shape.wildcard;
    if (wildcardIndex === 1) return `${parsed.major}.${shape.wildcard}`;
    return `${parsed.major}.${parsed.minor}.${shape.wildcard}`;
  }

  if (count === 1) return String(parsed.major);
  return `${parsed.major}.${parsed.minor}`;
}

function rewriteAtomic(shape: AtomicRangeShape, target: string, _forcedBreaking: boolean): string {
  if (shape.kind === "exact") return target;
  if (shape.kind === "operator") return `${shape.operator}${target}`;
  if (shape.kind === "x") return rewriteXRange(shape, target);

  const boundary = nextBreakingBoundary(target);
  return `>=${target} <${boundary}`;
}

export function rewriteRange(shape: RangeShape, target: string, forcedBreaking: boolean): string {
  if (shape.kind !== "union") return rewriteAtomic(shape, target, forcedBreaking);

  const highestShape = shape.clauses[shape.highestIndex];
  if (forcedBreaking) return rewriteAtomic(highestShape, target, true);

  const rewritten = [...shape.sourceClauses];
  rewritten[shape.highestIndex] = rewriteAtomic(highestShape, target, false);
  return rewritten.join(" || ");
}
