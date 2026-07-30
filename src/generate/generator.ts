import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "js-yaml";

type Json = Record<string, any>;
const OWNED = [
  ".askr-generated.json",
  "schemas.ts",
  "operations.ts",
  "api.ts",
  "index.ts",
] as const;
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const identifier = /^[A-Za-z_$][\w$]*$/;
const pointer = (...parts: (string | number)[]) =>
  `#/${parts.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
export class GenerationError extends Error {}
const fail = (message: string, at: string, operationId?: string): never => {
  throw new GenerationError(`${operationId ? `${operationId}: ` : ""}${message} at ${at}`);
};
type SchemaReferenceCollector = { add(name: string): void };
const pascal = (name: string) => {
  const result = name
    .replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, _s, c) => c.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, "");
  return /^\d/.test(result) ? `_${result}` : result;
};

function schemaType(
  schema: Json,
  at: string,
  direction: "request" | "response" = "response",
  references?: SchemaReferenceCollector,
): string {
  if (schema.$ref) {
    const name = decodeURIComponent(String(schema.$ref).split("/").at(-1)!);
    const typeName = pascal(name);
    references?.add(typeName);
    return typeName;
  }
  if (Array.isArray(schema.type)) {
    const includesNull = schema.type.includes("null");
    const variants = [...new Set(schema.type.filter((value: unknown) => value !== "null"))];
    const rendered = variants.map((variant) =>
      schemaType({ ...schema, type: variant, nullable: false }, at, direction, references),
    );
    if (includesNull) rendered.push("null");
    if (rendered.length === 0) fail("Schema type array must not be empty", at);
    return [...new Set(rendered)].join(" | ");
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum)
    return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ") || "never";
  if (schema.oneOf || schema.anyOf)
    return (schema.oneOf ?? schema.anyOf)
      .map((item: Json, i: number) =>
        schemaType(item, `${at}/${schema.oneOf ? "oneOf" : "anyOf"}/${i}`, direction, references),
      )
      .join(" | ");
  if (schema.allOf)
    return schema.allOf
      .map((item: Json, i: number) => schemaType(item, `${at}/allOf/${i}`, direction, references))
      .join(" & ");
  let type = "never";
  if (schema.type === "string") type = "string";
  else if (schema.type === "number" || schema.type === "integer") type = "number";
  else if (schema.type === "boolean") type = "boolean";
  else if (schema.type === "null") type = "null";
  else if (schema.type === "array" || schema.items)
    type = `Array<${schemaType(schema.items ?? {}, `${at}/items`, direction, references)}>`;
  else if (
    schema.type === "object" ||
    schema.properties ||
    schema.additionalProperties !== undefined
  ) {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {})
      .filter(([, value]: any) => !(direction === "request" ? value.readOnly : value.writeOnly))
      .map(
        ([key, value]: [string, any]) =>
          `  ${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${schemaType(value, `${at}/properties/${key}`, direction, references)};`,
      );
    if (schema.additionalProperties && typeof schema.additionalProperties === "object")
      properties.push(
        `  [key: string]: ${schemaType(schema.additionalProperties, `${at}/additionalProperties`, direction, references)};`,
      );
    type = `{\n${properties.join("\n")}\n}`;
  } else if (!schema.type) fail("Unsupported schema without a type", at);
  else fail(`Unsupported schema type ${schema.type}`, at);
  return schema.nullable || (Array.isArray(schema.type) && schema.type.includes("null"))
    ? `${type} | null`
    : type;
}
function responseSchema(operation: Json, at: string, success: boolean) {
  const entries = Object.entries<Json>(operation.responses ?? {})
    .filter(([status]) => (status === "default" ? !success : success === /^2\d\d$/.test(status)))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return entries;
}
function pickContent(
  content: Json | undefined,
  at: string,
  direction: "request" | "response",
  references?: SchemaReferenceCollector,
) {
  const entries = Object.entries<Json>(content ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return { type: "undefined", codec: "empty()", media: [] as string[] };
  const types = entries.map(([mediaType, value]) => ({
    mediaType,
    type: schemaType(
      value.schema ?? {},
      `${at}/content/${mediaType.replace(/~/g, "~0").replace(/\//g, "~1")}/schema`,
      direction,
      references,
    ),
  }));
  const union = [...new Set(types.map((v) => v.type))].join(" | ");
  const codec =
    types.length === 1
      ? codecFor(types[0]!.mediaType, union)
      : `content({ ${types.map((v) => `${JSON.stringify(v.mediaType)}: ${codecFor(v.mediaType, v.type)}`).join(", ")} })`;
  return { type: union, codec, media: types.map((v) => v.mediaType) };
}
function codecFor(mediaType: string, type: string) {
  if (mediaType === "application/json" || mediaType.endsWith("+json")) return `json<${type}>()`;
  if (mediaType.startsWith("text/")) return "text()";
  if (mediaType === "application/x-www-form-urlencoded") return "urlEncoded()";
  if (mediaType === "multipart/form-data") return "multipart()";
  if (mediaType === "application/octet-stream") return "arrayBuffer()";
  fail(`Unsupported media type ${mediaType}`, "#/content");
}

