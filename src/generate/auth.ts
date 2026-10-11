import fs from "node:fs/promises";
import path from "node:path";
import type { FileChange } from "../file-changes";
import { findTemplateDir } from "../template-path";

const PROVIDERS = ["auth0", "microsoft", "google", "apple"] as const;
type Provider = (typeof PROVIDERS)[number];
type Template = "ssr" | "spa" | "startkit" | "full-stack";

const providerNames: Record<Provider, string> = {
  auth0: "Auth0",
  microsoft: "Microsoft",
  google: "Google",
  apple: "Apple",
};
const environmentNames: Record<Provider, readonly string[]> = {
  auth0: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"],
  microsoft: ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  apple: ["APPLE_SERVICES_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY_PATH"],
};

interface AuthState {
  readonly schemaVersion: 1;
  readonly template: Template;
  readonly providers: readonly Provider[];
  readonly origins: readonly string[];
}

export function providerAuthSelection(
  provider: string,
  values: readonly string[],
): {
  readonly provider: Provider;
  readonly origins: readonly string[];
} {
  if (!PROVIDERS.includes(provider as Provider)) {
    throw new Error("Unknown auth provider; choose auth0, microsoft, google, or apple.");
  }
  if (values.length === 0)
    throw new Error("Provider auth requires an explicit --origin https://app.example.");
  const origins = values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Each --origin must be an exact HTTPS application origin.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      value.trim() !== value ||
      /[\\\s]/.test(value)
    ) {
      throw new Error(
        "Each --origin must be an exact HTTPS application origin without credentials, paths, queries or fragments.",
      );
    }
    return url.origin;
  });
  return { provider: provider as Provider, origins: [...new Set(origins)].sort() };
}

async function readOwned(root: string, relative: string): Promise<string | null> {
  const parts = relative.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error(`Refusing symbolic link in owned auth output: ${relative}`);
    if (index !== parts.length - 1 && !stat.isDirectory())
      throw new Error(`Auth output parent is not a directory: ${relative}`);
    if (index === parts.length - 1 && !stat.isFile())
      throw new Error(`Auth output is not a regular file: ${relative}`);
  }
  return fs.readFile(current, "utf8");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readState(value: string, template: Template): AuthState {
  const parsed: unknown = JSON.parse(value);
  if (
    !object(parsed) ||
    Object.keys(parsed).sort().join(",") !== "origins,providers,schemaVersion,template" ||
    parsed.schemaVersion !== 1 ||
    parsed.template !== template ||
    !Array.isArray(parsed.providers) ||
    !Array.isArray(parsed.origins) ||
    parsed.providers.length === 0 ||
    parsed.providers.some(
      (provider) => typeof provider !== "string" || !PROVIDERS.includes(provider as Provider),
    ) ||
    parsed.origins.some((origin) => typeof origin !== "string")
  ) {
    throw new Error(
      "The owned .askr/auth.json configuration changed; review it before adding auth.",
    );
  }
  const providers = parsed.providers as Provider[];
  const origins = providerAuthSelection(providers[0], parsed.origins as string[]).origins;
  if (
    JSON.stringify(providers) !== JSON.stringify([...new Set(providers)].sort()) ||
    JSON.stringify(parsed.origins) !== JSON.stringify(origins)
  )
    throw new Error("The owned auth configuration is not canonical; review it before adding auth.");
  return { schemaVersion: 1, template, providers, origins };
}

