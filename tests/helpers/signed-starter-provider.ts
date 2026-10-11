import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer, request, type Server } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer as createPortOwner } from "node:net";
import { runOwnedCommand } from "./owned-command";

export const providers = ["auth0", "microsoft", "google", "apple"] as const;
export type Provider = (typeof providers)[number];
export const tenant = "01234567-89ab-cdef-0123-456789abcdef";
export const privateCanaries = [
  "STARTER_CLIENT_PRIVATE_CANARY",
  "STARTER_ACCESS_PRIVATE_CANARY",
  "STARTER_REFRESH_PRIVATE_CANARY",
  "STARTER_SESSION_PRIVATE_CANARY",
] as const;
export const endpoints = (provider: Provider) => {
  const issuer =
    provider === "auth0"
      ? "https://tenant.example.test/"
      : provider === "microsoft"
        ? `https://login.microsoftonline.com/${tenant}/v2.0`
        : provider === "google"
          ? "https://accounts.google.com"
          : "https://appleid.apple.com";
  return {
    issuer,
    authorize:
      provider === "auth0"
        ? `${issuer}authorize`
        : provider === "microsoft"
          ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
          : `${issuer}${provider === "google" ? "/o/oauth2/v2/auth" : "/auth/authorize"}`,
    token:
      provider === "auth0"
        ? `${issuer}oauth/token`
        : provider === "microsoft"
          ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
          : provider === "google"
            ? "https://oauth2.googleapis.com/token"
            : `${issuer}/auth/token`,
    jwks:
      provider === "auth0"
        ? `${issuer}.well-known/jwks.json`
        : provider === "microsoft"
          ? "https://login.microsoftonline.com/common/discovery/v2.0/keys"
          : provider === "google"
            ? "https://www.googleapis.com/oauth2/v3/certs"
            : `${issuer}/auth/keys`,
    discovery: `${issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`,
  };
};
export async function bounded<T>(operation: Promise<T>, label: string, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Owned fixture deadline: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function port() {
  const owner = createPortOwner();
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        owner.once("error", reject);
        owner.listen(0, "127.0.0.1", resolve);
      }),
      "allocate port",
    );
    const address = owner.address();
    assert(address && typeof address === "object");
    return address.port;
  } finally {
    if (owner.listening)
      await bounded(
        new Promise<void>((resolve, reject) =>
          owner.close((error) => (error ? reject(error) : resolve())),
        ),
        "release port",
      );
  }
}
export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export async function relayBrowserRequest(
  source: {
    url(): string;
    method(): string;
    allHeaders(): Promise<Record<string, string>>;
    postDataBuffer(): Buffer | null;
  },
  relay: (
    url: string,
    options: { method: string; headers: Record<string, string>; body?: Buffer },
  ) => Promise<Reply>,
) {
  return relay(source.url(), {
    method: source.method(),
    headers: await source.allHeaders(),
    body: source.postDataBuffer() ?? undefined,
  });
}
export class Cookies {
  private readonly values = new Map<string, { value: string; lax: boolean }>();
  accept(reply: Reply) {
    const lines = reply.headers["set-cookie"] ?? [];
    for (const line of typeof lines === "string" ? [lines] : lines) {
      const pair = line.split(";")[0]!,
        key = pair.slice(0, pair.indexOf("="));
      assert(/;\s*Secure(?:;|$)/iu.test(line), "Provider cookies must be Secure");
      if (/;\s*Max-Age=0(?:;|$)/iu.test(line)) this.values.delete(key);
      else this.values.set(key, { value: pair, lax: !/;\s*SameSite=None(?:;|$)/iu.test(line) });
    }
  }
  header(crossSitePost = false) {
    return [...this.values.values()]
      .filter((row) => !crossSitePost || !row.lax)
      .map((row) => row.value)
      .join("; ");
  }
}

