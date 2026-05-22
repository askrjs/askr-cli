#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { installBundledSkills } from "./skills";

type CliIo = Pick<Console, "error" | "log">;
type PackageManager = "npm" | "yarn";

const TEMPLATE_LABELS = {
  spa: "SPA",
  ssr: "SSR",
  ssg: "SSG",
  startkit: "StartKit",
} as const;

type TemplateType = keyof typeof TEMPLATE_LABELS;

type Capability =
  | "agent-workflows"
  | "api-integration"
  | "auth-access"
  | "dashboard-charts"
  | "design-system"
  | "file-upload-artifacts"
  | "forms-tables-crud"
  | "query-mutation"
  | "realtime-streaming"
  | "routing-layouts"
  | "ssr-ssg";

type TemplateSelectionMode = "default" | "explicit" | "interactive" | "prompt";

interface ParsedArgs {
  positional: string[];
  install: boolean;
  help: boolean;
  promptText: string;
  skills: boolean;
  errors: string[];
}

interface TemplateSelection {
  mode: TemplateSelectionMode;
  reason: string;
  matchedTerms?: string[];
}

interface Blueprint {
  schemaVersion: number;
  appName: string;
  template: TemplateType;
  sourcePrompt: string | null;
  templateSelection: TemplateSelection;
  capabilities: Capability[];
  recommendedSkills: string[];
  guardrails: string[];
}