function providerFile(provider: Provider): string {
  const name = providerNames[provider];
  const fields: Record<Provider, readonly [string, string][]> = {
    auth0: [
      ["domain", "AUTH0_DOMAIN"],
      ["clientId", "AUTH0_CLIENT_ID"],
      ["clientSecret", "AUTH0_CLIENT_SECRET"],
    ],
    microsoft: [
      ["tenantId", "MICROSOFT_TENANT_ID"],
      ["clientId", "MICROSOFT_CLIENT_ID"],
      ["clientSecret", "MICROSOFT_CLIENT_SECRET"],
    ],
    google: [
      ["clientId", "GOOGLE_CLIENT_ID"],
      ["clientSecret", "GOOGLE_CLIENT_SECRET"],
    ],
    apple: [
      ["servicesId", "APPLE_SERVICES_ID"],
      ["teamId", "APPLE_TEAM_ID"],
      ["keyId", "APPLE_KEY_ID"],
    ],
  };
  return [
    ...(provider === "apple"
      ? [
          'import { createPrivateKey } from "node:crypto";',
          'import { readFileSync } from "node:fs";',
        ]
      : []),
    `import { create${name}Provider } from "@askrjs/auth/providers/${provider}";`,
    'import { requiredEnv } from "../env";',
    "",
    `export function ${provider}Provider() {`,
    `  return create${name}Provider({`,
    `    id: "${provider}",`,
    ...fields[provider].map(
      ([field, environment]) => `    ${field}: requiredEnv("${environment}"),`,
    ),
    ...(provider === "apple"
      ? [
          '    privateKey: createPrivateKey(readFileSync(requiredEnv("APPLE_PRIVATE_KEY_PATH"))).export({ format: "jwk" }),',
        ]
      : [
          "    // Identity sign-in only. Add explicit API resources/scopes before calling ctx.auth.token().",
          "    resources: [],",
        ]),
    "  });",
    "}",
    "",
  ].join("\n");
}

function generated(state: AuthState): Record<string, string> {
  return {
    ...Object.fromEntries(
      state.providers.map((provider) => [
        `src/auth/providers/${provider}.ts`,
        providerFile(provider),
      ]),
    ),
    "src/auth/env.ts": [
      "// Server-only: the CLI writes environment names, never credential values.",
      "export function requiredEnv(name: string): string {",
      "  const value = process.env[name];",
      "  if (!value) throw new Error(`Configure the server environment variable ${name}.`);",
      "  return value;",
      "}",
      "",
    ].join("\n"),
    "src/auth/server.ts": [
      'import type { ProviderSessionOptions } from "@askrjs/auth/server";',
      'import { requiredEnv } from "./env";',
      ...state.providers.map(
        (provider) => `import { ${provider}Provider } from "./providers/${provider}";`,
      ),
      "",
      "// Default authority is single-process. Use a shared CAS/lock store before deploying multiple workers.",
      "export function providerAuth(): ProviderSessionOptions {",
      "  return {",
      '    origin: requiredEnv("APP_ORIGIN"),',
      `    providers: [${state.providers.map((provider) => `${provider}Provider()`).join(", ")}],`,
      '    session: { secrets: [requiredEnv("AUTH_SESSION_SECRET")] },',
      '    postLogoutRedirects: ["/"],',
      "  };",
      "}",
      "",
    ].join("\n"),
    "src/auth/client.ts": [
      'import { createSessionAuth } from "@askrjs/askr/router";',
      "",
      'export const sessionAuth = createSessionAuth({ loginPath: "/login" });',
      "",
    ].join("\n"),
    "src/auth/login.tsx": [
      'import { currentRoute } from "@askrjs/askr/router";',
      'import { sessionAuth } from "./client";',
      "",
      "function returnTo(): string {",
      '  const value = currentRoute().query.get("next");',
      '  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\\\\s]/.test(value) ? value : "/";',
      "}",
      "",
      "export default function ProviderLoginPage() {",
      "  return <section><h1>Sign in</h1><p>Continue through your configured provider.</p><ul>",
      ...state.providers.map(
        (provider) =>
          `    <li><a href={sessionAuth.loginHref("${provider}", { returnTo: returnTo() })}>Continue with ${providerNames[provider]}</a></li>`,
      ),
      "  </ul></section>;",
      "}",
      "",
      "export function ProviderLogoutButton() {",
      '  return <button type="button" onClick={async () => { await sessionAuth.logout(); window.location.assign("/login"); }}>Sign out</button>;',
      "}",
      "",
    ].join("\n"),
  };
}

