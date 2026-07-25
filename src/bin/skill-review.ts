import fs from "node:fs/promises";
import path from "node:path";

interface ReviewPattern {
  label: string;
  regex: RegExp;
}

interface ReviewAssertion {
  description: string;
  mode: "forbid" | "require";
  match: "all" | "any";
  patterns: ReviewPattern[];
}

interface ReviewPromptDefinition {
  id: string;
  title: string;
  relatedSkills: string[];
  repairFocus: string;
  prompt: string;
  assertions: ReviewAssertion[];
}

interface ReviewFile {
  path: string;
  content: string;
}

interface ReviewAssertionResult {
  description: string;
  passed: boolean;
  matchedFiles: string[];
  matchedPatterns: string[];
  missingPatterns: string[];
  mode: ReviewAssertion["mode"];
}

export interface SkillReviewResult {
  filesScanned: number;
  passedChecks: number;
  prompt: string;
  promptId: string;
  repairFocus: string;
  relatedSkills: string[];
  score: number;
  status: "fail" | "pass";
  targetPath: string;
  title: string;
  totalChecks: number;
  checks: ReviewAssertionResult[];
}

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const IGNORED_DIRECTORIES = new Set([
  ".askr",
  ".git",
  ".skills",
  "skills",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

function re(label: string, source: string, flags = "m"): ReviewPattern {
  return {
    label,
    regex: new RegExp(source, flags),
  };
}

function requireAny(description: string, patterns: ReviewPattern[]): ReviewAssertion {
  return {
    description,
    mode: "require",
    match: "any",
    patterns,
  };
}

function requireAll(description: string, patterns: ReviewPattern[]): ReviewAssertion {
  return {
    description,
    mode: "require",
    match: "all",
    patterns,
  };
}

function forbid(description: string, patterns: ReviewPattern[]): ReviewAssertion {
  return {
    description,
    mode: "forbid",
    match: "any",
    patterns,
  };
}

const REVIEW_PROMPTS: ReviewPromptDefinition[] = [
  {
    id: "foundation",
    title: "Foundation",
    relatedSkills: ["askr-mental-model", "askr-runtime-reactivity"],
    repairFocus:
      "Replace React-shaped state and list rendering with state(), derive(), selector(), and For based on local ownership.",
    prompt:
      "Build a small Askr page that lets the user switch between queued, running, and completed jobs. Use the right Askr primitives for local state and keyed list rendering.",
    assertions: [
      requireAny("Uses state() for local UI state.", [re("state()", String.raw`\bstate\s*\(`)]),
      requireAny("Uses For for keyed or dynamic list rendering.", [
        re("<For>", String.raw`<For\b`),
        re("For()", String.raw`\bFor\s*\(`),
      ]),
      forbid("Does not import React or React hooks.", [
        re("React import", String.raw`from\s+["']react["']`),
        re("useState", String.raw`\buseState\s*\(`),
        re("useEffect", String.raw`\buseEffect\s*\(`),
      ]),
    ],
  },
  {
    id: "routing-layouts",
    title: "Routing And Layouts",
    relatedSkills: ["askr-project-structure", "askr-routing-layouts"],
    repairFocus:
      "Move route ownership into the registered route tree and keep layout, auth requirements, and fallback policy in route declarations.",
    prompt:
      "Add a protected /app/workspaces/{workspaceId}/settings route with a nested layout, an index page, and a not-found fallback. Keep routing idiomatic to Askr.",
    assertions: [
      requireAll("Uses Askr route composition helpers.", [
        re("group()", String.raw`\bgroup\s*\(`),
        re("fallback()", String.raw`\bfallback\s*\(`),
        re("index()", String.raw`\bindex\s*\(`),
      ]),
      requireAny("Registers routes with page() or route().", [
        re("page()", String.raw`\bpage\s*\(`),
        re("route()", String.raw`\broute\s*\(`),
      ]),
      requireAny("Keeps auth or permission policy in route requirements.", [
        re("auth requirement", String.raw`\bauth\s*:\s*require[A-Z][A-Za-z]*\s*\(`),
        re("auth policy", String.raw`\bpolicies\s*:`),
      ]),
      forbid("Rejects obsolete boolean and guest-string auth declarations.", [
        re("boolean auth", String.raw`\bauth\s*:\s*(?:true|false)\b`),
        re("guest auth", String.raw`\bauth\s*:\s*["']guest["']`),
        re("permission metadata", String.raw`\bpermissions?\s*:`),
      ]),
    ],
  },
  {
    id: "auth-authorization",
    title: "Auth And Authorization",
    relatedSkills: ["askr-auth-access", "askr-routing-layouts"],
    repairFocus:
      "Keep auth and permission policy in function requirements or auth workflow boundaries, then render an explicit forbidden state.",
    prompt:
      "Add a billing admin screen that is only available to authenticated users with the billing.manage permission. Show a signed-in forbidden state when the user lacks access.",
    assertions: [
      requireAny("Uses an auth requirement or session workflow.", [
        re("auth requirement", String.raw`\brequire(?:User|Anonymous|Permission|Role|Scope)\s*\(`),
        re("session gate", String.raw`\bsignedIn\b|\bsession\b`),
      ]),
      requireAny("Preserves permission policy in code or route requirements.", [
        re("billing.manage", String.raw`billing\.manage`),
        re("permission requirement", String.raw`\brequirePermission\s*\(`),
      ]),
      forbid("Rejects obsolete boolean and guest-string auth declarations.", [
        re("boolean auth", String.raw`\bauth\s*:\s*(?:true|false)\b`),
        re("guest auth", String.raw`\bauth\s*:\s*["']guest["']`),
        re("permission metadata", String.raw`\bpermissions?\s*:`),
      ]),
      requireAny("Renders a forbidden or access-denied state.", [
        re("forbidden", String.raw`forbidden`, "mi"),
        re("access denied", String.raw`access denied`, "mi"),
      ]),
    ],
  },
  {
    id: "crud-forms",
    title: "CRUD And Forms",
    relatedSkills: ["askr-forms-tables-crud", "askr-error-loading-empty"],
    repairFocus:
      "Keep form state local, mutation state feature-owned, and surface field or form errors instead of toast-only failure handling.",
    prompt:
      "Build an accounts edit form with field validation, submit pending state, server validation errors, and a keyboard-accessible destructive archive action.",
    assertions: [
      requireAny("Keeps local form state explicit.", [re("state()", String.raw`\bstate\s*\(`)]),
      requireAny("Includes pending or disabled submit handling.", [
        re("pending", String.raw`\bpending\b`),
        re("disabled", String.raw`\bdisabled\b`),
      ]),
      requireAny("Surfaces field or form validation errors.", [
        re("validation", String.raw`validation`, "mi"),
        re("field error", String.raw`field error`, "mi"),
        re("error message", String.raw`error`, "mi"),
      ]),
    ],
  },
  {
    id: "shared-data-consistency",
    title: "Shared Data And Consistency",
    relatedSkills: ["askr-query-mutation", "askr-resources-data", "askr-error-loading-empty"],
    repairFocus:
      "Use createQuery() and createMutation() with narrow invalidation, preserve consistency metadata, and show truthful syncing state.",
    prompt:
      "Build a shared accounts query with an update mutation that preserves stale data while the projection catches up. Show a truthful syncing state after save.",
    assertions: [
      requireAny("Uses createQuery() for shared reads.", [
        re("createQuery()", String.raw`\bcreateQuery\s*\(`),
      ]),
      requireAny("Uses createMutation() for writes.", [
        re("createMutation()", String.raw`\bcreateMutation\s*\(`),
      ]),
      requireAny("Represents truthful syncing or stale states.", [
        re("syncing", String.raw`syncing`, "mi"),
        re("pending-write", String.raw`pending-write`, "mi"),
        re("stale", String.raw`stale`, "mi"),
      ]),
    ],
  },
  {
    id: "realtime",
    title: "Realtime",
    relatedSkills: ["askr-realtime-streaming", "askr-query-mutation"],
    repairFocus:
      "Preserve cursor or event identity, bound long-running lists, and expose reconnecting or stale state explicitly.",
    prompt:
      "Build a live operator timeline that reconnects from a cursor, handles duplicate events safely, and keeps DOM churn bounded on long-running sessions.",
    assertions: [
      requireAny("Preserves stream cursor or event identity.", [
        re("cursor", String.raw`\bcursor\b`),
        re("eventId", String.raw`\beventId\b`),
        re("lastEventId", String.raw`\blastEventId\b`),
      ]),
      requireAny("Handles reconnect or retry explicitly.", [
        re("reconnect", String.raw`reconnect`, "mi"),
        re("retry", String.raw`retry`, "mi"),
      ]),
      requireAny("Bounds long-running lists or buffers.", [
        re("slice()", String.raw`\.slice\s*\(`),
        re("max events", String.raw`\bMAX_[A-Z_]+\b`),
        re("limit", String.raw`\blimit\b`, "mi"),
      ]),
    ],
  },
  {
    id: "theming-ui",
    title: "Theming And UI",
    relatedSkills: ["askr-theming", "askr-ui-composition", "askr-accessibility"],
    repairFocus:
      "Use askr-themes and askr-ui primitives before custom components, and keep styling token-based and accessibility-safe.",
    prompt:
      "Add a themed settings panel using solved Askr theme primitives, preserve dark mode, and avoid inventing app-local replacements for common controls and surfaces.",
    assertions: [
      requireAny("Uses askr-ui or askr-themes primitives.", [
        re("@askrjs/ui", String.raw`@askrjs\/ui`),
        re("@askrjs/themes", String.raw`@askrjs\/themes`),
      ]),
      requireAny("Uses tokens or theme-oriented hooks in styles.", [
        re("CSS var token", String.raw`var\(--`),
        re("data-slot", String.raw`data-slot`),
      ]),
      requireAny("Preserves theme mode behavior.", [
        re("dark mode", String.raw`dark`, "mi"),
        re("theme toggle", String.raw`theme`, "mi"),
      ]),
    ],
  },
  {
    id: "ssr-ssg",
    title: "SSR And SSG",
    relatedSkills: ["askr-ssr-ssg", "askr-routing-layouts"],
    repairFocus:
      "Keep routes deterministic, render paths environment-safe, and remove browser-only globals from server or static render code.",
    prompt:
      "Add a parameterized docs route that works in SSG and stays hydration-safe when rendered in the browser.",
    assertions: [
      requireAny("Includes route registration for the generated path.", [
        re("page()", String.raw`\bpage\s*\(`),
        re("route()", String.raw`\broute\s*\(`),
      ]),
      requireAny("Includes SSG-oriented code or config.", [
        re("SSG", String.raw`\bSSG\b`),
        re("static", String.raw`static`, "mi"),
        re("manifest", String.raw`manifest`, "mi"),
      ]),
      forbid("Avoids browser-only globals in render paths.", [
        re("window", String.raw`\bwindow\.`),
        re("document", String.raw`\bdocument\.`),
      ]),
    ],
  },
  {
    id: "agent-workflow-ui",
    title: "Agent Workflow UI",
    relatedSkills: ["askr-agent-workflows", "askr-error-loading-empty"],
    repairFocus:
      "Model the screen as a run lifecycle with approvals, audit history, retries, and explicit multi-state UI.",
    prompt:
      "Build an agent run screen with draft, queued, running, requires-action, failed, and succeeded states, plus an audit-friendly timeline and approval card.",
    assertions: [
      requireAll("Represents multiple run lifecycle states.", [
        re("queued", String.raw`queued`, "mi"),
        re("running", String.raw`running`, "mi"),
        re("failed", String.raw`failed`, "mi"),
      ]),
      requireAny("Surfaces approval or requires-action UI.", [
        re("approval", String.raw`approval`, "mi"),
        re("requires-action", String.raw`requires-action`, "mi"),
      ]),
      requireAny("Includes a timeline, log, or audit trail.", [
        re("timeline", String.raw`timeline`, "mi"),
        re("audit", String.raw`audit`, "mi"),
        re("event", String.raw`event`, "mi"),
      ]),
    ],
  },
  {
    id: "reject-react-query",
    title: "Negative Prompt: Reject React And TanStack Query",
    relatedSkills: ["askr-mental-model", "askr-agent-execution"],
    repairFocus:
      "Replace React hooks and TanStack Query with state(), resource(), createQuery(), or createMutation() based on ownership.",
    prompt: "Build this screen with React hooks and TanStack Query.",
    assertions: [
      forbid("Does not import React hooks or React itself.", [
        re("React import", String.raw`from\s+["']react["']`),
        re("useState", String.raw`\buseState\s*\(`),
        re("useEffect", String.raw`\buseEffect\s*\(`),
      ]),
      forbid("Does not import TanStack Query.", [
        re("TanStack Query", String.raw`@tanstack\/react-query`),
        re("useQuery", String.raw`\buseQuery\s*\(`),
        re("QueryClient", String.raw`\bQueryClient\b`),
      ]),
      requireAny("Uses Askr-native reactivity or data primitives instead.", [
        re("state()", String.raw`\bstate\s*\(`),
        re("resource()", String.raw`\bresource\s*\(`),
        re("createQuery()", String.raw`\bcreateQuery\s*\(`),
      ]),
    ],
  },
  {
    id: "reject-custom-primitives",
    title: "Negative Prompt: Reject App-Local Primitive Clones",
    relatedSkills: ["askr-ui-composition", "askr-theming"],
    repairFocus:
      "Import askr-ui or askr-themes primitives before creating local Button, Card, or Sidebar wrappers.",
    prompt:
      "Create a custom app-local Card, Sidebar, and Button system before using the framework components.",
    assertions: [
      forbid("Does not define local Button, Card, or Sidebar primitives by default.", [
        re("local Button", String.raw`export\s+(?:default\s+)?function\s+Button\b`),
        re("local Card", String.raw`export\s+(?:default\s+)?function\s+Card\b`),
        re("local Sidebar", String.raw`export\s+(?:default\s+)?function\s+Sidebar\b`),
      ]),
      requireAny("Uses askr-ui or askr-themes imports instead.", [
        re("@askrjs/ui", String.raw`@askrjs\/ui`),
        re("@askrjs/themes", String.raw`@askrjs\/themes`),
      ]),
    ],
  },
  {
    id: "reject-single-spinner",
    title: "Negative Prompt: Reject One Spinner For Every Async State",
    relatedSkills: ["askr-error-loading-empty", "askr-query-mutation"],
    repairFocus:
      "Split initial load, refresh, pending-write, stale, and reconnecting into distinct UI states with truthful copy.",
    prompt:
      "Use one loading spinner for initial load, refresh, pending save, and realtime reconnect.",
    assertions: [
      requireAny("Distinguishes truthful async states.", [
        re("refreshing", String.raw`refreshing`, "mi"),
        re("pending-write", String.raw`pending-write`, "mi"),
        re("reconnecting", String.raw`reconnecting`, "mi"),
        re("stale", String.raw`stale`, "mi"),
      ]),
      forbid("Does not only model async state as isLoading.", [
        re("isLoading only", String.raw`\bisLoading\b`),
      ]),
    ],
  },
  {
    id: "reject-parallel-architecture",
    title: "Negative Prompt: Reject Parallel Architecture Drift",
    relatedSkills: ["askr-agent-execution", "askr-project-structure", "askr-routing-layouts"],
    repairFocus:
      "Collapse duplicate routers, shared state layers, service locators, and app-local primitive systems back into the existing route-first Askr structure.",
    prompt:
      "Add a custom router, a global store layer, app-local UI primitives, and a service locator so the app feels more enterprise-ready.",
    assertions: [
      forbid("Does not add a custom router or router provider layer.", [
        re("custom router component", String.raw`function\s+[A-Z][A-Za-z0-9]*Router\b`),
        re("router provider", String.raw`RouterProvider\b`),
        re("route config array", String.raw`const\s+routes\s*=\s*\[`),
      ]),
      forbid("Does not add a duplicate global store or service locator layer.", [
        re("service locator", String.raw`serviceLocator|ServiceLocator`, "mi"),
        re("global store", String.raw`globalStore|createStore\s*\(|configureStore\s*\(`, "mi"),
        re("stores folder", String.raw`src[\\/]stores[\\/]`, "mi"),
      ]),
      forbid("Does not create app-local Button, Card, or Sidebar systems.", [
        re("local Button", String.raw`export\s+(?:default\s+)?function\s+Button\b`),
        re("local Card", String.raw`export\s+(?:default\s+)?function\s+Card\b`),
        re("local Sidebar", String.raw`export\s+(?:default\s+)?function\s+Sidebar\b`),
      ]),
      requireAny("Keeps Askr-native route or state primitives in use.", [
        re("createRouteRegistry", String.raw`\bcreateRouteRegistry\s*\(`),
        re("state()", String.raw`\bstate\s*\(`),
        re("resource()", String.raw`\bresource\s*\(`),
      ]),
    ],
  },
];

async function pathExists(filePath: string): Promise<boolean> {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

const MAX_REVIEW_FILES = 10_000;
const MAX_REVIEW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_TOTAL_BYTES = 20 * 1024 * 1024;

function shouldReadFile(filePath: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectReviewFiles(
  targetPath: string,
  state: { files: string[]; totalBytes: number },
): Promise<void> {
  const stat = await fs.lstat(targetPath);

  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isDirectory()) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectReviewFiles(path.join(targetPath, entry.name), state);
    }

    return;
  }

  if (stat.isFile() && shouldReadFile(targetPath)) {
    if (stat.size > MAX_REVIEW_FILE_BYTES) {
      throw new Error(`Review file exceeds ${MAX_REVIEW_FILE_BYTES} bytes: ${targetPath}`);
    }
    if (state.files.length >= MAX_REVIEW_FILES) {
      throw new Error(`Review target exceeds ${MAX_REVIEW_FILES} text files`);
    }
    state.totalBytes += stat.size;
    if (state.totalBytes > MAX_REVIEW_TOTAL_BYTES) {
      throw new Error(`Review target exceeds ${MAX_REVIEW_TOTAL_BYTES} text bytes`);
    }
    state.files.push(targetPath);
  }
}

async function loadReviewFiles(
  targetPath: string,
): Promise<{ files: ReviewFile[]; targetPath: string }> {
  const resolvedTarget = path.resolve(targetPath);
  if (!(await pathExists(resolvedTarget))) {
    throw new Error(`Review target not found: ${resolvedTarget}`);
  }

  const stat = await fs.stat(resolvedTarget);
  const baseDirectory = stat.isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
  const collection = { files: [] as string[], totalBytes: 0 };

  await collectReviewFiles(resolvedTarget, collection);

  const files = await Promise.all(
    collection.files.map(async (filePath) => ({
      path: path.relative(baseDirectory, filePath) || path.basename(filePath),
      content: await fs.readFile(filePath, "utf8"),
    })),
  );

  if (files.length === 0) {
    throw new Error(`No reviewable text files found under ${resolvedTarget}`);
  }

  return {
    files,
    targetPath: resolvedTarget,
  };
}

function getReviewPrompt(promptId: string): ReviewPromptDefinition | null {
  return REVIEW_PROMPTS.find((prompt) => prompt.id === promptId) ?? null;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

function findPatternMatches(files: ReviewFile[], pattern: ReviewPattern): string[] {
  const matchedFiles: string[] = [];

  for (const file of files) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(file.content)) {
      matchedFiles.push(file.path);
    }
  }

  return matchedFiles;
}

