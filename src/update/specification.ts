import semver from "semver";

export type DependencySpecification =
  | { type: "alias" | "file" | "git" | "remote" | "unsupported"; rawSpec: string }
  | { type: "range" | "tag" | "version"; rawSpec: string };

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const HOSTED_GIT = /^(?:bitbucket|gist|github|gitlab):/i;
const GIT_URL = /^(?:git(?:\+[^:]+)?:|git@|ssh:)/i;
const GIT_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.*)?$/;
const REGISTRY_TAG = /^[A-Za-z][A-Za-z0-9._-]*$/;
const SCOPED_PATH = /^@[^/]+\/[^/]+$/;

export function parseDependencySpecification(specification: string): DependencySpecification {
  const rawSpec = specification.trim();
  if (!rawSpec) return { type: "unsupported", rawSpec };
  if (/^npm:/i.test(rawSpec)) return { type: "alias", rawSpec };
  if (
    /^(?:file|link|workspace):/i.test(rawSpec) ||
    rawSpec.startsWith("./") ||
    rawSpec.startsWith("../") ||
    rawSpec.startsWith("/") ||
    rawSpec.startsWith("~/") ||
    /\.(?:tar\.gz|tgz)$/i.test(rawSpec) ||
    WINDOWS_PATH.test(rawSpec) ||
    /^[A-Za-z]:/.test(rawSpec) ||
    SCOPED_PATH.test(rawSpec)
  ) {
    return { type: "file", rawSpec };
  }
  if (HOSTED_GIT.test(rawSpec) || GIT_URL.test(rawSpec) || GIT_SHORTHAND.test(rawSpec)) {
    return { type: "git", rawSpec };
  }
  if (/^https?:/i.test(rawSpec) || /^[a-z][a-z0-9+.-]*:\/\//i.test(rawSpec)) {
    return { type: "remote", rawSpec };
  }
  if (semver.valid(rawSpec)) return { type: "version", rawSpec };
  if (semver.validRange(rawSpec)) return { type: "range", rawSpec };
  if (REGISTRY_TAG.test(rawSpec)) return { type: "tag", rawSpec };
  return { type: "unsupported", rawSpec };
}