const TEMPLATE_TYPES = new Set<TemplateType>(["startkit", "spa", "ssr", "ssg"]);
const TEMPLATE_ORDER: TemplateType[] = ["startkit", "spa", "ssr", "ssg"];
const PROMPT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "application",
  "build",
  "create",
  "for",
  "from",
  "in",
  "into",
  "me",
  "of",
  "or",
  "platform",
  "product",
  "that",
  "the",
  "to",
  "with",
]);
const TEMPLATE_DEFAULT_CAPABILITIES: Record<TemplateType, Capability[]> = {
  spa: ["routing-layouts", "dashboard-charts", "agent-workflows", "design-system"],
  ssr: ["routing-layouts", "ssr-ssg", "query-mutation", "design-system"],
  ssg: ["routing-layouts", "ssr-ssg", "design-system"],
  startkit: ["routing-layouts", "auth-access", "forms-tables-crud", "design-system"],
};
const TEMPLATE_PROMPT_RULES: Array<{
  template: TemplateType;
  reason: string;
  terms: string[];
  weight: number;
}> = [
  {
    template: "ssg",
    reason: "Prompt emphasizes static content or documentation publishing.",
    terms: ["blog", "content", "docs", "documentation", "knowledge base", "landing page", "marketing", "static"],
    weight: 4,
  },
  {
    template: "ssr",
    reason: "Prompt emphasizes server rendering or request-time HTML.",
    terms: ["edge render", "personalized seo", "request-time", "server render", "server rendered", "server-rendered", "ssr"],
    weight: 4,
  },
  {
    template: "spa",
    reason: "Prompt emphasizes interactive workflows, control planes, or agent operations.",
    terms: ["agent", "approval", "assistant", "console", "control plane", "dashboard", "operations", "realtime", "stream", "workflow"],
    weight: 3,
  },
  {
    template: "startkit",
    reason: "Prompt emphasizes auth, workspace, or back-office product surfaces.",
    terms: ["account", "admin", "auth", "billing", "login", "portal", "settings", "tenant", "workspace"],
    weight: 3,
  },
];
const CAPABILITY_RULES: Array<{ capability: Capability; terms: string[] }> = [
  { capability: "agent-workflows", terms: ["agent", "approval", "artifact", "assistant", "prompt", "run", "tool", "workflow"] },
  { capability: "api-integration", terms: ["api", "backend", "graphql", "rest", "sdk", "webhook"] },
  { capability: "auth-access", terms: ["access", "auth", "login", "permission", "role", "session", "tenant", "workspace"] },
  { capability: "dashboard-charts", terms: ["analytics", "chart", "dashboard", "kpi", "metric", "report"] },
  { capability: "file-upload-artifacts", terms: ["artifact", "attachment", "document", "file", "upload"] },
  { capability: "forms-tables-crud", terms: ["crud", "edit", "form", "record", "table"] },
  { capability: "query-mutation", terms: ["cache", "data", "mutation", "query", "resource", "sync"] },
  { capability: "realtime-streaming", terms: ["event", "live", "realtime", "stream", "subscription", "websocket"] },
  { capability: "ssr-ssg", terms: ["content", "docs", "seo", "server render", "ssg", "ssr", "static"] },
];
const CAPABILITY_LABELS: Record<Capability, string> = {
  "agent-workflows": "Agent workflows",
  "api-integration": "API integration",
  "auth-access": "Authentication and access",
  "dashboard-charts": "Dashboards and charts",
  "design-system": "Design system and theming",
  "file-upload-artifacts": "Files and artifacts",
  "forms-tables-crud": "Forms, tables, and CRUD",
  "query-mutation": "Queries and mutations",
  "realtime-streaming": "Realtime and streaming",
  "routing-layouts": "Routing and layouts",
  "ssr-ssg": "SSR or SSG",
};
const CORE_RECOMMENDED_SKILLS = [
  "askr-agent-execution",
  "askr-mental-model",
  "askr-project-structure",
  "askr-routing-layouts",
  "askr-runtime-reactivity",
  "askr-testing-determinism",
];
const CAPABILITY_SKILL_MAP: Record<Capability, string[]> = {
  "agent-workflows": ["askr-agent-workflows", "askr-error-loading-empty"],
  "api-integration": ["askr-api-integration", "askr-env-config"],
  "auth-access": ["askr-auth-access"],
  "dashboard-charts": ["askr-dashboard-charts"],
  "design-system": ["askr-theming"],
  "file-upload-artifacts": ["askr-file-upload-artifacts"],
  "forms-tables-crud": ["askr-forms-tables-crud", "askr-error-loading-empty"],
  "query-mutation": ["askr-resources-data", "askr-query-mutation", "askr-error-loading-empty"],
  "realtime-streaming": ["askr-realtime-streaming"],
  "routing-layouts": ["askr-routing-layouts"],
  "ssr-ssg": ["askr-ssr-ssg"],
};
const FOUNDATION_SKILL_SEQUENCE = [
  "askr-agent-execution",
  "askr-mental-model",
  "askr-project-structure",
  "askr-routing-layouts",
  "askr-runtime-reactivity",
];
const VALIDATION_SKILLS = ["askr-testing-determinism"];
const BROAD_PLANNING_SKILLS = ["askr-app-builder"];
const SKILL_SEQUENCE = [
  ...FOUNDATION_SKILL_SEQUENCE,
  "askr-resources-data",
  "askr-query-mutation",
  "askr-error-loading-empty",
  "askr-forms-tables-crud",
  "askr-auth-access",
  "askr-agent-workflows",
  "askr-dashboard-charts",
  "askr-api-integration",
  "askr-env-config",
  "askr-file-upload-artifacts",
  "askr-realtime-streaming",
  "askr-ssr-ssg",
  "askr-theming",
  "askr-ui-composition",
  "askr-design-system",
  "askr-accessibility",
  "askr-observability-debugging",
  ...VALIDATION_SKILLS,
  ...BROAD_PLANNING_SKILLS,
];
const SKILL_SUMMARIES: Record<string, string> = {
  "askr-accessibility": "Review keyboard, focus, announcements, and semantic coverage.",
  "askr-agent-execution": "Read the repo in the right order and validate narrowly.",
  "askr-agent-workflows": "Model runs, approvals, timelines, and audit-friendly states.",
  "askr-api-integration": "Keep DTO mapping, retries, and transport boundaries out of pages.",
  "askr-app-builder": "Use only when a task spans multiple app surfaces and needs a broad plan.",
  "askr-auth-access": "Keep access rules in route metadata and auth workflows, not pages.",
  "askr-dashboard-charts": "Add charts without bypassing route, state, or theming conventions.",
  "askr-design-system": "Use only when shaping reusable product patterns beyond one screen.",
  "askr-env-config": "Keep environment-specific configuration and secrets handling outside UI.",
  "askr-error-loading-empty": "Represent loading, empty, stale, retry, and pending-write truthfully.",
  "askr-file-upload-artifacts": "Add uploads and artifact flows without breaking ownership boundaries.",
  "askr-forms-tables-crud": "Build forms, tables, filters, and destructive actions with stable ownership.",
  "askr-mental-model": "Choose native Askr primitives and reject React-shaped defaults.",
  "askr-observability-debugging": "Preserve correlation IDs and diagnosable failure context.",
  "askr-project-structure": "Place routes, features, shared helpers, and adapters predictably.",
  "askr-query-mutation": "Use shared keyed reads and mutations with explicit invalidation.",
  "askr-realtime-streaming": "Handle reconnects, cursors, and bounded live lists.",
  "askr-resources-data": "Own route-scoped async reads with resource() and cancellation.",
  "askr-routing-layouts": "Keep one obvious route tree, shell boundary, and navigation path.",
  "askr-runtime-reactivity": "Apply state(), derive(), selector(), and For with stable call order.",
  "askr-ssr-ssg": "Keep routes deterministic and render paths hydration-safe.",
  "askr-testing-determinism": "Finish with the narrowest executable check for the changed contract.",
  "askr-theming": "Apply the theme layer, tokens, and shell primitives before custom styling.",
  "askr-ui-composition": "Use askr-ui behavior primitives before inventing local components.",
};
const TEMPLATE_INSPECT_PATHS: Record<TemplateType, string[]> = {
  spa: ["AGENTS.md", "src/main.tsx", "src/pages/_routes.tsx", "src/pages/public/_routes.tsx", "src/pages/app/_layout.tsx"],
  ssr: ["AGENTS.md", "src/main.tsx", "src/server-entry.tsx", "src/pages/_routes.tsx", "server.ts"],
  ssg: ["AGENTS.md", "src/main.tsx", "src/pages/_routes.tsx", "ssg.config.ts", "ssg-build.ts"],
  startkit: ["AGENTS.md", "src/main.tsx", "src/router.tsx", "src/routes/index.ts", "src/pages/workspace/_layout.tsx"],
};
const TEMPLATE_GOLDEN_EXAMPLES: Record<TemplateType, string[]> = {
  spa: ["src/pages/public/home.tsx", "src/pages/app/admin-home.tsx", "src/features/operations/operations.query.ts"],
  ssr: ["src/main.tsx", "src/pages/_routes.tsx", "server.ts"],
  ssg: ["src/main.tsx", "src/pages/_routes.tsx", "ssg.config.ts"],
  startkit: [
    "src/routes/index.ts",
    "src/pages/workspace/accounts/index.tsx",
    "src/features/accounts/account-table.tsx",
  ],
};
const BLUEPRINT_GUARDRAILS = [
  "Keep the route-first file structure so new features land where builders expect them.",
  "Use state(), derive(), resource(), and selector() for reactive state and derived views.",
  "Use For for keyed or dynamic list rendering instead of ad hoc array mapping.",
  "Keep adapters, queries, and mutations outside page files so data boundaries stay deterministic.",
  "Model loading, empty, error, and success states explicitly and keep them testable.",
];

