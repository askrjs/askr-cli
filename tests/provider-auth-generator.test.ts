import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { runAddCli } from "../src/bin/add";
import { runCreateCli } from "../src/bin/create";
import { writeFileChanges } from "../src/file-changes";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const providers = ["auth0", "microsoft", "google", "apple"] as const;
const names = {
  auth0: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"],
  microsoft: ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  apple: ["APPLE_SERVICES_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY_PATH"],
} as const;

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    io: {
      log: (...values: unknown[]) => logs.push(values.join(" ")),
      error: (...values: unknown[]) => errors.push(values.join(" ")),
    },
  };
}

async function scaffold(template = "ssr") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-provider-generator-"));
  roots.push(root);
  const target = path.join(root, "app");
  const output = capture();
  expect(
    await runCreateCli(
      [template, "provider-app", "--dir", target, "--no-install", "--no-skills"],
      output.io,
    ),
  ).toBe(0);
  expect(output.errors).toEqual([]);
  return target;
}

async function contents(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        files[relative] = await fs.readFile(file, "utf8");
      }
    }
  }
  await visit(root);
  return files;
}

function expectParseable(files: Record<string, string>, before: Record<string, string>): void {
  for (const [fileName, content] of Object.entries(files)) {
    if (!/\.tsx?$/.test(fileName) || before[fileName] === content) continue;
    const result = ts.transpileModule(content, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
      },
    });
    expect(
      result.diagnostics?.filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      ),
      fileName,
    ).toEqual([]);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe.each(providers)("add auth %s", (provider) => {
  test("registers one server preset and router binding, blank environment names, and exact console values", async () => {
    const root = await scaffold();
    const before = await contents(root);
    const output = capture();
    expect(
      await runAddCli(
        [
          "auth",
          provider,
          "--cwd",
          root,
          "--origin",
          "https://app.example",
          "--origin",
          "https://preview.example",
        ],
        output.io,
      ),
    ).toBe(0);
    expect(output.errors).toEqual([]);
    const files = await contents(root);
    expectParseable(files, before);
    const server = files[`src/auth/providers/${provider}.ts`];
    expect(server).toContain(`@askrjs/auth/providers/${provider}`);
    expect(server).toContain(`id: "${provider}"`);
    expect(files["src/auth/server.ts"]).toContain("providers:");
    expect(files["src/auth/server.ts"]).toContain("AUTH_SESSION_SECRET");
    expect(files["src/auth/client.ts"]).toContain("createSessionAuth");
    expect(files["src/routes.tsx"]).toContain("auth: sessionAuth");
    expect(files["src/entry-server.tsx"]).toContain("auth: providerAuth()");
    for (const name of ["APP_ORIGIN", "AUTH_SESSION_SECRET", ...names[provider]]) {
      expect(files[".env.example"].split(/\r?\n/)).toContain(`${name}=`);
    }
    const printed = output.logs.join("\n");
    for (const origin of ["https://app.example", "https://preview.example"]) {
      expect(printed).toContain(`${origin}/auth/callback/${provider}`);
      expect(printed).toContain(`Logout: ${origin}/auth/logout`);
      expect(printed).toContain(`${origin}/`);
    }
    expect(printed).toMatch(/confidential|web application/i);
    const expectedScopes =
      provider === "apple"
        ? "openid email name"
        : provider === "google"
          ? "openid profile email"
          : "openid profile email offline_access";
    expect(printed).toContain(`Identity scopes: ${expectedScopes}`);
    if (provider === "apple") expect(printed).toMatch(/localhost/i);
    if (provider === "google") expect(printed).toMatch(/consent screen/i);
    if (provider === "microsoft") expect(printed).toMatch(/tenant/i);
    expect(server).not.toMatch(/readFile[^;\n]*\.env/);
  });

  test("is byte-idempotent and never reads actual secret values", async () => {
    const root = await scaffold();
    await fs.writeFile(
      path.join(root, ".env"),
      "AUTH_SESSION_SECRET=do-not-copy-actual-session-secret\nGOOGLE_CLIENT_SECRET=do-not-copy-google-secret\n",
    );
    const args = ["auth", provider, "--cwd", root, "--origin", "https://app.example"];
    const output = capture();
    expect(await runAddCli(args, output.io)).toBe(0);
    const before = await contents(root);
    expect(await runAddCli(args, output.io)).toBe(0);
    expect(await contents(root)).toEqual(before);
    for (const [file, text] of Object.entries(before)) {
      if (file !== ".env") expect(text).not.toContain("do-not-copy-");
    }
    expect(output.logs.join("\n")).not.toContain("do-not-copy-");
  });
});

