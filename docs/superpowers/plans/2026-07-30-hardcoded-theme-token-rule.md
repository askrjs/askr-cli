# Hardcoded Theme Token Analyzer Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `askr/no-hardcoded-theme-token`, a warning-only analyzer rule that reports literal `--ak-*` references in runtime JS/TS while exempting the exact `@askrjs/themes` workspace.

**Architecture:** Extend the existing monolithic rule registry with one syntax-only rule. It walks each already-selected TypeScript source file, extracts string and template literal segments, deduplicates nodes, and emits diagnostics through the existing helper; project exclusions remain in source discovery, and the token-owner exemption uses `context.workspace.name`.

**Tech Stack:** TypeScript 6 compiler API, Vitest, Node.js filesystem fixtures, Vite Plus project scripts.

---

## File Map

- Modify `src/analyze/rules.ts`: define literal-segment extraction, implement the rule, and register it in `ANALYZE_RULES`.
- Modify `tests/analyze.rules.test.ts`: add focused rule behavior, exclusion, and workspace-identity regression tests.
- Modify `docs/analyze.md`: document the new correctness rule and its exact exemption.

### Task 1: Detect hardcoded theme-token literals

**Files:**
- Modify: `tests/analyze.rules.test.ts` in the `describe("analyzer rules")` block
- Modify: `src/analyze/rules.ts` near the shared `visit` helper and before `frameworkConfigRule`

- [ ] **Step 1: Write the failing literal-detection test**

Add this test to `tests/analyze.rules.test.ts`:

```ts
it("reports hardcoded theme tokens in runtime literal segments", async () => {
  const root = await fixture({
    "src/tokens.tsx": `
      declare const dynamicToken: string;
      declare const suffix: string;
      const plain = "var(--ak-color-fg-muted)";
      const staticTemplate = \`--ak-surface-raised\`;
      const interpolated = \`var(--ak-\${suffix}) and --ak-border-subtle\`;
      const indirect = dynamicToken;
      // --ak-comment-only
      export const view = <div data-token="--ak-color-bg" />;
    `,
  });

  const found = (await diagnostics(root)).filter(
    (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
  );

  expect(found).toHaveLength(5);
  expect(found.every((entry) => entry.file === "src/tokens.tsx")).toBe(true);
  expect(found.every((entry) => entry.category === "correctness")).toBe(true);
  expect(found.every((entry) => entry.severity === "warning")).toBe(true);
  expect(found.every((entry) => entry.fix === undefined)).toBe(true);
  expect(found.map((entry) => entry.line)).toEqual([4, 5, 6, 6, 9]);
});
```

This covers an ordinary string, a no-substitution template, both static segments
of an interpolated template, a JSX string attribute, and negative cases for a
comment and a non-literal identifier.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts -t "reports hardcoded theme tokens in runtime literal segments"
```

Expected: FAIL because `found` has length `0` instead of `5`.

- [ ] **Step 3: Add the literal-segment extractor and rule**

Add this helper near the existing `visit` helper in `src/analyze/rules.ts`:

```ts
type RuntimeLiteralSegment = ts.StringLiteralLike | ts.TemplateLiteralLikeNode;

function runtimeLiteralSegments(node: ts.Node): readonly RuntimeLiteralSegment[] {
  if (ts.isStringLiteralLike(node)) return [node];
  if (ts.isTemplateExpression(node)) {
    return [node.head, ...node.templateSpans.map((span) => span.literal)];
  }
  return [];
}
```

Add this rule before `frameworkConfigRule`:

```ts
const hardcodedThemeTokenRule: AnalyzeRule = {
  id: "askr/no-hardcoded-theme-token",
  category: "correctness",
  severity: "warning",
  description: "Runtime source must not hardcode Askr theme token names.",
  analyze(context) {
    const diagnostics: AnalyzeDiagnostic[] = [];
    const reported = new Set<ts.Node>();

    for (const sourceFile of context.sourceFiles) {
      visit(sourceFile, (node) => {
        for (const segment of runtimeLiteralSegments(node)) {
          if (reported.has(segment) || !segment.text.includes("--ak-")) continue;
          reported.add(segment);
          diagnostics.push(
            diagnostic(
              context,
              segment,
              this,
              "Runtime code hardcodes an Askr theme token.",
              "Move the token mapping to theme CSS and select it with a semantic class or data-* attribute.",
            ),
          );
        }
      });
    }

    return diagnostics;
  },
};
```

Register it in `ANALYZE_RULES` by inserting this exact entry immediately after
`parseErrorRule` and before `stableRenderRule`:

```ts
  hardcodedThemeTokenRule,
```

The `Set` prevents duplicate reports if TypeScript traverses a template segment
both through its `TemplateExpression` and as a child node.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts -t "reports hardcoded theme tokens in runtime literal segments"
```

Expected: PASS with five diagnostics from `src/tokens.tsx`.

- [ ] **Step 5: Run the complete analyzer rule test file**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts
```

Expected: PASS; existing analyzer rules remain unchanged.

- [ ] **Step 6: Commit the detection behavior**

```bash
rtk git add src/analyze/rules.ts tests/analyze.rules.test.ts
rtk git commit -m "feat(analyze): report hardcoded theme tokens"
```

### Task 2: Respect configured exclusions and the token-owner workspace