type SourceDocument = { uri: string; document: Json };
export interface OpenApiLoadOptions {
  /** Additional HTTPS origins allowed for references from a remote root. */
  readonly allowedReferenceOrigins?: readonly string[];
  readonly maxBytes?: number;
  readonly maxDepth?: number;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
  /** Intended only for controlled tests and private development networks. */
  readonly allowPrivateHosts?: boolean;
}
type ResolvedLoadOptions = Required<Omit<OpenApiLoadOptions, "allowedReferenceOrigins">> & {
  allowedReferenceOrigins: ReadonlySet<string>;
  localRootDirectory?: string;
  remoteRootOrigin?: string;
};

const pointerPart = (value: string): string =>
  decodeURIComponent(value).replace(/~1/g, "/").replace(/~0/g, "~");
const pointerValue = (document: Json, fragment: string): unknown => {
  let value: unknown = document;
  for (const part of fragment
    .replace(/^#?\/?/, "")
    .split("/")
    .filter(Boolean)) {
    if (!value || typeof value !== "object")
      throw new GenerationError(`Reference target is missing at #/${part}`);
    value = (value as Record<string, unknown>)[pointerPart(part)];
  }
  if (value === undefined)
    throw new GenerationError(`Reference target is missing at ${fragment || "#"}`);
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
      throw new GenerationError(
        `Unable to parse OpenAPI document ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new GenerationError(`OpenAPI document must be an object: ${source}`);
  return parsed as Json;
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001:2::", 48],
] as const)
  blockedAddresses.addSubnet(network, prefix, "ipv6");

function privateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, "ipv4");
  if (family !== 6) return true;
  const mappedSuffix = /^::ffff:(.+)$/i.exec(address)?.[1];
  const mapped = mappedSuffix?.includes(".")
    ? mappedSuffix
    : mappedSuffix && /^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(mappedSuffix)
      ? mappedSuffix
          .split(":")
          .flatMap((part) => {
            const value = Number.parseInt(part, 16);
            return [value >> 8, value & 0xff];
          })
          .join(".")
      : undefined;
  return mapped ? privateAddress(mapped) : blockedAddresses.check(address, "ipv6");
}

type VettedAddress = { address: string; family: 4 | 6 };
type HttpsResponse = {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  message: IncomingMessage;
};

function remaining(deadline: number, uri: string): number {
  const value = deadline - Date.now();
  if (value <= 0) throw new GenerationError(`Timed out fetching OpenAPI reference ${uri}`);
  return value;
}

async function withDeadline<T>(promise: Promise<T>, deadline: number, uri: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new GenerationError(`Timed out fetching OpenAPI reference ${uri}`)),
          remaining(deadline, uri),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function vettedAddresses(
  url: URL,
  options: ResolvedLoadOptions,
  deadline: number,
): Promise<VettedAddress[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const answers = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await withDeadline(lookup(hostname, { all: true, verbatim: true }), deadline, url.href);
  if (
    answers.length === 0 ||
    (!options.allowPrivateHosts && answers.some(({ address }) => privateAddress(address)))
  ) {
    throw new GenerationError(
      `OpenAPI reference resolves to a private, reserved, or link-local address: ${url.origin}`,
    );
  }
  return answers.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

function retryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return (
    !/^ERR_TLS_|^CERT_|SELF_SIGNED|CERTIFICATE/.test(code) &&
    ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE"].includes(
      code,
    )
  );
}

function requestAddress(url: URL, vetted: VettedAddress, deadline: number): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    let receivedHeaders = false;
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json, application/yaml, text/yaml, */*",
          "accept-encoding": "identity",
        },
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => callback(null, vetted.address, vetted.family),
      },
      (message) => {
        receivedHeaders = true;
        resolve({
          status: message.statusCode ?? 0,
          statusText: message.statusMessage ?? "",
          headers: message.headers,
          message,
        });
      },
    );
    request.setTimeout(remaining(deadline, url.href), () => {
      request.destroy(Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }));
    });
    request.on("error", (error) => reject(Object.assign(error, { receivedHeaders })));
    request.end();
  });
}

async function requestVetted(
  url: URL,
  addresses: VettedAddress[],
  deadline: number,
): Promise<HttpsResponse> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await withDeadline(requestAddress(url, address, deadline), deadline, url.href);
    } catch (error) {
      lastError = error;
      if (!retryableConnectionError(error)) throw error;
    }
  }
  throw lastError;
}

async function responseText(
  response: HttpsResponse,
  uri: string,
  maxBytes: number,
  deadline: number,
): Promise<string> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new GenerationError(`OpenAPI reference exceeds ${maxBytes} bytes: ${uri}`);
  const encoding = response.headers["content-encoding"];
  if (encoding && encoding !== "identity")
    throw new GenerationError(
      `OpenAPI reference returned unsupported content encoding: ${encoding}`,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    await withDeadline(
      new Promise<void>((resolve, reject) => {
        response.message.on("data", (value: Buffer) => {
          size += value.byteLength;
          if (size > maxBytes) {
            response.message.destroy();
            reject(new GenerationError(`OpenAPI reference exceeds ${maxBytes} bytes: ${uri}`));
            return;
          }
          chunks.push(value);
        });
        response.message.on("end", resolve);
        response.message.on("error", reject);
        response.message.on("aborted", () =>
          reject(new GenerationError(`OpenAPI response body was aborted: ${uri}`)),
        );
      }),
      deadline,
      uri,
    );
  } catch (error) {
    response.message.destroy();
    throw error;
  }
  if (size > maxBytes) {
    throw new GenerationError(`OpenAPI reference exceeds ${maxBytes} bytes: ${uri}`);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchSource(uri: string, options: ResolvedLoadOptions): Promise<SourceDocument> {
  let current = new URL(uri);
  const deadline = Date.now() + options.timeoutMs;
  for (let redirects = 0; ; redirects += 1) {
    if (current.protocol !== "https:")
      throw new GenerationError(`Remote OpenAPI references must use HTTPS: ${current.href}`);
    if (current.username || current.password)
      throw new GenerationError(
        `Remote OpenAPI references must not include credentials: ${current.origin}`,
      );
    if (
      current.origin !== options.remoteRootOrigin &&
      !options.allowedReferenceOrigins.has(current.origin)
    )
      throw new GenerationError(`Cross-origin OpenAPI reference is not allowed: ${current.origin}`);
    const addresses = await vettedAddresses(current, options, deadline);
    const response = await requestVetted(current, addresses, deadline);
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= options.maxRedirects)
        throw new GenerationError(`Too many redirects while fetching OpenAPI reference ${uri}`);
      response.message.resume();
      const location = response.headers.location;
      if (!location)
        throw new GenerationError(`OpenAPI redirect is missing Location: ${current.href}`);
      current = new URL(location, current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.message.resume();
      throw new GenerationError(
        `Unable to fetch OpenAPI reference ${current.href}: ${response.status} ${response.statusText}`,
      );
    }
    return {
      uri: current.href,
      document: parseOpenApiDocument(
        await responseText(response, current.href, options.maxBytes, deadline),
        current.href,
      ),
    };
  }
}

async function readSource(uri: string, options: ResolvedLoadOptions): Promise<SourceDocument> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) return fetchSource(uri, options);
  const path = fileURLToPath(uri);
  const canonical = await realpath(path);
  if (!options.localRootDirectory) {
    throw new GenerationError(
      `Local OpenAPI reference escapes the specification directory: ${path}`,
    );
  }
  const relativePath = relative(options.localRootDirectory, canonical);
  if (relativePath.startsWith("..") || isAbsolute(relativePath))
    throw new GenerationError(
      `Local OpenAPI reference escapes the specification directory: ${path}`,
    );
  const contents = await readFile(canonical);
  if (contents.byteLength > options.maxBytes)
    throw new GenerationError(`OpenAPI reference exceeds ${options.maxBytes} bytes: ${path}`);
  return {
    uri: pathToFileURL(canonical).href,
    document: parseOpenApiDocument(contents.toString("utf8"), canonical),
  };
}

class OpenApiBundler {
  private readonly sources = new Map<string, Promise<SourceDocument>>();
  private readonly aliases = new Map<string, string>();
  private readonly names = new Map<string, string>();

  constructor(
    private readonly root: Json,
    private readonly rootUri: string,
    private readonly options: ResolvedLoadOptions,
  ) {}

  async bundle(): Promise<Json> {
    if (!this.root.components) this.root.components = {};
    if (!this.root.components.schemas) this.root.components.schemas = {};
    await this.expandObject(this.root, this.rootUri, this.root, new Set());
    return this.root;
  }

  private async source(uri: string): Promise<SourceDocument> {
    let pending = this.sources.get(uri);
    if (!pending) {
      pending = readSource(uri, this.options);
      this.sources.set(uri, pending);
    }
    return pending;
  }

  private componentName(uri: string, fragment: string): string {
    const canonical = `${uri}#${fragment}`;
    const existing = this.aliases.get(canonical);
    if (existing) return existing;
    const raw =
      fragment.split("/").filter(Boolean).at(-1) ??
      basename(new URL(uri).pathname).replace(/\.[^.]+$/, "");
    const base = pascal(pointerPart(raw)) || "ExternalSchema";
    let name = base;
    let suffix = 2;
    while (this.names.has(name) && this.names.get(name) !== canonical) name = `${base}${suffix++}`;
    this.aliases.set(canonical, name);
    this.names.set(name, canonical);
    return name;
  }

  private async expandObject(
    value: Json,
    uri: string,
    document: Json,
    stack: Set<string>,
  ): Promise<void> {
    for (const [key, child] of Object.entries(value))
      value[key] = await this.expand(child, uri, document, stack);
  }

  private async expand(
    value: unknown,
    uri: string,
    document: Json,
    stack: Set<string>,
  ): Promise<unknown> {
    if (stack.size > this.options.maxDepth)
      throw new GenerationError(`OpenAPI reference depth exceeds ${this.options.maxDepth}`);
    if (Array.isArray(value))
      return Promise.all(value.map((item) => this.expand(item, uri, document, stack)));
    if (!value || typeof value !== "object") return value;
    const object = value as Json;
    if (typeof object.$ref === "string") {
      const resolved = await this.resolveRef(object.$ref, uri, document, stack);
      const siblingEntries = Object.entries(object).filter(([key]) => key !== "$ref");
      if (!siblingEntries.length) return resolved;
      const result =
        resolved && typeof resolved === "object" && !Array.isArray(resolved)
          ? { ...(resolved as Json) }
          : {};
      for (const [key, child] of siblingEntries)
        result[key] = await this.expand(child, uri, document, stack);
      return result;
    }
    const result: Json = {};
    for (const [key, child] of Object.entries(object))
      result[key] = await this.expand(child, uri, document, stack);
    return result;
  }

  private async resolveRef(
    ref: string,
    baseUri: string,
    document: Json,
    stack: Set<string>,
  ): Promise<unknown> {
    const hash = ref.indexOf("#");
    const targetUri =
      hash === -1
        ? new URL(ref, baseUri).href
        : new URL(ref.slice(0, hash) || baseUri, baseUri).href;
    const fragment = hash === -1 ? "" : ref.slice(hash + 1);
    const canonical = `${targetUri}#${fragment}`;
    const targetSource =
      targetUri === this.rootUri ? { uri: targetUri, document } : await this.source(targetUri);
    const target = pointerValue(targetSource.document, fragment);
    const isRootSchema = targetUri === this.rootUri && fragment.startsWith("/components/schemas/");
    if (isRootSchema) return { $ref: `#${fragment}` };
    if (fragment.startsWith("/components/schemas/")) {
      const name = this.componentName(targetUri, fragment);
      if (stack.has(canonical)) return { $ref: `#/components/schemas/${name}` };
      if (!(name in this.root.components.schemas)) {
        this.root.components.schemas[name] = {};
        const next = new Set(stack).add(canonical);
        this.root.components.schemas[name] = (await this.expand(
          target,
          targetSource.uri,
          targetSource.document,
          next,
        )) as Json;
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    if (stack.has(canonical)) throw new GenerationError(`Circular non-schema reference at ${ref}`);
    return this.expand(
      target,
      targetSource.uri,
      targetSource.document,
      new Set(stack).add(canonical),
    );
  }
}

export async function loadOpenApi(input: string, options: OpenApiLoadOptions = {}): Promise<Json> {
  const remote = /^https?:\/\//.test(input);
  const localPath = remote ? undefined : await realpath(resolve(input));
  const uri = remote ? new URL(input).href : pathToFileURL(localPath!).href;
  const rootUrl = new URL(uri);
  if (remote && rootUrl.protocol !== "https:")
    throw new GenerationError("Remote OpenAPI roots must use HTTPS.");
  const positiveOption = (name: string, value: number): number => {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new GenerationError(`${name} must be a positive safe integer.`);
    return value;
  };
  const allowedReferenceOrigins = new Set(
    (options.allowedReferenceOrigins ?? []).map((origin) => {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new GenerationError(`Allowed reference origin must be an HTTPS origin: ${origin}`);
      }
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.href !== parsed.origin + "/"
      ) {
        throw new GenerationError(`Allowed reference origin must be an HTTPS origin: ${origin}`);
      }
      return parsed.origin;
    }),
  );
  const resolved: ResolvedLoadOptions = {
    allowedReferenceOrigins,
    allowPrivateHosts: options.allowPrivateHosts ?? false,
    maxBytes: positiveOption("maxBytes", options.maxBytes ?? 5 * 1024 * 1024),
    maxDepth: positiveOption("maxDepth", options.maxDepth ?? 32),
    maxRedirects: positiveOption("maxRedirects", options.maxRedirects ?? 5),
    timeoutMs: positiveOption("timeoutMs", options.timeoutMs ?? 10_000),
    ...(remote
      ? { remoteRootOrigin: rootUrl.origin }
      : { localRootDirectory: await realpath(dirname(localPath!)) }),
  };
  const source = await readSource(uri, resolved);
  return new OpenApiBundler(source.document, source.uri, resolved).bundle();
}
export function generateFiles(document: Json): Record<(typeof OWNED)[number], string> {
  const version = String(document.openapi ?? "");
  if (!/^3\.(0|1)\.\d+$/.test(version))
    fail(`Unsupported OpenAPI version ${version || "missing"}`, "#/openapi");
  if (document.webhooks) fail("Webhooks are unsupported", "#/webhooks");
  const schemas = document.components?.schemas ?? {};
  const names = new Map<string, string>();
  for (const name of Object.keys(schemas).sort()) {
    const safe = pascal(name);
    if (!safe || names.has(safe))
      fail(`Component name collision for ${name}`, pointer("components", "schemas", name));
    names.set(safe, name);
  }
  const schemaLines = [...names].map(
    ([safe, original]) =>
      `export type ${safe} = ${schemaType(schemas[original], pointer("components", "schemas", original))};`,
  );
  const operationSchemaReferences = new Set<string>();
  const apiSchemaReferences = new Set<string>();
  const apiOperationReferences = new Set<string>();
  const contentSchemaReferences: SchemaReferenceCollector = {
    add(name) {
      operationSchemaReferences.add(name);
      apiSchemaReferences.add(name);
    },
  };
  const operationTypes: string[] = [];
  const descriptors: string[] = [];
  const seen = new Set<string>();
  for (const path of Object.keys(document.paths ?? {}).sort())
    for (const method of METHODS) {
      const operation = document.paths[path]?.[method];
      if (!operation) continue;
      const at = pointer("paths", path, method);
      const id = operation.operationId;
      if (!id || !identifier.test(id))
        fail("A unique JavaScript-identifier operationId is required", `${at}/operationId`, id);
      if (seen.has(id)) fail("Duplicate operationId", `${at}/operationId`, id);
      seen.add(id);
      if (operation.callbacks) fail("Callbacks are unsupported", `${at}/callbacks`, id);
      const parametersByIdentity = new Map<string, Json>();
      for (const parameter of [
        ...(document.paths[path].parameters ?? []),
        ...(operation.parameters ?? []),
      ]) {
        if (parameter.$ref) fail("Parameter references must be bundled", `${at}/parameters`, id);
        if (typeof parameter.name !== "string" || typeof parameter.in !== "string") {
          fail("Parameters require string name and in fields", `${at}/parameters`, id);
        }
        parametersByIdentity.set(`${parameter.in}\0${parameter.name}`, parameter);
      }
      const parameters = [...parametersByIdentity.values()];
      const byLocation: Record<string, Json[]> = { path: [], query: [], header: [] };
      for (const parameter of parameters) {
        if (parameter.in === "cookie")
          fail("Cookie parameters are unsupported", `${at}/parameters`, id);
        if (!byLocation[parameter.in])
          fail(`Unsupported parameter location ${parameter.in}`, `${at}/parameters`, id);
        byLocation[parameter.in]!.push(parameter);
      }
      const templateParameters = new Set(
        [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]),
      );
      const declaredPathParameters = new Set(byLocation.path.map((parameter) => parameter.name));
      for (const name of templateParameters) {
        const parameter = byLocation.path.find((candidate) => candidate.name === name);
        if (!parameter)
          fail(`Path template parameter ${name} is not declared`, `${at}/parameters`, id);
        if (!parameter || parameter.required !== true)
          fail(`Path parameter ${name} must be required`, `${at}/parameters`, id);
      }
      for (const name of declaredPathParameters) {
        if (!templateParameters.has(name))
          fail(
            `Path parameter ${name} is not present in the path template`,
            `${at}/parameters`,
            id,
          );
      }
      const prefix = pascal(id);
      const renderParameters = (location: string) => {
        const list = byLocation[location]!.sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return undefined;
        const name = `${prefix}${pascal(location)}`;
        apiOperationReferences.add(name);
        operationTypes.push(
          `export type ${name} = {\n${list.map((p) => `  ${JSON.stringify(p.name)}${p.required || location === "path" ? "" : "?"}: ${schemaType(p.schema ?? {}, `${at}/parameters`, "request", operationSchemaReferences)};`).join("\n")}\n};`,
        );
        const defaultStyle = location === "query" ? "form" : "simple";
        const spec = `{ ${list
          .map((p) => {
            const style = p.style ?? defaultStyle;
            const explode = p.explode ?? style === "form";
            return `${JSON.stringify(p.name)}: { style: ${JSON.stringify(style)}, explode: ${explode} }`;
          })
          .join(", ")} }`;
        return { name, spec };
      };
      const params = renderParameters("path"),
        query = renderParameters("query"),
        headers = renderParameters("header");
      const body = operation.requestBody
        ? pickContent(
            operation.requestBody.content,
            `${at}/requestBody`,
            "request",
            contentSchemaReferences,
          )
        : undefined;
      if (body) operationTypes.push(`export type ${prefix}Body = ${body.type};`);
      const successes = responseSchema(operation, at, true);
      if (!successes.length) fail("At least one 2xx response is required", `${at}/responses`, id);
      const errors = responseSchema(operation, at, false);
      const chain: string[] = [`${method === "delete" ? "del" : method}(${JSON.stringify(path)})`];
      if (params) chain.push(`params<${params.name}>(${params.spec})`);
      if (query) chain.push(`query<${query.name}>(${query.spec})`);
      if (headers) chain.push(`headers<${headers.name}>(${headers.spec})`);
      if (body) chain.push(`body(${body.codec})`);
      for (const [status, response] of successes) {
        if (response.links)
          fail("Response links are unsupported", `${at}/responses/${status}/links`, id);
        const value = pickContent(
          response.content,
          `${at}/responses/${status}`,
          "response",
          contentSchemaReferences,
        );
        const typeName = `${prefix}Response${status}`;
        operationTypes.push(`export type ${typeName} = ${value.type};`);
        chain.push(`returns(${status === "200" ? "" : `${status}, `}${value.codec})`);
      }
      if (errors.length) {
        const rendered = errors.map(([status, response]) => {
          if (response.links)
            fail("Response links are unsupported", `${at}/responses/${status}/links`, id);
          const value = pickContent(
            response.content,
            `${at}/responses/${status}`,
            "response",
            contentSchemaReferences,
          );
          const typeName = `${prefix}Error${pascal(status)}`;
          operationTypes.push(`export type ${typeName} = ${value.type};`);
          return `${JSON.stringify(status)}: ${value.codec}`;
        });
        chain.push(`errors({ ${rendered.join(", ")} })`);
      }
      if (operation.security ?? document.security)
        chain.push(`security(${JSON.stringify(operation.security ?? document.security)})`);
      descriptors.push(`  ${id}: ${chain.join("\n    .")},`);
    }
  const imports = [
    ...new Set(
      descriptors
        .join(" ")
        .match(
          /\b(get|post|put|patch|del|head|options|json|text|urlEncoded|multipart|arrayBuffer|empty|content)\b/g,
        ) ?? [],
    ),
  ].sort();
  const files = {
    "schemas.ts": `${schemaLines.join("\n\n")}\n`,
    "operations.ts": `${operationSchemaReferences.size ? `import type { ${[...operationSchemaReferences].sort().join(", ")} } from "./schemas";\n\n` : ""}${operationTypes.join("\n\n")}\n`,
    "api.ts": `import { ${["defineApi", "createClient", ...imports].join(", ")} } from "@askrjs/fetch";\nimport type { ClientOptions } from "@askrjs/fetch";\n${apiSchemaReferences.size ? `import type { ${[...apiSchemaReferences].sort().join(", ")} } from "./schemas";\n` : ""}${apiOperationReferences.size ? `import type { ${[...apiOperationReferences].sort().join(", ")} } from "./operations";\n` : ""}\nexport const api = defineApi({\n${descriptors.join("\n")}\n}, ${JSON.stringify({ servers: (document.servers ?? []).map((s: Json) => s.url), securitySchemes: document.components?.securitySchemes ?? {} }, null, 2)});\n\nexport const createApiClient = (options?: ClientOptions) => createClient(api, options);\n`,
    "index.ts": `export * from "./schemas";\nexport * from "./operations";\nexport { api, createApiClient } from "./api";\n`,
    ".askr-generated.json": "",
  } satisfies Record<(typeof OWNED)[number], string>;
  files[".askr-generated.json"] = `${JSON.stringify({ version: 1, files: [...OWNED] }, null, 2)}\n`;
  return files;
}
async function existingFiles(directory: string) {
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}
export async function writeGenerated(
  directory: string,
  files: Record<string, string>,
  check: boolean,
): Promise<void> {
  const output = resolve(directory);
  const outputStat = await stat(output).catch(() => null);
  if (outputStat && !outputStat.isDirectory()) {
    throw new GenerationError(`Generated output must be a directory: ${output}`);
  }
  const entries = await existingFiles(output);
  if (check) {
    if (!entries.length) throw new GenerationError(`Generated directory is missing: ${output}`);
    const expected = Object.keys(files).sort();
    if (JSON.stringify(entries) !== JSON.stringify(expected))
      throw new GenerationError(`Generated file ownership differs in ${output}`);
    for (const name of expected)
      if ((await readFile(join(output, name), "utf8")) !== files[name])
        throw new GenerationError(`Generated file is stale: ${name}`);
    return;
  }
  if (entries.length && !entries.includes(".askr-generated.json"))
    throw new GenerationError(`Refusing to overwrite non-generated directory: ${output}`);
  const stage = await mkdtemp(join(dirname(output), `.${basename(output)}-stage-`));
  for (const [name, content] of Object.entries(files)) await writeFile(join(stage, name), content);
  const backup = `${output}.backup-${process.pid}`;
  let moved = false;
  try {
    if (entries.length) {
      await rename(output, backup);
      moved = true;
    }
    await rename(stage, output);
    if (moved) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    if (moved) await rename(backup, output);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function generate(
  input: string,
  output: string,
  check = false,
  loadOptions: OpenApiLoadOptions = {},
) {
  if (!/^https?:\/\//.test(input)) {
    const resolvedInput = resolve(input);
    const resolvedOutput = resolve(output);
    const inputWithinOutput = relative(resolvedOutput, resolvedInput);
    if (!inputWithinOutput.startsWith("..") && !isAbsolute(inputWithinOutput)) {
      throw new GenerationError("Generated output must not contain its OpenAPI input document");
    }
  }
  const document = await loadOpenApi(input, loadOptions);
  const files = generateFiles(document);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeGenerated(output, files, check);
}
