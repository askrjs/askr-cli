export const ASKR_CONCEPTS = {
  reactive: ["state", "derive", "selector"] as const,
  lifecycle: ["resource", "task", "timer", "stream", "on"] as const,
  data: [
    "createQuery",
    "createMutation",
    "defineQuery",
    "serveQuery",
    "defineServerQueries",
    "prefetchQuery",
    "invalidate",
    "invalidateOnInterval",
    "queryScope",
  ] as const,
  control: ["For", "Show", "Case", "Match"] as const,
  routing: ["route", "page", "index", "group", "fallback", "lazy", "createRouteRegistry"] as const,
  boot: ["createSPA", "hydrateSPA", "createIsland", "createIslands"] as const,
  actions: ["defineAction", "ActionForm", "action"] as const,
  rendering: ["renderToString", "renderToStream", "resolveRequest", "createStaticGen"] as const,
  authorization: [
    "allow",
    "redirect",
    "deny",
    "unauthorized",
    "forbidden",
    "notFound",
    "currentAuth",
  ] as const,
  composition: ["defineScope", "readScope", "createRef", "Portal"] as const,
} as const;

export const RENDER_SCOPED_CONCEPTS = new Set<string>([
  ...ASKR_CONCEPTS.reactive,
  ...ASKR_CONCEPTS.lifecycle,
  "action",
]);

export const POSITIONAL_DATA_CONCEPTS = new Set<string>(["createQuery", "createMutation"]);

export const ASKR_MODULE_PATTERN = /^@askrjs\/askr(?:\/|$)/;

export interface ImportedAskrBinding {
  readonly imported: string;
  readonly module: string;
}