// Independent signed protocol oracle. No Auth/private source or app factory is imported.
export async function signedStarterProvider(
  provider: Provider,
  directory: string,
  evidence: string,
  signal: AbortSignal,
  openssl: string,
  commandEnv: Record<string, string>,
) {
  const routes = endpoints(provider),
    allowed = new Set(Object.values(routes).filter((value) => value !== routes.issuer));
  const events: { kind: string; target: string; fields?: Record<string, string> }[] = [];
  const failures: string[] = [],
    unknown: string[] = [];
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const apple = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const certFile = path.join(directory, "fixture-ca.pem"),
    keyFile = path.join(directory, "fixture-tls.key"),
    appleFile = path.join(directory, "fixture-apple.p8");
  await runOwnedCommand({
    command: openssl,
    args: [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Owned starter protocol fixture",
      "-addext",
      "subjectAltName=DNS:app.example.test,DNS:tenant.example.test,DNS:login.microsoftonline.com,DNS:accounts.google.com,DNS:oauth2.googleapis.com,DNS:www.googleapis.com,DNS:appleid.apple.com",
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    cwd: directory,
    evidence,
    label: "fixture-certificate",
    timeoutMs: 30000,
    signal,
    env: commandEnv,
  });
  await fs.writeFile(appleFile, apple.privateKey.export({ format: "pem", type: "pkcs8" }), {
    flag: "wx",
  });
  const ca = await fs.readFile(certFile),
    key = await fs.readFile(keyFile);
  const backendPort = await port(),
    appPort = await port();
  const origin = `https://app.example.test:${appPort}`;
  const codes = new Map<
    string,
    {
      state: string;
      nonce: string;
      challenge: string;
      redirect: string;
      scope: string;
      corruption: string;
    }
  >();
  let corruption = "",
    sequence = 0,
    exchanges = 0;
  const issuedTokens: string[] = [];
  const html = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const tracked = new Set<import("node:net").Socket>();
  function track(server: Server) {
    server.on("connection", (socket) => {
      tracked.add(socket);
      socket.once("close", () => tracked.delete(socket));
    });
  }
  const providerServer = createServer({ cert: ca, key }, async (req, res) => {
    const timer = setTimeout(() => {
      req.destroy();
      res.destroy();
    }, 5000);
    try {
      const target = new URL(req.url ?? "/", `https://${req.headers.host}`),
        endpoint = target.origin + target.pathname;
      if (!allowed.has(endpoint)) {
        unknown.push(target.href);
        throw new Error("Unallowlisted provider endpoint");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        assert(size <= 32768);
        chunks.push(bytes);
      }
      const fields = new URLSearchParams(Buffer.concat(chunks).toString());
      events.push({
        kind:
          endpoint === routes.authorize
            ? "authorize"
            : endpoint === routes.token
              ? "exchange"
              : "request",
        target: target.href,
        fields: Object.fromEntries(endpoint === routes.authorize ? target.searchParams : fields),
      });
      res.setHeader("content-type", "application/json");
      if (endpoint === routes.discovery)
        return res.end(
          JSON.stringify({
            issuer: routes.issuer,
            authorization_endpoint: routes.authorize,
            token_endpoint: routes.token,
            jwks_uri: routes.jwks,
            response_types_supported: ["code"],
            response_modes_supported: ["query", "form_post"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_post"],
          }),
        );
      if (endpoint === routes.jwks)
        return res.end(
          JSON.stringify({
            keys: [
              {
                ...rsa.publicKey.export({ format: "jwk" }),
                kid: "starter-rsa",
                alg: "RS256",
                use: "sig",
              },
            ],
          }),
        );
      if (endpoint === routes.authorize) {
        const query = target.searchParams;
        assert.equal(query.get("client_id"), "fixture-client");
        assert.equal(query.get("response_type"), "code");
        assert.equal(query.get("code_challenge_method"), "S256");
        assert.equal(query.get("redirect_uri"), `${origin}/auth/callback/${provider}`);
        for (const field of ["state", "nonce", "code_challenge"]) assert(query.get(field));
        assert(
          !query.has("audience") && !query.has("resource"),
          "Identity-only starter must not request API resources",
        );
        const scope = query.get("scope")!.split(" ");
        assert(scope.includes(provider === "apple" ? "email" : "openid"));
        assert(!scope.some((value) => value.startsWith("https:") || value.startsWith("read:")));
        const code = `starter-code-${++sequence}`;
        const tx = {
          state: query.get("state")!,
          nonce: query.get("nonce")!,
          challenge: query.get("code_challenge")!,
          redirect: query.get("redirect_uri")!,
          scope: query.get("scope")!,
          corruption,
        };
        codes.set(code, tx);
        corruption = "";
        const result = new URLSearchParams({
          state: tx.corruption === "state" ? "wrong-state" : tx.state,
          ...(tx.corruption === "denial" ? { error: "access_denied" } : { code }),
        });
        if (provider === "apple") {
          assert.equal(query.get("response_mode"), "form_post");
          res.setHeader("content-type", "text/html; charset=utf-8");
          return res.end(
            `<form method="post" action="${html(tx.redirect)}">${[...result].map(([name, value]) => `<input type="hidden" name="${html(name)}" value="${html(value)}">`).join("")}<button id="continue">Complete Apple sign in</button></form>`,
          );
        }
        res.writeHead(303, { location: `${tx.redirect}?${result}` });
        return res.end();
      }
      assert.equal(endpoint, routes.token);
      assert.equal(fields.get("grant_type"), "authorization_code");
      const tx = codes.get(fields.get("code")!);
      codes.delete(fields.get("code")!);
      assert(tx, "Authorization code must be consumed exactly once");
      exchanges++;
      assert.equal(fields.get("client_id"), "fixture-client");
      assert.equal(fields.get("redirect_uri"), tx.redirect);
      assert.equal(
        createHash("sha256").update(fields.get("code_verifier")!).digest("base64url"),
        tx.challenge,
      );
      if (provider === "apple") {
        const parts = fields.get("client_secret")!.split(".");
        assert.equal(parts.length, 3);
        const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString()),
          claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
        assert.equal(header.alg, "ES256");
        assert.equal(header.kid, "KEY1234567");
        assert.equal(claims.iss, "TEAM123456");
        assert.equal(claims.sub, "fixture-client");
        assert.equal(claims.aud, routes.issuer);
        assert(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 300);
        assert(
          verify(
            "sha256",
            Buffer.from(`${parts[0]}.${parts[1]}`),
            { key: apple.publicKey, dsaEncoding: "ieee-p1363" },
            Buffer.from(parts[2]!, "base64url"),
          ),
        );
      } else assert.equal(fields.get("client_secret"), privateCanaries[0]);
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "starter-rsa", typ: "JWT" }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: routes.issuer,
          aud: "fixture-client",
          sub: "fixture-account",
          nonce: tx.corruption === "nonce" ? "wrong-nonce" : tx.nonce,
          iat: now,
          exp: now + 3600,
          email: "fixture@example.test",
          email_verified: true,
          ...(provider === "microsoft" ? { tid: tenant } : {}),
          ...(provider === "apple" ? { is_private_email: "true" } : {}),
        }),
      ).toString("base64url");
      const token = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), tx.corruption === "signature" ? wrongKey.privateKey : rsa.privateKey).toString("base64url")}`;
      issuedTokens.push(token);
      return res.end(
        JSON.stringify({
          token_type: "Bearer",
          access_token: privateCanaries[1],
          refresh_token: privateCanaries[2],
          id_token: token,
          expires_in: 3600,
          scope: tx.scope,
        }),
      );
    } catch (error) {
      failures.push(String(error));
      if (!res.headersSent) res.writeHead(500);
      res.end('{"error":"owned-fixture"}');
    } finally {
      clearTimeout(timer);
    }
  });
  track(providerServer);
  let appServer: Server | undefined;
  async function persistProtocol(outcome: string, cleanupErrors: unknown[] = []) {
    const raw = Buffer.from(
      JSON.stringify(
        { outcome, events, failures, unknown, exchanges, cleanupErrors: cleanupErrors.map(String) },
        null,
        2,
      ) + "\n",
    );
    const cap = 4 * 1024 * 1024;
    if (raw.length > cap) {
      await fs.writeFile(path.join(evidence, "provider-events.prefix.log"), raw.subarray(0, cap), {
        flag: "wx",
      });
      await fs.writeFile(
        path.join(evidence, "provider-events.json"),
        JSON.stringify({
          outcome,
          truncated: true,
          observedBytes: raw.length,
          retainedBytes: cap,
          prefix: "provider-events.prefix.log",
        }) + "\n",
        { flag: "wx" },
      );
      throw new Error(
        "Provider evidence exceeded bounded cap; exact prefix retained, not a complete report",
      );
    }
    await fs.writeFile(path.join(evidence, "provider-events.json"), raw, { flag: "wx" });
  }
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        providerServer.once("error", reject);
        providerServer.listen(0, "127.0.0.1", resolve);
      }),
      "provider listen",
    );
    const providerAddress = providerServer.address();
    assert(providerAddress && typeof providerAddress === "object");
    const providerPort = providerAddress.port;
    appServer = createServer({ cert: ca, key }, (req, res) => {
      const upstream = httpRequest({
        hostname: "127.0.0.1",
        port: backendPort,
        path: req.url,
        method: req.method,
        agent: false,
        headers: { ...req.headers, host: new URL(origin).host },
      });
      const timer = setTimeout(() => {
        upstream.destroy(new Error("Owned backend absolute deadline"));
        req.destroy();
        res.destroy();
      }, 5000);
      upstream.on("response", (source) => {
        res.writeHead(source.statusCode!, source.headers);
        source.on("error", () => res.destroy());
        source.pipe(res);
      });
      upstream.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502);
        res.end(String(error));
      });
      req.on("error", () => upstream.destroy());
      res.once("close", () => {
        clearTimeout(timer);
        upstream.destroy();
      });
      req.pipe(upstream);
    });
    track(appServer);
    const app = appServer;
    await bounded(
      new Promise<void>((resolve, reject) => {
        app.once("error", reject);
        app.listen(appPort, "127.0.0.1", resolve);
      }),
      "app TLS listen",
    );
    async function raw(
      url: string,
      options: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
    ): Promise<Reply> {
      const target = new URL(url),
        app = target.origin === origin;
      assert(app || allowed.has(target.origin + target.pathname), `Unallowlisted request ${url}`);
      return new Promise((resolve, reject) => {
        let settled = false,
          response: import("node:http").IncomingMessage | undefined;
        const req = request({
          hostname: "127.0.0.1",
          port: app ? appPort : providerPort,
          servername: target.hostname,
          ca,
          path: target.pathname + target.search,
          method: options.method ?? "GET",
          agent: false,
          headers: { ...options.headers, host: target.host, connection: "close" },
        });
        const timer = setTimeout(() => finish(new Error("Owned HTTPS request deadline")), 5000);
        function finish(error?: Error, value?: Reply) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          response?.destroy();
          req.destroy();
          if (error) reject(error);
          else resolve(value!);
        }
        req.on("error", finish);
        req.on("response", (res) => {
          response = res;
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("error", finish);
          res.on("aborted", () => finish(new Error("Truncated fixture response")));
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) finish(new Error("Fixture response cap"));
            else chunks.push(Buffer.from(chunk));
          });
          res.on("end", () =>
            finish(undefined, {
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        });
        req.end(options.body);
      });
    }
    const transport = path.join(directory, "owned-provider-fetch.mjs"),
      config = path.join(directory, "owned-provider-transport.json");
    await fs.writeFile(
      config,
      JSON.stringify({ allowed: [...allowed], ca: certFile, port: providerPort }),
      { flag: "wx" },
    );
    // This preload substitutes only TLS transport for the exact provider URLs. Signed protocol validation stays in the installed Auth package.
    await fs.writeFile(
      transport,
      `import fs from 'node:fs';import{request}from'node:https';const c=JSON.parse(fs.readFileSync(process.env.ASKR_OWNED_PROVIDER_TRANSPORT));const ca=fs.readFileSync(c.ca);globalThis.fetch=async(input,init)=>{const source=new Request(input,init),u=new URL(source.url);if(!c.allowed.includes(u.origin+u.pathname))throw new Error('Unallowlisted owned provider fetch '+u.href);const body=source.body?Buffer.from(await source.arrayBuffer()):undefined;if(body&&body.length>32768)throw new Error('Owned provider body cap');return new Promise((resolve,reject)=>{let settled=false,res;const req=request({hostname:'127.0.0.1',port:c.port,servername:u.hostname,ca,path:u.pathname+u.search,method:source.method,agent:false,headers:{...Object.fromEntries(source.headers),host:u.host,connection:'close'}},r=>{res=r;const chunks=[];let size=0;r.on('error',finish);r.on('aborted',()=>finish(new Error('Truncated owned provider response')));r.on('data',b=>{size+=b.length;if(size>1048576)finish(new Error('Owned provider response cap'));else chunks.push(b)});r.on('end',()=>{const headers=new Headers();for(const[k,v]of Object.entries(r.headers))for(const value of Array.isArray(v)?v:v===undefined?[]:[v])headers.append(k,value);finish(undefined,new Response(Buffer.concat(chunks),{status:r.statusCode,headers}))})});const timer=setTimeout(()=>finish(new Error('Owned provider transport deadline')),5000);function abort(){finish(new Error('Owned provider transport cancelled'))}function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);source.signal.removeEventListener('abort',abort);res?.destroy();req.destroy();error?reject(error):resolve(value)}req.on('error',finish);source.signal.addEventListener('abort',abort,{once:true});if(source.signal.aborted)abort();else req.end(body)})};\n`,
      { flag: "wx" },
    );
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(backendPort),
      APP_ORIGIN: origin,
      AUTH_SESSION_SECRET: Buffer.from(privateCanaries[3].repeat(3)).toString("base64url"),
      CSRF_SECRET: "owned-provider-CSRF-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      AUTH0_DOMAIN: "tenant.example.test",
      AUTH0_CLIENT_ID: "fixture-client",
      AUTH0_CLIENT_SECRET: privateCanaries[0],
      MICROSOFT_TENANT_ID: tenant,
      MICROSOFT_CLIENT_ID: "fixture-client",
      MICROSOFT_CLIENT_SECRET: privateCanaries[0],
      GOOGLE_CLIENT_ID: "fixture-client",
      GOOGLE_CLIENT_SECRET: privateCanaries[0],
      APPLE_SERVICES_ID: "fixture-client",
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY_PATH: appleFile,
      ASKR_OWNED_PROVIDER_TRANSPORT: config,
    };
    async function close() {
      for (const socket of tracked) socket.destroy();
      const cleanup = await Promise.allSettled(
        [providerServer, app].map((server) =>
          bounded(
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
            "owned TLS listener close",
          ),
        ),
      );
      const errors = cleanup.filter((row) => row.status === "rejected").map((row) => row.reason);
      await persistProtocol("close", errors);
      if (errors.length) throw new AggregateError(errors, "Owned TLS listener close failed");
      assert.equal(tracked.size, 0);
      assert.deepEqual(unknown, []);
      assert.deepEqual(failures, []);
    }
    return {
      origin,
      env,
      transport,
      raw,
      close,
      events,
      issuedTokens,
      get exchanges() {
        return exchanges;
      },
      corrupt(value: string) {
        assert(["state", "nonce", "signature", "denial"].includes(value));
        corruption = value;
      },
    };
  } catch (error) {
    for (const socket of tracked) socket.destroy();
    const cleanup = await Promise.allSettled(
      [providerServer, ...(appServer ? [appServer] : [])]
        .filter((server) => server.listening)
        .map((server) =>
          bounded(
            new Promise<void>((resolve, reject) =>
              server.close((cause) => (cause ? reject(cause) : resolve())),
            ),
            "failed fixture setup close",
          ),
        ),
    );
    await persistProtocol("setup-failed", [
      error,
      ...cleanup.filter((row) => row.status === "rejected").map((row) => row.reason),
    ]);
    throw new AggregateError(
      [error, ...cleanup.filter((row) => row.status === "rejected").map((row) => row.reason)],
      "Owned signed fixture setup failed",
    );
  }
}