function isTemplateType(value: string): value is TemplateType {
  return TEMPLATE_TYPES.has(value as TemplateType);
}

function helpText(): string {
  return [
    "askr create - Project scaffolding for Askr",
    "",
    "Usage:",
    "  askr create [template] <name> [--prompt <text>] [--no-install] [--no-skills]",
    "  askr create --prompt <text> [name] [--no-install] [--no-skills]",
    "",
    "Templates:",
    "  startkit, spa, ssr, ssg",
    "",
    "Options:",
    "  --prompt <text>  Infer the best template from a product prompt and emit a builder blueprint",
    "  --no-install     Skip dependency installation",
    "  --no-skills      Skip bundled Askr skill installation into .skills/",
    "  --help, -h       Show help",
    "",
    "Examples:",
    "  askr create startkit my-app",
    "  askr create startkit acme-dashboard",
    '  askr create --prompt "Agent workflow console with approvals and analytics"',
  ].join("\n");
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer);
    });
  });
}

function detectPm(): PackageManager {
  const ua = process.env.npm_config_user_agent || "";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("npm")) return "npm";

  return "npm";
}

async function copyDir(src: string, dest: string, replacements: { appName: string }): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const outputName = entry.name.replace(/\{\{\s*appName\s*\}\}/g, replacements.appName);
    const destPath = path.join(dest, outputName);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, replacements);
      continue;
    }

    const buffer = await fs.readFile(srcPath);
    const content = buffer.toString("utf8");
    const replaced = content
      .replace(/\{\{\s*appName\s*\}\}/g, replacements.appName)
      .replace(/\{\{appName\}\}/g, replacements.appName);

    await fs.writeFile(destPath, replaced, "utf8");
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

function cliDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function findTemplateDir(templateType: TemplateType): Promise<string> {
  const base = cliDir();
  const candidates = [
    path.resolve(base, "..", "..", "templates", templateType),
    path.resolve(base, "..", "templates", templateType),
    path.resolve(base, "templates", templateType),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  let install = true;
  let help = false;
  let promptText = "";
  let skills = true;
  const errors: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-install") {
      install = false;
    } else if (arg === "--no-skills") {
      skills = false;
    } else if (arg === "--prompt") {
      if (i + 1 >= args.length) {
        errors.push("Missing value for --prompt");
      } else {
        promptText = normalizePromptText(args[i + 1]);
        i += 1;
      }
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, install, help, promptText, skills, errors };
}

function normalizePromptText(promptText: string): string {
  return promptText.trim().replace(/\s+/g, " ");
}

function normalizeSearchText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function scoreTerms(text: string, terms: string[]): string[] {
  const normalizedText = normalizeSearchText(text);

  return terms.filter((term) => {
    const normalizedTerm = normalizeSearchText(term).trim();
    if (!normalizedTerm) {
      return false;
    }

    return (
      normalizedText.includes(` ${normalizedTerm} `) ||
      normalizedText.includes(` ${normalizedTerm}s `) ||
      normalizedText.includes(` ${normalizedTerm}es `)
    );
  });
}

function inferTemplateFromPrompt(promptText: string): {
  matchedTerms: string[];
  reason: string;
  templateType: TemplateType;
} {
  const normalizedPrompt = promptText.toLowerCase();
  const templateScores: Record<TemplateType, number> = {
    startkit: 1,
    spa: 0,
    ssr: 0,
    ssg: 0,
  };
  const templateMatches: Record<TemplateType, string[]> = {
    startkit: [],
    spa: [],
    ssr: [],
    ssg: [],
  };
  const templateReasons: Record<TemplateType, string> = {
    startkit: "No stronger prompt signal was detected, so the CLI defaulted to the full app startkit.",
    spa: "Prompt emphasizes interactive workflows, control planes, or agent operations.",
    ssr: "Prompt emphasizes server rendering or request-time HTML.",
    ssg: "Prompt emphasizes static content or documentation publishing.",
  };

  for (const rule of TEMPLATE_PROMPT_RULES) {
    const matches = scoreTerms(normalizedPrompt, rule.terms);
    if (matches.length === 0) {
      continue;
    }

    templateScores[rule.template] += matches.length * rule.weight;
    templateMatches[rule.template].push(...matches);
    templateReasons[rule.template] = rule.reason;
  }

  let selectedTemplate = TEMPLATE_ORDER[0];
  for (const templateType of TEMPLATE_ORDER.slice(1)) {
    if (templateScores[templateType] > templateScores[selectedTemplate]) {
      selectedTemplate = templateType;
    }
  }

  return {
    matchedTerms: [...new Set(templateMatches[selectedTemplate])],
    reason: templateReasons[selectedTemplate],
    templateType: selectedTemplate,
  };
}

