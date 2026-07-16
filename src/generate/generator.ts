import { createConfig, bundle } from "@redocly/openapi-core";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

export async function loadOpenApi(input: string): Promise<Json> {
  const config = await createConfig({}); const ref = /^https?:\/\//.test(input) ? input : resolve(input); const result = await bundle({ ref, config, dereference: false, removeUnusedComponents: false });
  const errors = result.problems.filter((problem) => problem.severity === "error"); if (errors.length) throw new GenerationError(errors.map((e) => `${e.message} at ${e.location?.[0]?.pointer ?? "#"}`).join("\n"));
  return result.bundle.parsed as Json;
}
export function generateFiles(document: Json): Record<(typeof OWNED)[number], string> {
  const version = String(document.openapi ?? ""); if (!/^3\.(0|1)\.\d+$/.test(version)) fail(`Unsupported OpenAPI version ${version || "missing"}`, "#/openapi"); if (document.webhooks) fail("Webhooks are unsupported", "#/webhooks");
  const schemas = document.components?.schemas ?? {}; const names = new Map<string, string>(); for (const name of Object.keys(schemas).sort()) { const safe = pascal(name); if (!safe || names.has(safe)) fail(`Component name collision for ${name}`, pointer("components", "schemas", name)); names.set(safe, name); }
  const schemaLines = [...names].map(([safe, original]) => `export type ${safe} = ${schemaType(schemas[original], pointer("components", "schemas", original))};`);
  const operationTypes: string[] = []; const descriptors: string[] = []; const seen = new Set<string>();
  for (const path of Object.keys(document.paths ?? {}).sort()) for (const method of METHODS) { const operation = document.paths[path]?.[method]; if (!operation) continue; const at = pointer("paths", path, method); const id = operation.operationId; if (!id || !identifier.test(id)) fail("A unique JavaScript-identifier operationId is required", `${at}/operationId`, id); if (seen.has(id)) fail("Duplicate operationId", `${at}/operationId`, id); seen.add(id); if (operation.callbacks) fail("Callbacks are unsupported", `${at}/callbacks`, id);
    const parameters = [...(document.paths[path].parameters ?? []), ...(operation.parameters ?? [])]; const byLocation: Record<string, Json[]> = { path: [], query: [], header: [] }; for (const parameter of parameters) { if (parameter.$ref) fail("Parameter references must be bundled", `${at}/parameters`, id); if (parameter.in === "cookie") fail("Cookie parameters are unsupported", `${at}/parameters`, id); if (!byLocation[parameter.in]) fail(`Unsupported parameter location ${parameter.in}`, `${at}/parameters`, id); byLocation[parameter.in]!.push(parameter); }
    const prefix = pascal(id); const renderParameters = (location: string) => { const list = byLocation[location]!.sort((a, b) => a.name.localeCompare(b.name)); if (!list.length) return undefined; const name = `${prefix}${pascal(location)}`; operationTypes.push(`export type ${name} = {\n${list.map((p) => `  ${JSON.stringify(p.name)}${p.required || location === "path" ? "" : "?"}: ${schemaType(p.schema ?? {}, `${at}/parameters`, "request")};`).join("\n")}\n};`); return name; };
    const params = renderParameters("path"), query = renderParameters("query"), headers = renderParameters("header"); const body = operation.requestBody ? pickContent(operation.requestBody.content, `${at}/requestBody`, "request") : undefined; if (body) operationTypes.push(`export type ${prefix}Body = ${body.type};`);
    const successes = responseSchema(operation, at, true); if (!successes.length) fail("At least one 2xx response is required", `${at}/responses`, id); const errors = responseSchema(operation, at, false); const chain: string[] = [`${method === "delete" ? "del" : method}(${JSON.stringify(path)})`]; if (params) chain.push(`params<${params}>()`); if (query) chain.push(`query<${query}>()`); if (headers) chain.push(`headers<${headers}>()`); if (body) chain.push(`body(${body.codec})`);
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
