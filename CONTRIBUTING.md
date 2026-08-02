# Contributing to Askr CLI

Thanks for helping improve the Askr command-line tools.

## Local setup

Use a supported Node release from `package.json`, then install the exact locked
dependencies:

```bash
npm ci
```

Run the local CI mirror before opening a pull request:

```bash
npm run check
```

Changes to project templates must also pass `npm run test:templates`. Changes to
command startup, analysis, update planning, or SSG throughput should pass
`npm run bench`. Changes that affect SSG compatibility should pass
`npm run test:peer-floor`. `npm audit` should remain clean.

## Changes

- Keep commits and pull-request titles in Conventional Commit form, such as
  `feat(ssg): report output sizes` or `fix(update): preserve peer ranges`.
- Add focused tests for behavior changes and update the relevant page in
  [`docs/`](./docs/README.md).
- Update templates and their packed integration coverage together.
- Update bundled skills, golden review prompts, and skill-system documentation
  together so generated guidance does not drift from CLI behavior.
- Add user-visible changes to the `[Unreleased]` section of
  [`CHANGELOG.md`](./CHANGELOG.md).

## Releases

Follow the [release checklist](./docs/releasing.md). A
`chore(release): prepare @askrjs/cli X.Y.Z` change must move the Unreleased
entries into a dated version section; the normal `npm run check` gate verifies
that the package version exists in the changelog.