function deriveAppNameFromPrompt(promptText: string): string {
  const tokens = promptText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !PROMPT_STOP_WORDS.has(token))
    .filter((token) => token.length > 2);

  const nameParts: string[] = [];
  for (const token of tokens) {
    if (!nameParts.includes(token)) {
      nameParts.push(token);
    }

    if (nameParts.length === 3) {
      break;
    }
  }

  return nameParts.join("-") || "askr-app";
}

function buildCapabilities(templateType: TemplateType, promptText: string): Capability[] {
  const capabilities = new Set<Capability>(TEMPLATE_DEFAULT_CAPABILITIES[templateType] || []);

  if (promptText) {
    const normalizedPrompt = promptText.toLowerCase();
    for (const rule of CAPABILITY_RULES) {
      if (scoreTerms(normalizedPrompt, rule.terms).length > 0) {
        capabilities.add(rule.capability);
      }
    }
  }

  return (Object.keys(CAPABILITY_LABELS) as Capability[]).filter((capability) => capabilities.has(capability));
}

function buildRecommendedSkills(options: { capabilities: Capability[]; promptText: string }): string[] {
  const { capabilities, promptText } = options;
  const recommendedSkills = new Set<string>(CORE_RECOMMENDED_SKILLS);

  for (const capability of capabilities) {
    for (const skill of CAPABILITY_SKILL_MAP[capability] || []) {
      recommendedSkills.add(skill);
    }
  }

  if (promptText.trim().length > 0) {
    recommendedSkills.add("askr-app-builder");
  }

  const orderedSkills = SKILL_SEQUENCE.filter((skill) => recommendedSkills.has(skill));
  const remainingSkills = [...recommendedSkills]
    .filter((skill) => !SKILL_SEQUENCE.includes(skill))
    .sort();

  return [...orderedSkills, ...remainingSkills];
}

function renderSkillBullets(skills: string[]): string[] {
  return skills.map((skill) => {
    const summary = SKILL_SUMMARIES[skill];
    return summary ? `- ${skill} - ${summary}` : `- ${skill}`;
  });
}

function pickSkills(source: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return source.filter((skill) => allowedSet.has(skill));
}

function pickWorkflowSkills(skills: string[]): string[] {
  const excluded = new Set([...FOUNDATION_SKILL_SEQUENCE, ...VALIDATION_SKILLS, ...BROAD_PLANNING_SKILLS]);
  return skills.filter((skill) => !excluded.has(skill));
}

function renderListSection(title: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }

  return [title, ...items, ""];
}

function buildFollowUpPrompts(capabilities: Capability[]): string[] {
  const suggestions: string[] = [];

  if (capabilities.includes("agent-workflows")) {
    suggestions.push("Add an agent run detail screen with prompt, timeline, approvals, and artifact history.");
  }

  if (capabilities.includes("dashboard-charts")) {
    suggestions.push("Connect dashboard metrics through adapters and queries while preserving loading, empty, and error states.");
  }

  if (capabilities.includes("auth-access")) {
    suggestions.push("Wire route access and session state without moving auth logic into page components.");
  }

  if (capabilities.includes("forms-tables-crud")) {
    suggestions.push("Add a CRUD feature using feature-scoped forms, tables, and deterministic tests.");
  }

  if (capabilities.includes("ssr-ssg")) {
    suggestions.push("Extend SSR or SSG routes while keeping route registration deterministic and environment-safe.");
  }

  suggestions.push("Use the bundled Askr skills before adding new features so generated code stays idiomatic.");
  return suggestions.slice(0, 4);
}

function buildBlueprint(options: {
  appName: string;
  promptText: string;
  templateSelection: TemplateSelection;
  templateType: TemplateType;
}): Blueprint {
  const capabilities = buildCapabilities(options.templateType, options.promptText);
  return {
    schemaVersion: 1,
    appName: options.appName,
    template: options.templateType,
    sourcePrompt: options.promptText || null,
    templateSelection: options.templateSelection,
    capabilities,
    recommendedSkills: buildRecommendedSkills({ capabilities, promptText: options.promptText }),
    guardrails: BLUEPRINT_GUARDRAILS,
  };
}