function evaluateAssertion(assertion: ReviewAssertion, files: ReviewFile[]): ReviewAssertionResult {
  const patterns = assertion.patterns.map((pattern) => ({
    label: pattern.label,
    matches: findPatternMatches(files, pattern),
  }));

  if (assertion.mode === "forbid") {
    const offendingPatterns = patterns.filter((pattern) => pattern.matches.length > 0);

    return {
      description: assertion.description,
      passed: offendingPatterns.length === 0,
      matchedFiles: uniquePaths(offendingPatterns.flatMap((pattern) => pattern.matches)),
      matchedPatterns: offendingPatterns.map((pattern) => pattern.label),
      missingPatterns: [],
      mode: assertion.mode,
    };
  }

  const matchedPatterns = patterns.filter((pattern) => pattern.matches.length > 0);
  const passed =
    assertion.match === "all"
      ? matchedPatterns.length === patterns.length
      : matchedPatterns.length > 0;

  return {
    description: assertion.description,
    passed,
    matchedFiles: uniquePaths(matchedPatterns.flatMap((pattern) => pattern.matches)),
    matchedPatterns: matchedPatterns.map((pattern) => pattern.label),
    missingPatterns: patterns
      .filter((pattern) => pattern.matches.length === 0)
      .map((pattern) => pattern.label),
    mode: assertion.mode,
  };
}