test("adds a second provider beside the first without replacing application customization", async () => {
  const root = await scaffold();
  const output = capture();
  expect(
    await runAddCli(
      ["auth", "google", "--cwd", root, "--origin", "https://app.example"],
      output.io,
    ),
  ).toBe(0);
  const entry = path.join(root, "src/entry-server.tsx");
  await fs.appendFile(entry, "\n// Application-owned customization remains.\n");
  expect(
    await runAddCli(
      ["auth", "microsoft", "--cwd", root, "--origin", "https://app.example"],
      output.io,
    ),
  ).toBe(0);
  const files = await contents(root);
  expect(files["src/auth/server.ts"]).toContain("googleProvider");
  expect(files["src/auth/server.ts"]).toContain("microsoftProvider");
  expect(files["src/auth/providers/google.ts"]).toContain("createGoogleProvider");
  expect(files["src/auth/providers/microsoft.ts"]).toContain("createMicrosoftProvider");
  expect(files["src/entry-server.tsx"]).toContain("Application-owned customization remains");
});

test("requires explicit valid origins and refuses unknown providers or SSG without writing", async () => {
  const root = await scaffold();
  const before = await contents(root);
  for (const args of [
    ["auth", "google"],
    ["auth", "unknown", "--origin", "https://app.example"],
    ["auth", "google", "--origin", "https://app.example/private"],
    ["auth", "google", "--origin", "https://user:secret@app.example"],
    ["auth", "google", "--origin", "https://app.example#fragment"],
  ]) {
    const output = capture();
    expect(await runAddCli([...args, "--cwd", root], output.io)).toBe(1);
    expect(output.errors.join("\n")).toMatch(/origin|provider/i);
    expect(await contents(root)).toEqual(before);
  }
  const ssg = await scaffold("ssg");
  const staticBefore = await contents(ssg);
  const output = capture();
  expect(
    await runAddCli(["auth", "google", "--cwd", ssg, "--origin", "https://app.example"], output.io),
  ).toBe(1);
  expect(output.errors.join("\n")).toMatch(/server|SSR|SSG/);
  expect(await contents(ssg)).toEqual(staticBefore);
});

test("guards generated-file ownership and rolls back a failed shared-file transaction", async () => {
  const root = await scaffold();
  const before = await contents(root);
  const failingWriter: typeof writeFileChanges = (changes) =>
    writeFileChanges(changes, {
      replace: async (temporary, target) => {
        if (target.endsWith(`${path.sep}server.ts`))
          throw new Error("Injected publication failure");
        await fs.rename(temporary, target);
      },
    });
  const args = ["auth", "google", "--cwd", root, "--origin", "https://app.example"];
  expect(await runAddCli(args, capture().io, failingWriter)).toBe(1);
  expect(await contents(root)).toEqual(before);
  expect(await runAddCli(args, capture().io)).toBe(0);
  await fs.appendFile(path.join(root, "src/auth/server.ts"), "\n// custom provider wiring\n");
  const customized = await contents(root);
  const output = capture();
  expect(
    await runAddCli(["auth", "apple", "--cwd", root, "--origin", "https://app.example"], output.io),
  ).toBe(1);
  expect(output.errors.join("\n")).toMatch(/custom|changed|owned|review/i);
  expect(await contents(root)).toEqual(customized);
});

test("create --auth uses the same provider artifacts as add auth", async () => {
  const added = await scaffold();
  expect(
    await runAddCli(
      ["auth", "google", "--cwd", added, "--origin", "https://app.example"],
      capture().io,
    ),
  ).toBe(0);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-provider-create-"));
  roots.push(root);
  const created = path.join(root, "app");
  const output = capture();
  expect(
    await runCreateCli(
      [
        "ssr",
        "provider-app",
        "--dir",
        created,
        "--auth",
        "google",
        "--origin",
        "https://app.example",
        "--no-install",
        "--no-skills",
      ],
      output.io,
    ),
  ).toBe(0);
  const addedFiles = await contents(added);
  const createdFiles = await contents(created);
  for (const [file, content] of Object.entries(addedFiles)) {
    if (file.startsWith("src/auth/") || file === ".askr/auth.json" || file === ".env.example") {
      expect(createdFiles[file]).toBe(content);
    }
  }
});

