import { readFile } from "node:fs/promises";

const [manifestSource, changelog] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
]);
const { version } = JSON.parse(manifestSource);

if (!/^## \[Unreleased\]$/m.test(changelog)) {
  throw new Error("CHANGELOG.md must contain an [Unreleased] section.");
}
if (
  !new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(
    changelog,
  )
) {
  throw new Error(
    `CHANGELOG.md must contain a dated [${version}] section. Release PRs must move Unreleased entries into the new version.`,
  );
}
