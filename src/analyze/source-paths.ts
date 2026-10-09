/** Color fixtures may own literals; this classification does not skip other rules. */
export function isTestSourcePath(fileName: string): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  return (
    /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(normalized) ||
    /(?:^|[./_-])(?:test|tests|spec)\.[cm]?[jt]sx?$/.test(normalized)
  );
}