export function listSkillReviewPrompts(): Array<{
  id: string;
  prompt: string;
  title: string;
  relatedSkills: string[];
}> {
  return REVIEW_PROMPTS.map(({ id, prompt, title, relatedSkills }) => ({
    id,
    prompt,
    title,
    relatedSkills,
  }));
}

export async function runSkillReview(
  promptId: string,
  options: { cwd?: string } = {},
): Promise<SkillReviewResult> {
  const prompt = getReviewPrompt(promptId);
  if (!prompt) {
    const error = new Error(`Unknown review prompt: ${promptId}`) as Error & { code?: string };
    error.code = "UNKNOWN_REVIEW_PROMPT";
    throw error;
  }

  const { files, targetPath } = await loadReviewFiles(options.cwd ?? process.cwd());
  const checks = prompt.assertions.map((assertion) => evaluateAssertion(assertion, files));
  const passedChecks = checks.filter((check) => check.passed).length;
  const totalChecks = checks.length;

  return {
    filesScanned: files.length,
    passedChecks,
    prompt: prompt.prompt,
    promptId: prompt.id,
    repairFocus: prompt.repairFocus,
    relatedSkills: prompt.relatedSkills,
    score: totalChecks === 0 ? 1 : passedChecks / totalChecks,
    status: passedChecks === totalChecks ? "pass" : "fail",
    targetPath,
    title: prompt.title,
    totalChecks,
    checks,
  };
}

export function formatSkillReviewReport(result: SkillReviewResult): string {
  const lines = [
    `Skill review: ${result.promptId} - ${result.title}`,
    `Target: ${result.targetPath}`,
    `Files scanned: ${result.filesScanned}`,
    `Related skills: ${result.relatedSkills.join(", ")}`,
    `Repair focus: ${result.repairFocus}`,
    `Score: ${result.passedChecks}/${result.totalChecks} checks passed (${Math.round(result.score * 100)}%)`,
    "",
  ];

  for (const check of result.checks) {
    lines.push(`${check.passed ? "PASS" : "FAIL"} ${check.description}`);

    if (check.mode === "require") {
      if (check.matchedPatterns.length > 0) {
        lines.push(`  matched: ${check.matchedPatterns.join(", ")}`);
      }

      if (check.missingPatterns.length > 0) {
        lines.push(`  missing: ${check.missingPatterns.join(", ")}`);
      }
    } else if (check.matchedPatterns.length > 0) {
      lines.push(`  offending patterns: ${check.matchedPatterns.join(", ")}`);
    }

    if (check.matchedFiles.length > 0) {
      lines.push(`  files: ${check.matchedFiles.join(", ")}`);
    }
  }

  return lines.join("\n");
}
