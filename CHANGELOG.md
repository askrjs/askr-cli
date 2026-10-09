# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Wire the analyzer budget reporter into benchmark mode, initialize benchmark
  fixtures through global setup, and reject failed, missing, non-finite, or
  sample-free measurements. Fixture assertion failures now fail the benchmark
  command instead of yielding a successful `NaN` comparison.
- Consolidate the analyzer's `askr/no-hardcoded-theme-token` documentation into
  one entry covering token and color policies
  ([#166](https://github.com/askrjs/askr-cli/issues/166)).
- Recognize plural test filenames, test directories, module extensions, and
  Windows paths when exempting color fixtures. Other analyzer rules still run
  in those files ([#167](https://github.com/askrjs/askr-cli/issues/167)).
- Follow synchronous workspace registry factories and imported callback helpers
  without treating unresolved callable arguments as definite violations. Keep
  timer and event callbacks outside registry ownership, and resolve local source
  imports through symlinked project paths
  ([#168](https://github.com/askrjs/askr-cli/issues/168)).
- `askr outdated`, `askr update`, and `askr upgrade` no longer crash with
  `ERR_UNSUPPORTED_DIR_IMPORT` when loading npm configuration under Node ESM
  ([#150](https://github.com/askrjs/askr-cli/issues/150)).
- Concurrent `askr skills sync` runs against the same project no longer fail
  intermittently on Windows. The live `skills/` tree is now copied, updated, and
  swapped under a single directory lock, and the swap retries transient
  `EPERM`/`EBUSY`/`EACCES` rename errors. Concurrent `askr skills install`
  runs without `--force` now admit exactly one install into an empty target
  ([#153](https://github.com/askrjs/askr-cli/issues/153)).
- `askr ssg --incremental` copies the live output folder into its staging
  folder under the directory lock, so concurrent incremental builds into one
  folder can no longer stage from a half-swapped tree or race the final swap.
  The lock is held only for the copy, not for site generation
  ([#155](https://github.com/askrjs/askr-cli/issues/155)).

## [0.4.0] - 2026-09-28

### Changed

- Align CLI dependencies, starter templates, and generated database dependencies with the AskrJS 0.4 release.

## [0.3.0] - 2026-09-11

### Changed

- Prepare the coordinated breaking AskrJS 0.3.0 release and move the packed Askr peer-floor qualification to 0.3.0.

### Removed

- **Breaking:** `askr ssg` no longer accepts a `routes` array as a config route
  source. Configs must export a `registry`.
- **Breaking:** removed the deprecated `force` option from the update planner.
  Pass `mode: "upgrade"` instead.

## [0.2.3] - 2026-08-28

### Fixed

- Follow state getter and setter symbol identity across every state-sensitive analyzer rule, preserving same-named bindings in nested and sibling scopes.
- Accept state and derived accessors passed deliberately to imported `watch()` sources and callable adapter properties.

### Changed

- Update `js-yaml` from 5.4.0 to 5.4.1 and refresh the validated AskrJS patch release set.

## [0.2.2] - 2026-08-25

### Fixed

- Make `askr update` solve direct dependency constraints alongside peer constraints, holding back incompatible candidates with an explicit JSON-plan reason.
- Preserve public peer dependency floors when the selected release already satisfies the supported range.

## [0.2.1] - 2026-08-23

### Added

- Add analyzer diagnostics for per-call styling of theme-owned floating layers and conflicting class-versus-prop flex layout on `Block`.

### Changed

- Let the startkit's dialog and alert-dialog content use the complete default theme styling without call-site layout classes.
- Remove conflicting `Block` layout props from SPA template grids whose CSS classes already own grid alignment and gaps.
- Refresh eligible AskrJS, runtime, and development-tool dependency ranges with `askr update`.

## [0.2.0] - 2026-08-16

### Changed

- Establish the coordinated AskrJS 0.2 compatibility baseline across the CLI, its peer contract, and generated application templates.

## [0.0.25] - 2026-08-15

### Fixed

- Reject stale concurrent `askr add` transactions before they can silently lose a shared route, action registry, authorization, environment, or package-manifest edit.

## [0.0.24] - 2026-08-15

### Added

- Add `askr docs check` and `askr docs snapshot` for consumer-visible declaration documentation.

## [0.0.23] - 2026-08-08

### Added

- Support an explicit `outputReport.basePath` deployment prefix when validating root-absolute SSG asset references.

### Security

- Refresh the transitive Nano ID lockfile resolution to address the current audit advisory.

## [0.0.22] - 2026-08-07

### Changed

- Upgrade the CLI, templates, and analyzer to TypeScript 7 and refresh supported dependencies.
- Normalize test names to the repository's behavioral naming convention.

### Fixed

- Validate referenced SSG assets before publishing output reports while preserving intentionally mismatched emitted asset types.
- Diagnose state getter value reads across expressions while preserving callable JSX accessor props.
- Enforce statically provable `For` `by` and `byIndex` contracts without rejecting unresolved dynamic or optional values.

## [0.0.21] - 2026-08-04

## [0.0.20] - 2026-08-02

### Changed

- Update `vite-plus` to 0.2.6 after passing the complete cross-platform, template, packaging, and performance gates.
- Update `npm-registry-fetch` to 20.0.1 and `@npmcli/config` to 11.0.1 after isolated major-version verification.
- Measure the peer-solver benchmark as batched per-operation wall-clock time so isolated hosted-runner scheduling or garbage-collection pauses cannot create false regressions.

## [0.0.19] - 2026-08-02

### Fixed

- Resolve initial JavaScript and CSS references for the root SSG document and exclude framework-owned manifests from output reports.
- Preserve request-local generated theme styles in newly scaffolded SSG documents.

## [0.0.18] - 2026-08-02

### Added

- Inspect rendered canonicals before sitemap generation and reject duplicate or divergent URL policy.
- Generate deterministic SSG output reports with route, hydration, asset, JavaScript, CSS, raw, and gzip measurements.
- Enforce opt-in SSG route, hydration-share, asset, and aggregate output budgets before publishing staged output.
- Expand `askr analyze` coverage for route, render-scope, link-parameter, and theme-token contracts.
- Track npm dependency updates weekly with grouped Askr package updates and separate major updates.
- Verify the documented minimum Askr peer against the CLI build and test suite in CI.

### Security

- Run `npm audit` in CI, including the existing nightly workflow schedule.

## [0.0.17] - 2026-07-31

### Fixed

- Use the trusted publishing workflow for package releases.

## [0.0.16] - 2026-07-30

### Fixed

- Make database tooling work consistently across supported operating systems.

[Unreleased]: https://github.com/askrjs/askr-cli/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/askrjs/askr-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/askrjs/askr-cli/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/askrjs/askr-cli/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/askrjs/askr-cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/askrjs/askr-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/askrjs/askr-cli/compare/v0.0.25...v0.2.0
[0.0.25]: https://github.com/askrjs/askr-cli/compare/v0.0.24...v0.0.25
[0.0.24]: https://github.com/askrjs/askr-cli/compare/v0.0.23...v0.0.24
[0.0.23]: https://github.com/askrjs/askr-cli/compare/v0.0.22...v0.0.23
[0.0.22]: https://github.com/askrjs/askr-cli/compare/v0.0.21...v0.0.22
[0.0.21]: https://github.com/askrjs/askr-cli/compare/v0.0.20...v0.0.21
[0.0.20]: https://github.com/askrjs/askr-cli/compare/v0.0.19...v0.0.20
[0.0.19]: https://github.com/askrjs/askr-cli/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/askrjs/askr-cli/compare/v0.0.17...v0.0.18
[0.0.17]: https://github.com/askrjs/askr-cli/compare/v0.0.16...v0.0.17
[0.0.16]: https://github.com/askrjs/askr-cli/compare/v0.0.15...v0.0.16