test.each(["full-stack", "spa", "startkit"])(
  "provider selection replaces authoritative demo wiring in %s",
  async (template) => {
    const root = await scaffold(template);
    const before = await contents(root);
    expect(
      await runAddCli(
        ["auth", "google", "--cwd", root, "--origin", "https://app.example"],
        capture().io,
      ),
    ).toBe(0);
    const files = await contents(root);
    expectParseable(files, before);
    const server = files[template === "full-stack" ? "src/server/app.ts" : "src/entry-server.tsx"];
    expect(server).toContain("auth: providerAuth()");
    expect(server).not.toContain("createAuth(");
    expect(server).not.toContain('"demo-session"');
    expect(files["src/auth/client.ts"]).toContain("createSessionAuth");
    expect(files["package.json"]).toContain("@askrjs/server");
    expect(files["package.json"]).toContain("vp build --ssr server.ts");
    if (template === "spa" || template === "startkit") {
      expect(files["src/main.tsx"]).toContain("if (root.hasChildNodes())");
      expect(files["src/main.tsx"]).toContain("await hydrateSPA({ root, registry: pageRegistry })");
      expect(files["src/main.tsx"]).toMatch(/const root = document\.getElementById\(['"]app['"]\)/);
      expect(files["index.html"]).toContain('id="app"><!--askr-app-->');
      expect(files["vite.config.ts"]).toContain("askrServer(");
    }
    if (template === "startkit") {
      expect(files["src/routes/auth-config.ts"]).toContain("sessionAuth");
      expect(files["src/routes/auth-config.ts"]).not.toContain("getSessionEmail");
      expect(files["src/pages/auth/login.tsx"]).not.toContain("signIn");
      expect(files["src/components/app-header.tsx"]).not.toContain("signOut");
      expect(files["src/lib/mock-data.ts"]).not.toContain("startkit:session");
      expect(files["src/lib/mock-data.ts"]).toContain("startkit:appearance");
    }
  },
);

test("refuses symlinked output ownership without touching the outside target", async () => {
  const root = await scaffold();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "askr-provider-outside-"));
  roots.push(outside);
  await fs.writeFile(path.join(outside, "sentinel"), "preserve outside bytes");
  await fs.symlink(
    outside,
    path.join(root, "src/auth"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const output = capture();
  expect(
    await runAddCli(
      ["auth", "google", "--cwd", root, "--origin", "https://app.example"],
      output.io,
    ),
  ).toBe(1);
  expect(output.errors.join("\n")).toMatch(/symbolic|symlink|owned/i);
  expect(await fs.readdir(outside)).toEqual(["sentinel"]);
  expect(await fs.readFile(path.join(outside, "sentinel"), "utf8")).toBe("preserve outside bytes");
});

test.each(["ssr", "full-stack", "spa", "startkit"])(
  "generated %s provider launcher preserves the canonical origin and built assets",
  async (template) => {
    const root = await scaffold(template);
    expect(
      await runAddCli(
        ["auth", "google", "--cwd", root, "--origin", "https://app.example:8443"],
        capture().io,
      ),
    ).toBe(0);
    const files = await contents(root);
    const config = JSON.parse(files["tsconfig.json"]);
    expect(config.compilerOptions.types).toContain("node");
    expect(config.compilerOptions.types.filter((name: string) => name === "node")).toHaveLength(1);

    // Execute the generated launcher from its production build location. Only
    // the external transport and Vite virtual app are replaced by fixture modules.
    const output = path.join(root, "dist", "server");
    await fs.mkdir(output, { recursive: true });
    const privatePaths = [
      "/server",
      "/server/server.js",
      "/.vite/manifest.json",
      "/SERVER/secret.js",
      "/assets/../server/secret.js",
      "\\server\\secret.js",
    ];
    const publicPaths = [
      "/assets/main.js",
      "/favicon.svg",
      "/server-status",
      "/.vite-public/logo.svg",
    ];
    await fs.writeFile(
      path.join(output, "transport.mjs"),
      `import { writeFile } from "node:fs/promises";
export async function serve(app, options) {
  await writeFile(new URL("./result.json", import.meta.url), JSON.stringify({
    baseUrl: options.baseUrl,
    allowedHosts: options.allowedHosts,
    assetsRoot: options.assets.root,
    exclusions: Object.fromEntries(${JSON.stringify([...privatePaths, ...publicPaths])}.map(pathname => [pathname, options.assets.exclude?.(pathname)])),
  }));
  return { url: "http://127.0.0.1" };
}`,
    );
    await fs.writeFile(path.join(output, "app.mjs"), "export default {};\n");
    const transpile = (source: string) =>
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
    await fs.writeFile(path.join(output, "env.mjs"), transpile(files["src/auth/env.ts"]));
    const source = files["server.ts"]
      .replace(/(["'])@askrjs\/node\1/, '"./transport.mjs"')
      .replace(/(["'])virtual:askr-server\1/, '"./app.mjs"')
      .replace('"./src/auth/env"', '"./env.mjs"');
    await fs.writeFile(path.join(output, "server.mjs"), transpile(source));
    await execFileAsync(process.execPath, [path.join(output, "server.mjs")], {
      env: { ...process.env, APP_ORIGIN: "https://app.example:8443", PORT: "0" },
    });
    const options = JSON.parse(await fs.readFile(path.join(output, "result.json"), "utf8"));
    expect(options.baseUrl).toBe("https://app.example:8443");
    expect(options.allowedHosts).toEqual(["app.example:8443"]);
    expect(await fs.realpath(options.assetsRoot)).toBe(await fs.realpath(path.join(root, "dist")));
    for (const pathname of privatePaths) {
      expect(options.exclusions[pathname], pathname).toBe(true);
    }
    for (const pathname of publicPaths) {
      expect(options.exclusions[pathname], pathname).toBe(false);
    }
  },
);
