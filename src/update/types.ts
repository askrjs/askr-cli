export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

export type UpdateStatus = "current" | "safe" | "breaking" | "local" | "manual" | "error";

export interface UpdatePolicy {
  ignore: string[];
  tags: Record<string, string>;
}

export interface WorkspaceManifest {
  name: string;
  directory: string;
  manifestPath: string;
  relativeManifestPath: string;
  manifest: Record<string, unknown>;
  isRoot: boolean;
}

export interface DependencyOccurrence {
  package: string;
  workspace: string;
  manifestPath: string;
  relativeManifestPath: string;
  section: DependencySection;
  currentSpecification: string;
  kind: "fetch" | "local" | "manual" | "current";
  registryManaged: boolean;
  reason: string;
}

export interface DiscoveredProject {
  root: string;
  workspaces: WorkspaceManifest[];
  selectedWorkspaces: WorkspaceManifest[];
  policy: UpdatePolicy;
  occurrences: DependencyOccurrence[];
  contextOccurrences: DependencyOccurrence[];
}

export interface Packument {
  "dist-tags"?: Record<string, unknown>;
  versions?: Record<string, unknown>;
}

export interface PlannedOccurrence {
  workspace: string;
  manifestPath: string;
  relativeManifestPath: string;
  section: DependencySection;
  currentSpecification: string;
  proposedSpecification: string | null;
  status: UpdateStatus;
  reason: string;
  allowedVersion: string | null;
}

export interface PackageDecision {
  package: string;
  selectedTag: string;
  targetVersion: string | null;
  status: UpdateStatus;
  reason: string;
  occurrences: PlannedOccurrence[];
}

export interface UpdateSummary extends Record<UpdateStatus, number> {
  packages: number;
  occurrences: number;
  changedOccurrences: number;
}

export interface UpdatePlan {
  decisions: PackageDecision[];
  summary: UpdateSummary;
  hasErrors: boolean;
}

export interface ManifestValueEdit {
  manifestPath: string;
  section: DependencySection;
  package: string;
  currentSpecification: string;
  proposedSpecification: string;
}
