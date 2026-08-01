# Hardcoded Theme Token Analyzer Rule Design

## Goal

Add an `askr analyze` rule that reports direct references to Askr CSS custom
properties (`--ak-*`) in runtime JavaScript and TypeScript. The rule should
guide users toward semantic classes or `data-*` attributes without changing
source code automatically.

## Rule Contract

- ID: `askr/no-hardcoded-theme-token`
- Category: `correctness`
- Default severity: `warning`
- Autofix: none
- Message: runtime code should not name Askr theme tokens directly; move the
  token mapping to theme CSS and select it through a semantic class or a
  `data-*` attribute.

The rule applies to `.js`, `.jsx`, `.ts`, and `.tsx` files already selected by
the analyzer. Existing configured `exclude` globs continue to control source
discovery and require no rule-specific matching logic.

## Detection Architecture

Implement the behavior as a dedicated rule in the existing analyzer rule
registry. The rule walks the TypeScript AST and inspects literal-like runtime
values rather than searching raw source text. This keeps comments out of scope
and gives each diagnostic an exact source location.

The visitor reports a node when its literal text contains `--ak-`:

- string literals;
- no-substitution template literals;
- template head, middle, and tail segments in interpolated templates; and
- JSX attribute values written as string literals.

Each AST node is reported at most once. The rule does not evaluate identifiers,
concatenations, function results, or other value flow. It also does not inspect
comments, CSS files, or arbitrary raw source text.

## Theme-Owner Exemption

The analyzer should skip this rule when the analyzed workspace manifest has the
exact package name `@askrjs/themes`. This is the narrow token-owner exemption
requested by the issue. Package paths or names that merely contain `theme` are
not exempt, which avoids suppressing diagnostics in ordinary applications.

The exemption uses `context.workspace.name`, which is already available to
every analyzer rule from the discovered workspace manifest. No new analyzer
context or project-discovery behavior is required.

## Data Flow

1. Existing project discovery selects runtime JS/TS files and applies configured
   exclusions.
2. Project analysis reads the workspace manifest identity.
3. If the package name is `@askrjs/themes`, this rule returns no diagnostics.
4. Otherwise, the rule visits relevant literal nodes in each selected source
   file.
5. A literal segment containing `--ak-` produces one warning at that segment's
   source location.
6. The existing analyzer reporting pipeline formats and emits the diagnostic.

## Error Handling and Boundaries

Missing or malformed optional manifest metadata must not crash analysis. When
the package cannot be identified as the exact token owner, the rule runs
normally. Existing parser and project-discovery error behavior remains
unchanged.

There is deliberately no autofix: selecting the correct semantic class or
state attribute requires application-specific intent.

## Tests

Add analyzer CLI integration coverage for:

- an ordinary string containing an Askr token;
- a no-substitution template literal;
- interpolated templates, including offending static segments around an
  expression;
- a JSX string attribute;
- multiple offending literals producing distinct diagnostics;
- comments and identifier-based/non-literal values producing no diagnostics;
- files omitted by configured `exclude` globs;
- an exact `@askrjs/themes` package producing no diagnostics; and
- a similarly named non-owner package still producing diagnostics.

Run the repository's complete `npm run check` gate before opening the pull
request.

## Alternatives Rejected

Raw-source regular-expression scanning is smaller but would report comments and
can overlap AST-derived findings. Type-checker or value-flow analysis could find
dynamically assembled tokens, but it adds complexity and false-positive risk
beyond issue #48's syntactic scope. AST literal inspection is precise and fits
the analyzer's existing rule model.
