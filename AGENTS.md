# Repository Guidelines

## Project Structure

- `src/` contains the TypeScript CLI and library implementation. Commands live in `src/bin/`; analyzer, updater, guardrail, generator, and SSG modules are grouped by directory.
- `tests/` contains Vitest unit and contract tests. Packaging checks requiring nested installs live in `tests/integration/` and use `vitest.integration.config.ts`.
- `skills/` contains shipped agent skills; `docs/` contains command and design documentation; `benchmarks/` contains performance suites.
- Build artifacts are emitted to `dist/` and are not source files.

## Build, Test, and Development Commands

Use Node LTS and npm from the repository root. Install dependencies with `npm install` (CI uses `npm ci`).

- `npm run fmt` formats the repository; add `-- --check` for CI-style verification.
- `npm run lint` runs Vite+ linting over source, tests, benchmarks, and config files.
- `npm run typecheck` runs the TypeScript compiler without emitting files.
- `npm test` runs the standard Vitest suite; `npm run test:coverage` adds coverage reporting.
- `npm run test:peer-floor` and `npm run test:templates` run packaging integration tests.
- `npm run build` produces the distributable CLI in `dist/`; `npm run dev` rebuilds in watch mode.
- `npm run check` runs the main release checks; `npm run bench` runs performance gates.

## Coding Style and Naming

Use TypeScript with two-space indentation, semicolons, and double-quoted strings. Let Vite+ format and lint enforce style. Use kebab-case for filenames, descriptive `*.test.ts` names, and keep tests near their domain (integration tests under `tests/integration/`). Prefer small, typed helpers and explicit error messages.

## Testing Guidelines

Add regression tests with every behavior change. Use Vitest’s `test`/`describe` APIs and deterministic fixtures; avoid sleeps and network-dependent assumptions outside packaging integration tests. Run focused tests first, then `npm test`, `npm run typecheck`, and relevant integration or benchmark commands.

## Commits and Pull Requests

Use imperative, conventional commit subjects such as `fix: ...`, `test: ...`, `ci: ...`, or `chore: ...`. Keep commits focused. Pull requests should explain the behavior change, identify validation commands and results, link the relevant issue, and call out workflow, package, or release implications. Do not publish packages or create tags without explicit authorization.

## Configuration and Security

Do not commit credentials, generated `dist/` output, temporary tarballs, or local `node_modules/`. Preserve `package-lock.json` whenever dependency manifests change. Prefer `npm ci` for reproducible CI installs and review npm script-install warnings before approving new dependencies.
