import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";

type Json = Record<string, any>;
const OWNED = [".askr-generated.json", "schemas.ts", "operations.ts", "api.ts", "index.ts"] as const;
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const identifier = /^[A-Za-z_$][\w$]*$/;
const pointer = (...parts: (string | number)[]) => `#/${parts.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
export class GenerationError extends Error {}
const fail = (message: string, at: string, operationId?: string): never => { throw new GenerationError(`${operationId ? `${operationId}: ` : ""}${message} at ${at}`); };
const pascal = (name: string) => { const result = name.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, _s, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_$]/g, ""); return /^\d/.test(result) ? `_${result}` : result; };

function schemaType(schema: Json, at: string, direction: "request" | "response" = "response"): string {
  if (schema.$ref) { const name = decodeURIComponent(String(schema.$ref).split("/").at(-1)!); return pascal(name); }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ") || "never";
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map((item: Json, i: number) => schemaType(item, `${at}/${schema.oneOf ? "oneOf" : "anyOf"}/${i}`, direction)).join(" | ");
  if (schema.allOf) return schema.allOf.map((item: Json, i: number) => schemaType(item, `${at}/allOf/${i}`, direction)).join(" & ");
  let type = "never";
  if (schema.type === "string") type = "string"; else if (schema.type === "number" || schema.type === "integer") type = "number"; else if (schema.type === "boolean") type = "boolean"; else if (schema.type === "null") type = "null";
  else if (schema.type === "array" || schema.items) type = `Array<${schemaType(schema.items ?? {}, `${at}/items`, direction)}>`;
  else if (schema.type === "object" || schema.properties || schema.additionalProperties !== undefined) { const required = new Set(schema.required ?? []); const properties = Object.entries(schema.properties ?? {}).filter(([, value]: any) => !(direction === "request" ? value.readOnly : value.writeOnly)).map(([key, value]: [string, any]) => `  ${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value, `${at}/properties/${key}`, direction)};`); if (schema.additionalProperties && typeof schema.additionalProperties === "object") properties.push(`  [key: string]: ${schemaType(schema.additionalProperties, `${at}/additionalProperties`, direction)};`); type = `{\n${properties.join("\n")}\n}`; }
  else if (!schema.type) fail("Unsupported schema without a type", at); else fail(`Unsupported schema type ${schema.type}`, at);
  return schema.nullable || Array.isArray(schema.type) && schema.type.includes("null") ? `${type} | null` : type;
}
function responseSchema(operation: Json, at: string, success: boolean) { const entries = Object.entries<Json>(operation.responses ?? {}).filter(([status]) => status === "default" ? !success : success === /^2\d\d$/.test(status)).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })); return entries; }
function pickContent(content: Json | undefined, at: string, direction: "request" | "response") { const entries = Object.entries<Json>(content ?? {}).sort(([a], [b]) => a.localeCompare(b)); if (!entries.length) return { type: "undefined", codec: "empty()", media: [] as string[] }; const types = entries.map(([mediaType, value]) => ({ mediaType, type: schemaType(value.schema ?? {}, `${at}/content/${mediaType.replace(/~/g, "~0").replace(/\//g, "~1")}/schema`, direction) })); const union = [...new Set(types.map((v) => v.type))].join(" | "); const codec = types.length === 1 ? codecFor(types[0]!.mediaType, union) : `content({ ${types.map((v) => `${JSON.stringify(v.mediaType)}: ${codecFor(v.mediaType, v.type)}`).join(", ")} })`; return { type: union, codec, media: types.map((v) => v.mediaType) }; }
function codecFor(mediaType: string, type: string) { if (mediaType === "application/json" || mediaType.endsWith("+json")) return `json<${type}>()`; if (mediaType.startsWith("text/")) return "text()"; if (mediaType === "application/x-www-form-urlencoded") return "urlEncoded()"; if (mediaType === "multipart/form-data") return "multipart()"; if (mediaType === "application/octet-stream") return "arrayBuffer()"; fail(`Unsupported media type ${mediaType}`, "#/content"); }

type SourceDocument = { uri: string; document: Json };

const pointerPart = (value: string): string => decodeURIComponent(value).replace(/~1/g, "/").replace(/~0/g, "~");
const pointerValue = (document: Json, fragment: string): unknown => {
  let value: unknown = document;
  for (const part of fragment.replace(/^#?\/?/, "").split("/").filter(Boolean)) {
    if (!value || typeof value !== "object") throw new GenerationError(`Reference target is missing at #/${part}`);
    value = (value as Record<string, unknown>)[pointerPart(part)];
  }
  if (value === undefined) throw new GenerationError(`Reference target is missing at ${fragment || "#"}`);
  return value;
};

function parseOpenApiDocument(contents: string, source: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    try {
      parsed = load(contents);
    } catch (error) {
      throw new GenerationError(`Unable to parse OpenAPI document ${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new GenerationError(`OpenAPI document must be an object: ${source}`);
  return parsed as Json;
}

async function readSource(uri: string): Promise<SourceDocument> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) throw new GenerationError(`Unable to fetch OpenAPI reference ${uri}: ${response.status} ${response.statusText}`);
    return { uri, document: parseOpenApiDocument(await response.text(), uri) };
  }
  const path = decodeURIComponent(new URL(uri).pathname);
  return { uri, document: parseOpenApiDocument(await readFile(path, "utf8"), path) };
}

class OpenApiBundler {
  private readonly sources = new Map<string, Promise<SourceDocument>>();
  private readonly aliases = new Map<string, string>();
  private readonly names = new Map<string, string>();

  constructor(private readonly root: Json, private readonly rootUri: string) {}

  async bundle(): Promise<Json> {
    if (!this.root.components) this.root.components = {};
    if (!this.root.components.schemas) this.root.components.schemas = {};
    await this.expandObject(this.root, this.rootUri, this.root, new Set());
    return this.root;
  }

  private async source(uri: string): Promise<SourceDocument> {
    let pending = this.sources.get(uri);
    if (!pending) {
      pending = readSource(uri);
      this.sources.set(uri, pending);
    }
    return pending;
  }

  private componentName(uri: string, fragment: string): string {
    const canonical = `${uri}#${fragment}`;
    const existing = this.aliases.get(canonical);
    if (existing) return existing;
    const raw = fragment.split("/").filter(Boolean).at(-1) ?? basename(new URL(uri).pathname).replace(/\.[^.]+$/, "");
    const base = pascal(pointerPart(raw)) || "ExternalSchema";
    let name = base;
    let suffix = 2;
    while (this.names.has(name) && this.names.get(name) !== canonical) name = `${base}${suffix++}`;
    this.aliases.set(canonical, name);
    this.names.set(name, canonical);
    return name;
  }

  private async expandObject(value: Json, uri: string, document: Json, stack: Set<string>): Promise<void> {
    for (const [key, child] of Object.entries(value)) value[key] = await this.expand(child, uri, document, stack);
  }

  private async expand(value: unknown, uri: string, document: Json, stack: Set<string>): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.expand(item, uri, document, stack)));
    if (!value || typeof value !== "object") return value;
    const object = value as Json;
    if (typeof object.$ref === "string") {
      const resolved = await this.resolveRef(object.$ref, uri, document, stack);
      const siblingEntries = Object.entries(object).filter(([key]) => key !== "$ref");
      if (!siblingEntries.length) return resolved;
      const result = resolved && typeof resolved === "object" && !Array.isArray(resolved) ? { ...(resolved as Json) } : {};
      for (const [key, child] of siblingEntries) result[key] = await this.expand(child, uri, document, stack);
      return result;
    }
    const result: Json = {};
    for (const [key, child] of Object.entries(object)) result[key] = await this.expand(child, uri, document, stack);
    return result;
  }

  private async resolveRef(ref: string, baseUri: string, document: Json, stack: Set<string>): Promise<unknown> {
    const hash = ref.indexOf("#");
    const targetUri = hash === -1 ? new URL(ref, baseUri).href : new URL(ref.slice(0, hash) || baseUri, baseUri).href;
    const fragment = hash === -1 ? "" : ref.slice(hash + 1);
    const canonical = `${targetUri}#${fragment}`;
    const targetSource = targetUri === this.rootUri ? { uri: targetUri, document } : await this.source(targetUri);
    const target = pointerValue(targetSource.document, fragment);
    const isRootSchema = targetUri === this.rootUri && fragment.startsWith("/components/schemas/");
    if (isRootSchema) return { $ref: `#${fragment}` };
    if (fragment.startsWith("/components/schemas/")) {
      const name = this.componentName(targetUri, fragment);
      if (stack.has(canonical)) return { $ref: `#/components/schemas/${name}` };
      if (!(name in this.root.components.schemas)) {
        this.root.components.schemas[name] = {};
        const next = new Set(stack).add(canonical);
        this.root.components.schemas[name] = await this.expand(target, targetSource.uri, targetSource.document, next) as Json;
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    if (stack.has(canonical)) throw new GenerationError(`Circular non-schema reference at ${ref}`);
    return this.expand(target, targetSource.uri, targetSource.document, new Set(stack).add(canonical));
  }
}

export async function loadOpenApi(input: string): Promise<Json> {
  const uri = /^https?:\/\//.test(input) ? input : pathToFileURL(resolve(input)).href;
  const source = await readSource(uri);
  return new OpenApiBundler(source.document, source.uri).bundle();
}
export function generateFiles(document: Json): Record<(typeof OWNED)[number], string> {
  const version = String(document.openapi ?? ""); if (!/^3\.(0|1)\.\d+$/.test(version)) fail(`Unsupported OpenAPI version ${version || "missing"}`, "#/openapi"); if (document.webhooks) fail("Webhooks are unsupported", "#/webhooks");
  const schemas = document.components?.schemas ?? {}; const names = new Map<string, string>(); for (const name of Object.keys(schemas).sort()) { const safe = pascal(name); if (!safe || names.has(safe)) fail(`Component name collision for ${name}`, pointer("components", "schemas", name)); names.set(safe, name); }
  const schemaLines = [...names].map(([safe, original]) => `export type ${safe} = ${schemaType(schemas[original], pointer("components", "schemas", original))};`);
  const operationTypes: string[] = []; const descriptors: string[] = []; const seen = new Set<string>();
  for (const path of Object.keys(document.paths ?? {}).sort()) for (const method of METHODS) { const operation = document.paths[path]?.[method]; if (!operation) continue; const at = pointer("paths", path, method); const id = operation.operationId; if (!id || !identifier.test(id)) fail("A unique JavaScript-identifier operationId is required", `${at}/operationId`, id); if (seen.has(id)) fail("Duplicate operationId", `${at}/operationId`, id); seen.add(id); if (operation.callbacks) fail("Callbacks are unsupported", `${at}/callbacks`, id);
    const parameters = [...(document.paths[path].parameters ?? []), ...(operation.parameters ?? [])]; const byLocation: Record<string, Json[]> = { path: [], query: [], header: [] }; for (const parameter of parameters) { if (parameter.$ref) fail("Parameter references must be bundled", `${at}/parameters`, id); if (parameter.in === "cookie") fail("Cookie parameters are unsupported", `${at}/parameters`, id); if (!byLocation[parameter.in]) fail(`Unsupported parameter location ${parameter.in}`, `${at}/parameters`, id); byLocation[parameter.in]!.push(parameter); }
    const prefix = pascal(id); const renderParameters = (location: string) => { const list = byLocation[location]!.sort((a, b) => a.name.localeCompare(b.name)); if (!list.length) return undefined; const name = `${prefix}${pascal(location)}`; operationTypes.push(`export type ${name} = {\n${list.map((p) => `  ${JSON.stringify(p.name)}${p.required || location === "path" ? "" : "?"}: ${schemaType(p.schema ?? {}, `${at}/parameters`, "request")};`).join("\n")}\n};`); const defaultStyle = location === "query" ? "form" : "simple"; const spec = `{ ${list.map((p) => { const style = p.style ?? defaultStyle; const explode = p.explode ?? style === "form"; return `${JSON.stringify(p.name)}: { style: ${JSON.stringify(style)}, explode: ${explode} }`; }).join(", ")} }`; return { name, spec }; };
    const params = renderParameters("path"), query = renderParameters("query"), headers = renderParameters("header"); const body = operation.requestBody ? pickContent(operation.requestBody.content, `${at}/requestBody`, "request") : undefined; if (body) operationTypes.push(`export type ${prefix}Body = ${body.type};`);
    const successes = responseSchema(operation, at, true); if (!successes.length) fail("At least one 2xx response is required", `${at}/responses`, id); const errors = responseSchema(operation, at, false); const chain: string[] = [`${method === "delete" ? "del" : method}(${JSON.stringify(path)})`]; if (params) chain.push(`params<${params.name}>(${params.spec})`); if (query) chain.push(`query<${query.name}>(${query.spec})`); if (headers) chain.push(`headers<${headers.name}>(${headers.spec})`); if (body) chain.push(`body(${body.codec})`);
    for (const [status, response] of successes) { if (response.links) fail("Response links are unsupported", `${at}/responses/${status}/links`, id); const value = pickContent(response.content, `${at}/responses/${status}`, "response"); const typeName = `${prefix}Response${status}`; operationTypes.push(`export type ${typeName} = ${value.type};`); chain.push(`returns(${status === "200" ? "" : `${status}, `}${value.codec})`); }
    if (errors.length) { const rendered = errors.map(([status, response]) => { if (response.links) fail("Response links are unsupported", `${at}/responses/${status}/links`, id); const value = pickContent(response.content, `${at}/responses/${status}`, "response"); const typeName = `${prefix}Error${pascal(status)}`; operationTypes.push(`export type ${typeName} = ${value.type};`); return `${JSON.stringify(status)}: ${value.codec}`; }); chain.push(`errors({ ${rendered.join(", ")} })`); }
    if (operation.security ?? document.security) chain.push(`security(${JSON.stringify(operation.security ?? document.security)})`); descriptors.push(`  ${id}: ${chain.join("\n    .")},`);
  }
  const imports = [...new Set(descriptors.join(" ").match(/\b(get|post|put|patch|del|head|options|json|text|urlEncoded|multipart|arrayBuffer|empty|content)\b/g) ?? [])].sort();
  const files = {
    "schemas.ts": `${schemaLines.join("\n\n")}\n`,
    "operations.ts": `${names.size ? `import type { ${[...names.keys()].join(", ")} } from "./schemas";\n\n` : ""}${operationTypes.join("\n\n")}\n`,
    "api.ts": `import { ${["defineApi", "createClient", ...imports].join(", ")} } from "@askrjs/fetch";\nimport type { ClientOptions } from "@askrjs/fetch";\nimport type { ${operationTypes.map((line) => line.match(/^export type (\w+)/)?.[1]).filter(Boolean).join(", ")} } from "./operations";\n\nexport const api = defineApi({\n${descriptors.join("\n")}\n}, ${JSON.stringify({ servers: (document.servers ?? []).map((s: Json) => s.url), securitySchemes: document.components?.securitySchemes ?? {} }, null, 2)});\n\nexport const createApiClient = (options?: ClientOptions) => createClient(api, options);\n`,
    "index.ts": `export * from "./schemas";\nexport * from "./operations";\nexport { api, createApiClient } from "./api";\n`,
    ".askr-generated.json": "",
  } satisfies Record<(typeof OWNED)[number], string>;
  files[".askr-generated.json"] = `${JSON.stringify({ version: 1, files: [...OWNED] }, null, 2)}\n`; return files;
}
async function existingFiles(directory: string) { try { return (await readdir(directory)).sort(); } catch { return []; } }
export async function writeGenerated(directory: string, files: Record<string, string>, check: boolean): Promise<void> {
  const output = resolve(directory); const entries = await existingFiles(output); if (check) { if (!entries.length) throw new GenerationError(`Generated directory is missing: ${output}`); const expected = Object.keys(files).sort(); if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new GenerationError(`Generated file ownership differs in ${output}`); for (const name of expected) if (await readFile(join(output, name), "utf8") !== files[name]) throw new GenerationError(`Generated file is stale: ${name}`); return; }
  if (entries.length && !entries.includes(".askr-generated.json")) throw new GenerationError(`Refusing to overwrite non-generated directory: ${output}`);
  const stage = await mkdtemp(join(dirname(output), `.${basename(output)}-stage-`)); for (const [name, content] of Object.entries(files)) await writeFile(join(stage, name), content); const backup = `${output}.backup-${process.pid}`; let moved = false; try { if (entries.length) { await rename(output, backup); moved = true; } await rename(stage, output); if (moved) await rm(backup, { recursive: true, force: true }); } catch (error) { await rm(output, { recursive: true, force: true }); if (moved) await rename(backup, output); throw error; } finally { await rm(stage, { recursive: true, force: true }); }
}
export async function generate(input: string, output: string, check = false) { const document = await loadOpenApi(input); const files = generateFiles(document); await mkdir(dirname(resolve(output)), { recursive: true }); await writeGenerated(output, files, check); }