function renderPromptBlock(promptText: string | null): string {
  if (!promptText) {
    return "No app prompt was provided. This project was scaffolded from explicit CLI arguments.";
  }

  return promptText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderBuilderBrief(blueprint: Blueprint): string {
  const foundationSkills = pickSkills(blueprint.recommendedSkills, FOUNDATION_SKILL_SEQUENCE);
  const workflowSkills = pickWorkflowSkills(blueprint.recommendedSkills);
  const validationSkills = pickSkills(blueprint.recommendedSkills, VALIDATION_SKILLS);
  const planningSkills = pickSkills(blueprint.recommendedSkills, BROAD_PLANNING_SKILLS);

  return [
    "# Askr Builder Brief",
    "",
    `- App name: ${blueprint.appName}`,
    `- Template: ${blueprint.template}`,
    `- Selection mode: ${blueprint.templateSelection.mode}`,
    `- Selection reason: ${blueprint.templateSelection.reason}`,
    "",
    "## Prompt",
    renderPromptBlock(blueprint.sourcePrompt),
    "",
    "## Capabilities",
    ...blueprint.capabilities.map((capability) => `- ${CAPABILITY_LABELS[capability]}`),
    "",
    "## Inspect First In This Scaffold",
    ...TEMPLATE_INSPECT_PATHS[blueprint.template].map((item) => `- ${item}`),
    "",
    "## Skill Execution Order",
    ...renderListSection("### Start here", renderSkillBullets(foundationSkills)),
    ...renderListSection("### Pull in next when the task needs it", renderSkillBullets(workflowSkills)),
    ...renderListSection("### Finish with validation", renderSkillBullets(validationSkills)),
    ...renderListSection("### Use only for broad multi-surface planning", renderSkillBullets(planningSkills)),
    "## All Recommended Skills",
    ...blueprint.recommendedSkills.map((skill) => `- ${skill}`),
    "",
    "## Golden Examples In This Scaffold",
    ...TEMPLATE_GOLDEN_EXAMPLES[blueprint.template].map((item) => `- ${item}`),
    "",
    "## Guardrails",
    ...blueprint.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Suggested builder prompts",
    ...buildFollowUpPrompts(blueprint.capabilities).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

async function writeBlueprintFiles(target: string, blueprint: Blueprint): Promise<void> {
  const blueprintRoot = path.join(target, ".askr");
  await fs.mkdir(blueprintRoot, { recursive: true });
  await fs.writeFile(path.join(blueprintRoot, "blueprint.json"), `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(blueprintRoot, "builder-brief.md"), renderBuilderBrief(blueprint), "utf8");
}

export async function runCreateCli(args: string[] = process.argv.slice(2), io: CliIo = console): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.errors.length > 0) {
    for (const message of parsed.errors) {
      io.error(message);
    }
    return 1;
  }

  if (parsed.help) {
    io.log(helpText());
    return 0;
  }

  let templateType: TemplateType = "startkit";
  let name = "";
  let templateSelection: TemplateSelection = {
    mode: "default",
    reason: "No stronger prompt signal was detected, so the CLI defaulted to the full app startkit.",
  };
  const explicitTemplate = parsed.positional.length > 0 && isTemplateType(parsed.positional[0]);

  if (parsed.positional.length > 0) {
    const first = parsed.positional[0];
    if (isTemplateType(first)) {
      templateType = first;
      name = parsed.positional[1] || "";
      templateSelection = {
        mode: "explicit",
        reason: `Template '${first}' was provided explicitly on the command line.`,
      };
    } else {
      name = first;
    }
  }

  if (!explicitTemplate && parsed.promptText) {
    const inferredTemplate = inferTemplateFromPrompt(parsed.promptText);
    templateType = inferredTemplate.templateType;
    templateSelection = {
      mode: "prompt",
      reason: inferredTemplate.reason,
      matchedTerms: inferredTemplate.matchedTerms,
    };
  }

  if (!name && parsed.promptText) {
    name = deriveAppNameFromPrompt(parsed.promptText);
  }

  if (!name) {
    if (!explicitTemplate) {
      io.log("Available templates: startkit, spa, ssr, ssg");
      io.log("");

      const selectedTemplate = ((await prompt("Template type (startkit/spa/ssr/ssg) [startkit]: ")).trim() || "startkit");
      if (!isTemplateType(selectedTemplate)) {
        io.error("Invalid template type");
        return 1;
      }

      templateType = selectedTemplate;
      templateSelection = {
        mode: "interactive",
        reason: `Template '${selectedTemplate}' was chosen interactively.`,
      };
    }

    name = (await prompt("App name: ")).trim();
  }

  if (!name) {
    io.error("App name is required");
    return 1;
  }

  const target = path.resolve(process.cwd(), name);
  const templateDir = await findTemplateDir(templateType);

  try {
    await fs.access(templateDir);
  } catch {
    io.error(`Template '${templateType}' not found at ${templateDir}`);
    return 1;
  }

  try {
    const stat = await fs.stat(target).catch(() => null);
    if (stat) {
      const files = await fs.readdir(target).catch(() => [] as string[]);
      if (files.length > 0) {
        io.error(`Directory ${target} already exists and is not empty.`);
        return 1;
      }
    }
  } catch (error) {
    io.error("Failed to access target directory");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const blueprint = buildBlueprint({
    appName: name,
    promptText: parsed.promptText,
    templateSelection,
    templateType,
  });

  if (parsed.promptText) {
    io.log(`Prompt profile selected ${TEMPLATE_LABELS[templateType]} for ${name}.`);
    io.log(`Reason: ${templateSelection.reason}`);
    if (Array.isArray(templateSelection.matchedTerms) && templateSelection.matchedTerms.length > 0) {
      io.log(`Matched prompt terms: ${templateSelection.matchedTerms.join(", ")}`);
    }
    io.log("");
  }

  io.log(`Creating ${TEMPLATE_LABELS[templateType]} project: ${name}...`);
  io.log("");

  try {
    await copyDir(templateDir, target, { appName: name });
  } catch (error) {
    io.error("Failed to copy template");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    await writeBlueprintFiles(target, blueprint);
  } catch (error) {
    io.error("Failed to write project blueprint");
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.skills) {
    try {
      const { bundledNames } = await installBundledSkills({ cwd: target, force: true });
      io.log(`Installed ${bundledNames.length} bundled Askr skills into .skills/`);
      io.log("");
    } catch (error) {
      io.error("Failed to install bundled Askr skills");
      io.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  } else {
    io.log("Skipping bundled Askr skill installation (--no-skills)");
    io.log("");
  }

  if (!parsed.install) {
    io.log("Skipping dependency installation (--no-install)");
    io.log("");
    io.log("Next steps:");
    io.log(`  cd ${name}`);
    io.log("  review .askr/builder-brief.md");
    if (!parsed.skills) {
      io.log("  askr skills install");
    }
    io.log("  npm install");
    io.log("  npm run dev");
    return 0;
  }

  const pm = detectPm();
  io.log(`Installing dependencies with ${pm}...`);
  io.log("");

  const result = spawnSync(pm, ["install"], {
    cwd: target,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  io.log("");
  io.log(`Success! Created ${name}`);
  io.log("");

  if (result.status !== 0) {
    io.log("Dependency installation failed. Please run manually:");
    io.log(`  cd ${name}`);
    io.log("  review .askr/builder-brief.md");
    if (!parsed.skills) {
      io.log("  askr skills install");
    }
    io.log(`  ${pm} install`);
    io.log(`  ${pm} run dev`);
    return 1;
  }

  io.log("Next steps:");
  io.log(`  cd ${name}`);
  io.log("  review .askr/builder-brief.md");
  if (!parsed.skills) {
    io.log("  askr skills install");
  }
  io.log(`  ${pm} run dev`);
  return 0;
}

async function main(): Promise<void> {
  const code = await runCreateCli(process.argv.slice(2));
  process.exit(code);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && thisPath === invokedPath) {
  void main();
}