export async function planProviderAuth(
  root: string,
  provider: string,
  origins: readonly string[],
): Promise<{
  readonly changes: readonly FileChange[];
  readonly messages: readonly string[];
}> {
  const selected = providerAuthSelection(provider, origins);
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error("Refusing a symbolic link project root for auth generation.");
  const blueprintText = await readOwned(root, ".askr/blueprint.json");
  if (!blueprintText)
    throw new Error(
      "Provider auth supports known `askr create` starters; review custom project wiring manually.",
    );
  const blueprint: unknown = JSON.parse(blueprintText);
  if (
    !object(blueprint) ||
    typeof blueprint.appName !== "string" ||
    !["ssr", "spa", "startkit", "full-stack"].includes(String(blueprint.template))
  ) {
    throw new Error(
      "Provider auth requires an SSR-capable known starter; SSG has no session server.",
    );
  }
  const template = blueprint.template as Template;
  const stateText = await readOwned(root, ".askr/auth.json");
  const previous = stateText === null ? null : readState(stateText, template);
  const state: AuthState = {
    schemaVersion: 1,
    template,
    providers: [...new Set([...(previous?.providers ?? []), selected.provider])].sort(),
    origins: [...new Set([...(previous?.origins ?? []), ...selected.origins])].sort(),
  };
  const changes: FileChange[] = [];
  const append = async (relative: string, content: string) => {
    const current = await readOwned(root, relative);
    if (current !== content)
      changes.push({ filePath: path.join(root, relative), content, expectedContent: current });
  };
  const before = previous ? generated(previous) : {};
  for (const [relative, content] of Object.entries(generated(state))) {
    const current = await readOwned(root, relative);
    if (current !== (before[relative] ?? null))
      throw new Error(
        `Generated auth file changed or is not owned: ${relative}. Review custom wiring before adding auth.`,
      );
    await append(relative, content);
  }
  if (!previous) {
    const templateDir = await findTemplateDir(template);
    const original = async (relative: string) =>
      (await fs.readFile(path.join(templateDir, relative), "utf8")).replace(
        /\{\{\s*appName\s*\}\}/g,
        blueprint.appName as string,
      );
    const replace = async (relative: string, transform: (content: string) => string) => {
      const current = await readOwned(root, relative);
      const expected = await original(relative);
      if (current !== expected)
        throw new Error(
          `Starter file changed: ${relative}. Review custom wiring before adding auth.`,
        );
      await append(relative, transform(expected));
    };
    const routeFile =
      template === "spa"
        ? "src/pages/_routes.tsx"
        : template === "startkit"
          ? "src/router.tsx"
          : "src/routes.tsx";
    if (template === "startkit") {
      await replace(
        "src/routes/auth-config.ts",
        () => 'export { sessionAuth as routeAuth } from "../auth/client";\n',
      );
      await replace(routeFile, (content) =>
        content
          .replace("import { routeAuth }", "import { sessionAuth }")
          .replace("'./routes/auth-config'", "'./auth/client'")
          .replace("auth: routeAuth", "auth: sessionAuth"),
      );
      await replace(
        "src/pages/auth/login.tsx",
        () => 'export { default } from "../../auth/login";\n',
      );
      await replace("src/components/app-header.tsx", (content) =>
        content
          .replace(
            "import { signOut } from '../lib/mock-data';",
            'import { sessionAuth } from "../auth/client";',
          )
          .replace("onSelect={() => {", "onSelect={async () => {")
          .replace("signOut();", "await sessionAuth.logout();")
          .replace(
            "Session state is now cleared from local storage.",
            "The server session is now signed out.",
          ),
      );
      await replace("src/lib/mock-data.ts", (content) =>
        content
          .replace("const sessionStorageKey = 'startkit:session';\n", "")
          .replace("let sessionEmail: string | null = null;\n", "")
          .replace("  sessionEmail = readStorage(sessionStorageKey) ?? sessionEmail;\n", "")
          .replace(
            /export function isAuthenticated\(\): boolean \{[\s\S]*?(?=export async function getDashboardData)/,
            "",
          )
          .replace("  signOut();\n", ""),
      );
      await replace("tests/resources.test.ts", (content) =>
        content
          .replace("  isAuthenticated,\n", "")
          .replace("  signIn,\n", "")
          .replace("  signOut,\n", "")
          .replace(/\n  it\('should sign in and sign out session state',[\s\S]*?\n  \}\);/, ""),
      );
    } else if (template === "spa") {
      await replace(
        routeFile,
        (content) =>
          'import { requireAnonymous, requireUser } from "@askrjs/auth";\nimport { sessionAuth } from "../auth/client";\n' +
          content
            .replace(
              "group({ layout: AuthLayout }",
              "group({ layout: AuthLayout, auth: requireAnonymous() }",
            )
            .replace(
              "group({ layout: AppLayout }",
              "group({ layout: AppLayout, auth: requireUser() }",
            )
            .replace(/\n\}\);\s*$/, "\n}, { auth: sessionAuth });\n"),
      );
      await replace(
        "src/pages/auth/login.tsx",
        () => 'export { default } from "../../auth/login";\n',
      );
      await replace(
        "src/pages/app/_layout.tsx",
        (content) =>
          'import { ProviderLogoutButton } from "../../auth/login";\n' +
          content
            .replace(
              /<NavLink href="\/" match="exact">[\s\S]*?<\/NavLink>/,
              "<ProviderLogoutButton />",
            )
            .replace("  LogOutIcon,\n", ""),
      );
    } else {
      const authImports =
        template === "full-stack"
          ? 'import { requireAnonymous, requireUser } from "@askrjs/auth";\n'
          : 'import { requireAnonymous } from "@askrjs/auth";\n';
      await replace(
        routeFile,
        (content) =>
          authImports +
          'import { sessionAuth } from "./auth/client";\nimport ProviderLoginPage from "./auth/login";\n' +
          content
            .replace(
              "createRouteRegistry(() => {",
              'createRouteRegistry(() => {\n  route("/login", ProviderLoginPage, { auth: requireAnonymous() });',
            )
            .replace(
              template === "full-stack" ? "group({ layout: AppLayout }" : "__no_change__",
              "group({ layout: AppLayout, auth: requireUser() }",
            )
            .replace(/\n\}\);\s*$/, "\n}, { auth: sessionAuth });\n"),
      );
    }
    const serverFile = template === "full-stack" ? "src/server/app.ts" : "src/entry-server.tsx";
    if (template === "full-stack") {
      await replace(serverFile, (content) =>
        content
          .replace(
            'import { createAuth } from "@askrjs/auth";',
            'import { providerAuth } from "../auth/server";',
          )
          .replace('  const development = process.env.NODE_ENV !== "production";\n', "")
          .replace(/        if \(development\) \{[\s\S]*?\n        \}\n/, "")
          .replace(
            /    auth: \{\n      resolver: createAuth\(\{[\s\S]*?\n    \},/,
            "    auth: providerAuth(),",
          )
          .replace('ctx.auth.session?.id ?? "anonymous"', 'ctx.auth.principal?.id ?? "anonymous"'),
      );
      await replace(
        "src/pages/home.tsx",
        (content) =>
          'import { ProviderLogoutButton } from "../auth/login";\n' +
          content.replace(
            /      <form method="post" action="\/api\/session">[\s\S]*?      <\/form>/,
            "      <ProviderLogoutButton />",
          ),
      );
    } else if (template === "ssr") {
      await replace(
        serverFile,
        (content) =>
          'import { providerAuth } from "./auth/server";\n' +
          content.replace(
            "  pages: pageRegistry,",
            "  pages: pageRegistry,\n  auth: providerAuth(),",
          ),
      );
    } else {
      if (
        (await readOwned(root, serverFile)) !== null ||
        (await readOwned(root, "server.ts")) !== null
      )
        throw new Error("A custom starter server already exists; review auth wiring manually.");
      await append(
        serverFile,
        `import { createAskrApp } from "@askrjs/server/askr";\nimport { pageRegistry } from "${template === "spa" ? "./pages/_routes" : "./router"}";\nimport { providerAuth } from "./auth/server";\n\nconst app = createAskrApp({ name: ${JSON.stringify(blueprint.appName)}, version: "0.1.0", dependencies: undefined, pages: pageRegistry, auth: providerAuth() });\nexport { app };\nexport default app;\n`,
      );
      await append(
        "server.ts",
        await fs.readFile(path.join(await findTemplateDir("ssr"), "server.ts"), "utf8"),
      );
      await replace("src/main.tsx", (content) =>
        content
          .replace("import { createSPA }", "import { createSPA, hydrateSPA }")
          .replace(
            template === "spa"
              ? "await createSPA({\n  root: document.getElementById('app')!,\n  registry: pageRegistry,\n});"
              : "await createSPA({ root, registry: pageRegistry });",
            `${template === "spa" ? "const root = document.getElementById('app');\nif (!root) throw new Error('Missing #app root element.');\n\n" : ""}if (root.hasChildNodes()) {\n  await hydrateSPA({ root, registry: pageRegistry });\n} else {\n  await createSPA({ root, registry: pageRegistry });\n}`,
          ),
      );
      await replace("index.html", (content) =>
        content
          .replace("</head>", "  <!--askr-head-->\n  </head>")
          .replace('<div id="app"></div>', '<div id="app"><!--askr-app--></div>'),
      );
      await replace(
        "vite.config.ts",
        (content) =>
          'import { askrServer } from "@askrjs/vite/server";\n' +
          content
            .replace(
              "plugins: [askr()]",
              'plugins: [askr(), askrServer({ entry: "./src/entry-server.tsx" })]',
            )
            .replace("build: {", "build: {\n    manifest: true,"),
      );
    }
    await replace("package.json", (content) => {
      const manifest = JSON.parse(content);
      const range = manifest.dependencies["@askrjs/askr"];
      Object.assign(manifest.dependencies, {
        "@askrjs/auth": range,
        "@askrjs/node": range,
        "@askrjs/server": range,
      });
      manifest.scripts.build = "vp build && vp build --ssr server.ts --outDir dist/server";
      manifest.scripts.preview = "node dist/server/server.js";
      return `${JSON.stringify(manifest, null, 2)}\n`;
    });
  }
  const environmentFile = ".env.example";
  const environment = (await readOwned(root, environmentFile)) ?? "";
  const names = [
    "APP_ORIGIN",
    "AUTH_SESSION_SECRET",
    ...state.providers.flatMap((value) => environmentNames[value]),
  ];
  const missing = names.filter((name) => !new RegExp(`^${name}=`, "m").test(environment));
  if (missing.length > 0)
    await append(
      environmentFile,
      `${environment}${environment && !environment.endsWith("\n") ? "\n" : ""}${missing.map((name) => `${name}=`).join("\n")}\n`,
    );
  await append(".askr/auth.json", `${JSON.stringify(state, null, 2)}\n`);
  const name = providerNames[selected.provider];
  const identityScopes =
    selected.provider === "apple"
      ? "openid email name"
      : selected.provider === "google"
        ? "openid profile email"
        : "openid profile email offline_access";
  return {
    changes,
    messages: [
      `Added ${name} confidential Web application auth. Configure server-only environment values; the CLI never reads .env or copies keys.`,
      ...selected.origins.flatMap((origin) => [
        `Callback: ${origin}/auth/callback/${selected.provider}`,
        `Logout: ${origin}/auth/logout (local application POST endpoint)`,
        `Post-logout return: ${origin}/`,
      ]),
      `Identity scopes: ${identityScopes}. API resources/scopes require explicit application configuration.`,
      "Set APP_ORIGIN to the deployed origin and AUTH_SESSION_SECRET to a cryptographically random base64url key containing at least 32 bytes. Keep provider secrets server-only.",
      ...(selected.provider === "google"
        ? [
            "Google: configure the consent screen, authorized redirect URI, and exact hosted-domain policy when needed.",
          ]
        : []),
      ...(selected.provider === "microsoft"
        ? [
            "Microsoft: register a tenant-specific confidential Web application using its tenant GUID; configure Graph/API permissions explicitly.",
          ]
        : []),
      ...(selected.provider === "apple"
        ? [
            "Apple: use a Services ID, register the HTTPS callback domain/URL, and supply a server-only .p8 path. Apple does not support a localhost callback; use an HTTPS development origin.",
          ]
        : []),
      ...(selected.provider === "auth0"
        ? [
            "Auth0: register a confidential Regular Web Application; configure callback/logout URLs and explicit audience/organization policy when needed.",
          ]
        : []),
      "Provider qualification uses simulated providers; live provider-console compatibility remains pending. Review generated files before deployment.",
    ],
  };
}
