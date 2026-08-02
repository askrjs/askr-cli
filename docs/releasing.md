# Releasing Askr CLI

Releases use the existing `chore(release): prepare @askrjs/cli X.Y.Z` pull
request and the manually dispatched trusted-publishing workflow.

## Release pull request

1. Start from current `main` and run `npm ci`.
2. Update `package.json` and `package-lock.json` to the target version.
3. Move every applicable entry from `CHANGELOG.md`'s `[Unreleased]` section to
   a new `## [X.Y.Z] - YYYY-MM-DD` section and update the comparison links.
4. Run `npm run check`, `npm run test:templates`, `npm run test:peer-floor`,
   `npm run bench`, and `npm audit`.
5. Open a `chore(release): prepare @askrjs/cli X.Y.Z` pull request and wait for
   the complete hosted CI matrix.

After that pull request merges, dispatch the publish workflow. Do not create a
tag or publish locally; the trusted workflow owns both operations.
