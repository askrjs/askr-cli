# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/askrjs/askr-cli/compare/v0.0.20...HEAD
[0.0.20]: https://github.com/askrjs/askr-cli/compare/v0.0.19...v0.0.20
[0.0.19]: https://github.com/askrjs/askr-cli/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/askrjs/askr-cli/compare/v0.0.17...v0.0.18
[0.0.17]: https://github.com/askrjs/askr-cli/compare/v0.0.16...v0.0.17
[0.0.16]: https://github.com/askrjs/askr-cli/compare/v0.0.15...v0.0.16
