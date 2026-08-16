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

## Askr North Star

Keep every command narratable from explicit arguments and project files through
one visible operation and result. Reject invalid configuration, ambiguous
ownership, and unsupported project state at the boundary with errors that name
the file or option and the corrective action. Test distinguishable parse,
analysis, generation, update, and packaging failure paths. Keep CLI commands,
analyzer rules, generators, SSG, and shipped skills independently legible.
Prefer explicit command options and registries over discovery or auto-wiring,
and add commands or flags only for demonstrated application needs.

Performance work must preserve this causal model. A change is ready only when
its behavior has a one-sentence explanation, misuse is caught where it occurs,
and docs match the verified command and installed-package behavior.

## Testing Guidelines

Add regression tests with every behavior change. Use Vitest’s `test`/`describe` APIs and deterministic fixtures; avoid sleeps and network-dependent assumptions outside packaging integration tests. Run focused tests first, then `npm test`, `npm run typecheck`, and relevant integration or benchmark commands.

## Commits and Pull Requests

Use imperative, conventional commit subjects such as `fix: ...`, `test: ...`, `ci: ...`, or `chore: ...`. Keep commits focused. Pull requests should explain the behavior change, identify validation commands and results, link the relevant issue, and call out workflow, package, or release implications. Do not publish packages or create tags without explicit authorization.

## Configuration and Security

Do not commit credentials, generated `dist/` output, temporary tarballs, or local `node_modules/`. Preserve `package-lock.json` whenever dependency manifests change. Prefer `npm ci` for reproducible CI installs and review npm script-install warnings before approving new dependencies.

## Optimization Gate

A benchmark number is only half of an optimization's success criterion. The
change must also preserve a causal path that a human or agent can narrate in one
sentence.

Every benchmark-driven change must include:

1. the one-sentence causal description of the optimized path;
2. the exact fallback trigger and proof that optimized and fallback paths have
   identical observable behavior and error surfaces;
3. an explicit legibility-cost statement, including `none` when no new path or
   concept is introduced; and
4. evidence that a measured bottleneck in a real application justifies the
   optimization now.

Prefer making the existing single path faster. New caches, inference,
memoization, shortcuts, fast paths, or scheduler states require an explicit
legibility decision; a speedup alone does not justify them.