**Files:**
- Modify: `tests/analyze.rules.test.ts` in the `describe("analyzer rules")` block
- Modify: `src/analyze/rules.ts` in `hardcodedThemeTokenRule.analyze`

- [ ] **Step 1: Write the failing exemption and exclusion test**

Add this test to `tests/analyze.rules.test.ts`:

```ts
it("honors theme-token exclusions and exempts only the exact theme owner", async () => {
  const excludedRoot = await fixture(
    {
      "src/app.ts": 'export const token = "--ak-included";',
      "vendor/ignored.ts": 'export const token = "--ak-excluded";',
    },
    {
      manifest: {
        name: "fixture",
        askr: { analyze: { exclude: ["vendor/**"] } },
      },
    },
  );
  const ownerRoot = await fixture(
    { "src/theme.ts": 'export const token = "--ak-owned";' },
    { manifest: { name: "@askrjs/themes" } },
  );
  const lookalikeRoot = await fixture(
    { "src/theme.ts": 'export const token = "--ak-not-owned";' },
    { manifest: { name: "@askrjs/themes-preview" } },
  );

  const ruleFindings = async (root: string) =>
    (await diagnostics(root)).filter(
      (entry) => entry.ruleId === "askr/no-hardcoded-theme-token",
    );

  await expect(ruleFindings(excludedRoot)).resolves.toEqual([
    expect.objectContaining({ file: "src/app.ts" }),
  ]);
  await expect(ruleFindings(ownerRoot)).resolves.toEqual([]);
  await expect(ruleFindings(lookalikeRoot)).resolves.toEqual([
    expect.objectContaining({ file: "src/theme.ts" }),
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify the exact-owner assertion fails**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts -t "honors theme-token exclusions and exempts only the exact theme owner"
```

Expected: FAIL because `@askrjs/themes` still receives one diagnostic. The
configured exclusion assertion should already pass because source discovery
omits `vendor/ignored.ts`.

- [ ] **Step 3: Add the exact workspace-name exemption**

At the start of `hardcodedThemeTokenRule.analyze`, add:

```ts
analyze(context) {
  if (context.workspace.name === "@askrjs/themes") return [];

  const diagnostics: AnalyzeDiagnostic[] = [];
  // existing literal walk remains unchanged
```

Do not use substring, path, dependency, or scope matching; only the exact
manifest-derived workspace name owns the token namespace.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts -t "honors theme-token exclusions and exempts only the exact theme owner"
```

Expected: PASS: one included-file diagnostic, no owner diagnostic, and one
lookalike-package diagnostic.

- [ ] **Step 5: Run all analyzer tests**

Run:

```bash
rtk npm test -- tests/analyze.rules.test.ts tests/analyze.cli.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the exemption behavior**

```bash
rtk git add src/analyze/rules.ts tests/analyze.rules.test.ts
rtk git commit -m "test(analyze): cover theme token rule boundaries"
```

### Task 3: Document and verify the complete rule

**Files:**
- Modify: `docs/analyze.md` under `### Correctness`

- [ ] **Step 1: Add the rule to the public analyzer catalog**

Insert this bullet after `askr/parse-error` in `docs/analyze.md`:

```markdown
- `askr/no-hardcoded-theme-token` reports `--ak-*` token names in runtime
  JavaScript and TypeScript string, template, and JSX attribute literals. The
  exact `@askrjs/themes` workspace is exempt because it owns those declarations.
```

- [ ] **Step 2: Run formatting and inspect any mechanical changes**

Run:

```bash
rtk npm run fmt
rtk git diff --check
rtk git status --short
```

Expected: formatting succeeds, `git diff --check` prints nothing, and only the
intended rule, tests, documentation, and plan/spec files differ from `main`.

- [ ] **Step 3: Run the repository's complete quality gate**

Run:

```bash
rtk npm run check
```

Expected: lint, TypeScript type checking, coverage tests, build, publint, and
package dry-run all pass.

- [ ] **Step 4: Commit documentation or formatter changes**

```bash
rtk git add docs/analyze.md src/analyze/rules.ts tests/analyze.rules.test.ts
rtk git commit -m "docs(analyze): describe theme token diagnostics"
```

If formatting made no source/test changes, the commit contains only
`docs/analyze.md`.

- [ ] **Step 5: Verify the final branch state and issue coverage**

Run:

```bash
rtk git status --short --branch
rtk git log --oneline origin/main..HEAD
rtk git diff --check origin/main...HEAD
rtk gh pr list --repo askrjs/askr-cli --state all --search "48 in:body" --json number,title,state,url
```

Expected: a clean branch, the design and implementation commits listed, no
whitespace errors, and no competing pull request for issue #48.

- [ ] **Step 6: Push and open the pull request**

```bash
rtk git push -u origin fix/48-hardcoded-theme-token-rule
rtk gh pr create --repo askrjs/askr-cli --base main --head lntutor:fix/48-hardcoded-theme-token-rule --title "feat(analyze): report hardcoded theme tokens" --body $'## Summary\n- add askr/no-hardcoded-theme-token for runtime JS/TS literals\n- respect configured source exclusions and exempt only @askrjs/themes\n- document the rule and cover strings, templates, JSX, comments, exclusions, and workspace identity\n\n## Verification\n- npm run check\n\nCloses #48'
```

Expected: GitHub returns a new PR URL created after the contribution-goal
baseline.
