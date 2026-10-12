import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { afterAll, beforeAll, test } from "vite-plus/test";
import {
  loadFinalAdmission,
  validateRanges,
  verifyInstalled,
  digest,
  ownedEnvironment,
  inventoryGeneratedSource as inventory,
  installFreshFinal,
  finalNpmListing,
} from "../helpers/final-provider-graph";
import { runOwnedCommand, startOwnedCommand } from "../helpers/owned-command";
import {
  bounded,
  Cookies,
  providers,
  signedStarterProvider,
  relayBrowserRequest,
  type Provider,
  type Reply,
} from "../helpers/signed-starter-provider";
import { withOwnedBrowser } from "../helpers/owned-browser";

const starters = ["ssr", "spa", "startkit", "full-stack"] as const;
const cells = providers.flatMap((provider) => starters.map((starter) => ({ provider, starter })));
let graph: Awaited<ReturnType<typeof loadFinalAdmission>>,
  root: string,
  evidence: string,
  launcher: string,
  cli: string;
let phase: "native" | "all",
  serial = 0,
  completed = 0,
  browserCells = 0;
let baseEnv: Record<string, string>;
const protectedPath = (starter: string) =>
  starter === "spa" ? "/app" : starter === "startkit" ? "/dashboard" : "/";
async function floor(directory: string) {
  const info = await fs.statfs(directory);
  assert(
    info.bavail * info.bsize >= 8 * 1024 ** 3,
    "Final16 requires the unchanged 8GiB free floor before each phase",
  );
}
async function save(name: string, value: unknown, directory = evidence) {
  await fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}
async function command(
  command: string,
  args: string[],
  cwd: string,
  directory: string,
  signal?: AbortSignal,
  extra: NodeJS.ProcessEnv = {},
) {
  await floor(root);
  const label = `phase-${++serial}`;
  return runOwnedCommand({
    command,
    args,
    cwd,
    evidence: directory,
    label,
    timeoutMs: 120000,
    signal,
    env: { ...baseEnv, ...extra },
  });
}
const npm = (
  args: string[],
  cwd: string,
  directory: string,
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
) =>
  command(process.execPath, [graph.input.tools.npmCli.file, ...args], cwd, directory, signal, env);

beforeAll(async () => {
  assert.equal(process.version, "v24.21.0");
  assert(
    ["native", "all"].includes(process.env.ASKR_PROVIDER_PHASE ?? ""),
    "Explicit native/all phase required; no silent final16 skip",
  );
  phase = process.env.ASKR_PROVIDER_PHASE as typeof phase;
  if (phase === "all")
    assert.equal(process.platform, "linux", "Three browser engines are scoped to Linux");
  graph = await loadFinalAdmission(
    process.env.ASKR_FINAL18_ADMISSION,
    process.env.ASKR_FINAL18_ADMISSION_SHA256,
  );
  assert.equal(graph.input.platform, process.platform);
  assert.equal(graph.input.phase, phase);
  const require = createRequire(import.meta.url);
  assert.equal(
    await fs.realpath(require.resolve("playwright/package.json")),
    await fs.realpath(graph.input.tools.playwright.packageJson.file),
  );
  assert.equal(
    JSON.parse(await fs.readFile(graph.input.tools.playwright.packageJson.file, "utf8")).version,
    graph.input.tools.playwright.version,
  );
  assert.equal(
    await fs.realpath(process.env.npm_execpath!),
    await fs.realpath(graph.input.tools.npmCli.file),
    "The existing caller must actually run the admitted npm CLI",
  );
  evidence = process.env.ASKR_PROVIDER_EVIDENCE!;
  assert(evidence && path.isAbsolute(evidence));
  await fs.mkdir(evidence, { recursive: false });
  root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-final16-"));
  await floor(root);
  baseEnv = ownedEnvironment(
    process.env,
    process.platform,
    root,
    process.execPath,
    graph.input.tools.openssl.executable.file,
  );
  for (const name of [
    "HOME",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (baseEnv[name]) await fs.mkdir(baseEnv[name]!, { recursive: true });
  await fs.writeFile(
    baseEnv.OPENSSL_CONF!,
    "[req]\ndistinguished_name=owned_dn\nprompt=no\n[owned_dn]\nCN=Owned starter protocol fixture\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(root, "owned.npmrc"),
    `registry=https://registry.npmjs.org/\n@askrjs:registry=${graph.input.registry.url}\nignore-scripts=false\n`,
    { flag: "wx" },
  );
  await fs.writeFile(path.join(root, "empty.npmrc"), "", { flag: "wx" });
  launcher = path.join(root, "launcher");
  await fs.mkdir(launcher);
  await fs.writeFile(
    path.join(launcher, "package.json"),
    JSON.stringify({
      name: "owned-final16-launcher",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: { "@askrjs/cli": "0.5.0" },
    }),
    { flag: "wx" },
  );
  assert.equal((await npm(["--version"], launcher, evidence)).trim(), graph.manifest.toolchain.npm);
  assert.equal(
    (await npm(["config", "get", "ignore-scripts"], launcher, evidence)).trim(),
    "false",
  );
  assert.equal(
    (
      await command(graph.input.tools.openssl.executable.file, ["version"], launcher, evidence)
    ).trim(),
    graph.input.tools.openssl.version,
  );
  const { initial } = await installFreshFinal(launcher, graph, (args, project) =>
    npm(args, project, evidence),
  );
  await finalNpmListing(launcher, evidence, graph, (args, cwd) => npm(args, cwd, evidence));
  cli = path.join(launcher, "node_modules", "@askrjs", "cli", "dist", "cli.js");
  await save("authority.json", {
    phase,
    platform: process.platform,
    node: process.version,
    manifestSha256: digest(graph.manifestRaw),
    admissionFile: process.env.ASKR_FINAL18_ADMISSION,
    admissionSha256: process.env.ASKR_FINAL18_ADMISSION_SHA256,
    launcher: initial.installed,
    root,
    ownedChildEnvironment: baseEnv,
    preliminary13: false,
  });
  // Existing SSG rejection/unit and five-default native owners remain unchanged and are separate required gates.
}, 600000);

async function nativeJourney(
  fixture: Awaited<ReturnType<typeof signedStarterProvider>>,
  provider: Provider,
  starter: string,
  corruption = "",
) {
  const jar = new Cookies(),
    returnTo = `${protectedPath(starter)}?fixture=canonical#retained`,
    origin = fixture.origin;
  if (corruption) fixture.corrupt(corruption);
  const login = await fixture.raw(
    `${origin}/auth/login/${provider}?returnTo=${encodeURIComponent(returnTo)}`,
  );
  assert.equal(login.status, 303);
  jar.accept(login);
  const copiedCookie = jar.header();
  assert(copiedCookie);
  const authorize = await fixture.raw(String(login.headers.location));
  let target: string, body: string | undefined;
  if (provider === "apple") {
    assert.equal(authorize.status, 200);
    const text = authorize.body.toString();
    target = /action="([^"]+)"/u.exec(text)![1]!;
    body = new URLSearchParams(
      [...text.matchAll(/name="([^"]+)" value="([^"]*)"/gu)].map((row) => [
        row[1]!,
        row[2]!.replaceAll("&amp;", "&"),
      ]),
    ).toString();
  } else {
    assert.equal(authorize.status, 303);
    target = String(authorize.headers.location);
  }
  const count = fixture.exchanges;
  const callback = await fixture.raw(target, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: jar.header(provider === "apple"),
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  jar.accept(callback);
  if (corruption) {
    assert.equal(callback.status, 400, `Signed ${corruption} must be rejected`);
    if (["state", "denial"].includes(corruption))
      assert.equal(fixture.exchanges, count, "Invalid transaction must not exchange");
    const anonymous = JSON.parse(
      (
        await fixture.raw(`${origin}/auth/session`, { headers: { cookie: jar.header() } })
      ).body.toString(),
    );
    assert.equal(anonymous.authenticated, false);
    return;
  }
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, new URL(returnTo, origin).href);
  const replay = await fixture.raw(target, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: copiedCookie,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  assert.equal(replay.status, 400);
  assert.equal(fixture.exchanges, count + 1);
  const session = await fixture.raw(`${origin}/auth/session`, {
    headers: { cookie: jar.header() },
  });
  assert.equal(session.status, 200);
  assert.match(String(session.headers["cache-control"]), /no-store/u);
  const snapshot = JSON.parse(session.body.toString());
  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.principal.subject, "fixture-account");
  for (const forbidden of ["tokens", "accessToken", "refreshToken", "idToken", "session"])
    assert(!Object.hasOwn(snapshot, forbidden));
  const page = await fixture.raw(origin + protectedPath(starter), {
    headers: { cookie: jar.header() },
  });
  assert.equal(page.status, 200);
  for (const secret of [
    ...fixture.issuedTokens,
    ...[
      "STARTER_CLIENT_PRIVATE_CANARY",
      "STARTER_ACCESS_PRIVATE_CANARY",
      "STARTER_REFRESH_PRIVATE_CANARY",
    ],
    fixture.env.AUTH_SESSION_SECRET!,
  ]) {
    assert(!session.body.includes(secret));
    assert(!page.body.includes(secret));
  }
  const crossSite = await fixture.raw(`${origin}/auth/logout`, {
    method: "POST",
    headers: {
      cookie: jar.header(),
      origin: "https://foreign.example.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ provider }),
  });
  assert.equal(crossSite.status, 403);
  const logout = await fixture.raw(`${origin}/auth/logout`, {
    method: "POST",
    headers: { cookie: jar.header(), origin, "content-type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  assert.equal(logout.status, 200);
  jar.accept(logout);
  assert.equal(
    JSON.parse(
      (
        await fixture.raw(`${origin}/auth/session`, { headers: { cookie: jar.header() } })
      ).body.toString(),
    ).authenticated,
    false,
  );
  return { page, session };
}
test.each(cells)(
  "final18 $provider/$starter installed generated server",
  async ({ provider, starter }) => {
    const id = `${provider}-${starter}`,
      out = path.join(evidence, id);
    await fs.mkdir(out, { recursive: false });
    const directory = path.join(root, id);
    await fs.mkdir(directory);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 600000);
    let preview: ReturnType<typeof startOwnedCommand> | undefined,
      fixture: Awaited<ReturnType<typeof signedStarterProvider>> | undefined;
    let passed = false;
    let finalResult: Record<string, unknown> | undefined;
    try {
      fixture = await signedStarterProvider(
        provider,
        directory,
        out,
        controller.signal,
        graph.input.tools.openssl.executable.file,
        baseEnv,
      );
      let project = path.join(directory, "generated");
      await command(
        process.execPath,
        [
          cli,
          "create",
          starter,
          `final-${id}`,
          "--dir",
          project,
          "--auth",
          provider,
          "--origin",
          fixture.origin,
          "--no-install",
          "--no-skills",
        ],
        root,
        out,
        controller.signal,
      );
      const manifestRaw = await fs.readFile(path.join(project, "package.json"));
      validateRanges(JSON.parse(manifestRaw.toString()));
      const emitted = await inventory(project);
      await fs.cp(project, path.join(out, "emitted-product"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await save(
        "emission.json",
        { manifestSha256: digest(manifestRaw), files: emitted, resolutionProjection: false },
        out,
      );
      const { initial: installed, fresh } = await installFreshFinal(project, graph, (args, cwd) =>
        npm(args, cwd, out, controller.signal),
      );
      await fs.writeFile(path.join(out, "package-lock.json"), fresh.lockRaw, { flag: "wx" });
      await finalNpmListing(project, out, graph, (args, cwd) =>
        npm(args, cwd, out, controller.signal),
      );
      await npm(["audit", "--json"], project, out, controller.signal);
      await npm(["audit", "--omit=dev", "--json"], project, out, controller.signal);
      await npm(["run", "check"], project, out, controller.signal, fixture.env);
      for (const tool of [graph.input.tools.typescript6, graph.input.tools.typescript7]) {
        assert.equal(
          JSON.parse((await fs.readFile(tool.packageJson.file)).toString()).version,
          tool.version,
        );
        for (const jsx of ["react-jsx", "react-jsxdev"]) {
          await fs.writeFile(
            path.join(project, ".provider-types.json"),
            JSON.stringify({
              extends: "./tsconfig.json",
              compilerOptions: {
                strict: true,
                noEmit: true,
                composite: false,
                jsx,
                jsxImportSource: "@askrjs/askr",
                types: ["node", "vite/client"],
              },
              include: ["src", "server.ts", "vite.config.ts"],
              references: [],
            }),
          );
          await command(
            process.execPath,
            [tool.cli.file, "-p", ".provider-types.json", "--pretty", "false"],
            project,
            out,
            controller.signal,
          );
        }
      }
      await fs.rm(path.join(project, ".provider-types.json"));
      await npm(["run", "build"], project, out, controller.signal, fixture.env);
      assert((await fs.readFile(path.join(project, "package.json"))).equals(manifestRaw));
      assert.deepEqual(await inventory(project), emitted);
      const launchDirectory = path.join(directory, "unrelated cwd #100% ü");
      await fs.mkdir(launchDirectory);
      const runtimeProject = path.join(directory, "generated path #100% ü");
      await fs.rename(project, runtimeProject);
      project = runtimeProject;
      const entry = path.join(project, "dist", "server", "server.js");
      await floor(root);
      preview = startOwnedCommand({
        command: process.execPath,
        args: ["--import", pathToFileURL(fixture.transport).href, entry],
        cwd: launchDirectory,
        evidence: out,
        label: "compiled-preview",
        timeoutMs: 300000,
        signal: controller.signal,
        env: { ...baseEnv, ...fixture.env },
      });
      const until = performance.now() + 20000;
      let ready = false;
      while (performance.now() < until) {
        try {
          const response = await fixture.raw(`${fixture.origin}/auth/session`);
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Retry only initial owned readiness, never qualify a failed control. */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert(ready, "Compiled generated provider server readiness");
      const result = await nativeJourney(fixture, provider, starter);
      assert(result);
      for (const corruption of ["state", "nonce", "signature", "denial"])
        await nativeJourney(fixture, provider, starter, corruption);
      const viteManifest = JSON.parse(
        await fs.readFile(path.join(project, "dist", ".vite", "manifest.json"), "utf8"),
      ) as Record<string, { file: string; css?: string[] }>;
      const assets = [
        ...new Set(Object.values(viteManifest).flatMap((row) => [row.file, ...(row.css ?? [])])),
      ];
      assert(assets.some((file) => file.endsWith(".js")));
      for (const asset of assets) {
        assert(/^assets\/[A-Za-z0-9_.\/-]+$/u.test(asset) && !asset.split("/").includes(".."));
        const bytes = await fs.readFile(path.join(project, "dist", asset)),
          response: Reply = await fixture.raw(`${fixture.origin}/${asset}`);
        assert.equal(response.status, 200);
        assert(response.body.equals(bytes));
        assert.equal(
          (await fixture.raw(`${fixture.origin}/${asset}`, { method: "HEAD" })).status,
          200,
        );
        for (const canary of ["STARTER_CLIENT_PRIVATE_CANARY", "STARTER_SESSION_PRIVATE_CANARY"])
          assert(!bytes.includes(canary));
      }
      for (const target of [
        "/server/server.js",
        "/SERVER/server.js",
        "/%73erver/server.js",
        "/.vite/manifest.json",
        "/%2evite/manifest.json",
      ])
        for (const method of ["GET", "HEAD"]) {
          const response: Reply = await fixture.raw(fixture.origin + target, { method });
          assert.equal(response.status, 404);
          assert(!response.body.includes(await fs.readFile(entry)));
        }
      if (phase === "all")
        for (const engine of ["chromium", "firefox", "webkit"] as const) {
          await withOwnedBrowser(engine, graph.input, out, baseEnv, async (browser) => {
            const context = await browser.newContext({ serviceWorkers: "block" });
            const unexpected: string[] = [];
            try {
              await context.route("**/*", async (route) => {
                try {
                  const request = route.request(),
                    target = new URL(request.url());
                  if (
                    target.origin === fixture!.origin &&
                    target.pathname === `/auth/login/${provider}`
                  )
                    assert.equal(
                      target.searchParams.get("returnTo"),
                      protectedPath(starter),
                      "Generated login page must forward its real next target",
                    );
                  const response = await relayBrowserRequest(request, fixture!.raw);
                  if (
                    target.origin === fixture!.origin &&
                    target.pathname === `/auth/callback/${provider}`
                  )
                    assert.equal(
                      response.headers.location,
                      new URL(protectedPath(starter), fixture!.origin).href,
                      "Actual browser callback must retain the generated next target",
                    );
                  const headers = Object.fromEntries(
                    Object.entries(response.headers)
                      .filter(
                        ([name]) =>
                          !["connection", "transfer-encoding", "content-length"].includes(name),
                      )
                      .map(([name, value]) => [
                        name,
                        Array.isArray(value) ? value.join("\n") : String(value),
                      ]),
                  );
                  await route.fulfill({ status: response.status, headers, body: response.body });
                } catch (error) {
                  unexpected.push(String(error));
                  await route.abort();
                }
              });
              const page = await context.newPage();
              const pageErrors: string[] = [];
              page.on("pageerror", (error) => pageErrors.push(String(error)));
              page.setDefaultTimeout(10000);
              page.setDefaultNavigationTimeout(10000);
              await page.goto(
                `${fixture!.origin}/login?next=${encodeURIComponent(protectedPath(starter))}`,
              );
              await page
                .getByRole("link", {
                  name: `Continue with ${provider === "auth0" ? "Auth0" : provider === "microsoft" ? "Microsoft" : provider === "google" ? "Google" : "Apple"}`,
                })
                .click();
              if (provider === "apple") await page.locator("#continue").click();
              await page.waitForURL(
                (url) => url.origin === fixture!.origin && url.pathname === protectedPath(starter),
              );
              const snapshot = await page.evaluate(async () =>
                (await fetch("/auth/session")).json(),
              );
              assert(
                snapshot !== null && typeof snapshot === "object" && "authenticated" in snapshot,
              );
              assert.equal(snapshot.authenticated, true);
              assert(
                "principal" in snapshot &&
                  snapshot.principal !== null &&
                  typeof snapshot.principal === "object" &&
                  "subject" in snapshot.principal,
              );
              assert.equal(snapshot.principal.subject, "fixture-account");
              const content = await page.content();
              for (const secret of [
                ...fixture!.issuedTokens,
                ...[
                  "STARTER_CLIENT_PRIVATE_CANARY",
                  "STARTER_ACCESS_PRIVATE_CANARY",
                  "STARTER_REFRESH_PRIVATE_CANARY",
                ],
                fixture!.env.AUTH_SESSION_SECRET!,
              ]) {
                assert(!content.includes(secret));
                assert(!JSON.stringify(snapshot).includes(secret));
              }
              if (starter === "startkit") {
                await page.locator(".header-account-trigger").click();
                await page.getByRole("menuitem", { name: "Sign out" }).click();
              } else if (starter !== "ssr")
                await page.getByRole("button", { name: "Sign out" }).click();
              else
                await page.evaluate(async () => {
                  const result = await fetch("/auth/logout", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: "{}",
                  });
                  if (!result.ok) throw new Error("Native SSR logout failed");
                });
              if (starter !== "ssr")
                await page.waitForURL(
                  (url) => url.origin === fixture!.origin && url.pathname === "/login",
                );
              const loggedOut = await page.evaluate(async () =>
                (await fetch("/auth/session")).json(),
              );
              assert(
                loggedOut !== null && typeof loggedOut === "object" && "authenticated" in loggedOut,
              );
              assert.equal(loggedOut.authenticated, false);
              assert.deepEqual(unexpected, []);
              assert.deepEqual(pageErrors, []);
              browserCells++;
            } finally {
              await bounded(context.close(), "browser context close");
            }
          });
        }
      assert((await verifyInstalled(project, graph)).lockRaw.equals(fresh.lockRaw));
      assert.deepEqual(await inventory(project), emitted);
      finalResult = {
        status: "PASS",
        provider,
        starter,
        native: true,
        browserEngines: phase === "all" ? 3 : 0,
        installed: fresh.installed,
        emittedManifestSha256: digest(manifestRaw),
        installedLockSha256: digest(fresh.lockRaw),
        sourceUnchanged: true,
      };
      passed = true;
    } finally {
      clearTimeout(timer);
      const errors: unknown[] = [];
      if (preview) {
        try {
          const receipt = await preview.stop();
          assert(
            receipt.childClosed && receipt.cleanup.treeReaped && !receipt.failure,
            "Compiled server tree closure",
          );
        } catch (error) {
          errors.push(error);
        }
      }
      if (fixture) {
        try {
          await fixture.close();
        } catch (error) {
          errors.push(error);
        }
      }
      passed = passed && errors.length === 0;
      await save(
        "cleanup.json",
        { passed, errors: errors.map(String), directory, retained: true },
        out,
      );
      if (errors.length) throw new AggregateError(errors, "Final16 cleanup failed");
    }
    assert(passed && finalResult);
    await save("result.json", finalResult, out);
    completed++;
  },
  720000,
);
afterAll(async () => {
  if (!evidence) return;
  await save("summary.json", {
    completed,
    expectedNativeCells: 16,
    browserCells,
    expectedBrowserCells: phase === "all" ? 48 : 0,
    platform: process.platform,
    phase,
    final18ManifestSha256: graph ? digest(graph.manifestRaw) : null,
    root,
    qualified: completed === 16 && (phase !== "all" || browserCells === 48),
  });
  assert.equal(completed, 16);
  assert.equal(browserCells, phase === "all" ? 48 : 0);
});
