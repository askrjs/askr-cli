import { createHash } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { execFile, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { runOwnedCommand, startOwnedCommand } from "../helpers/owned-command";

import {
  bindPreliminaryManifest,
  inspectKnownViteDiagnostic,
  inspectKnownViteOriginDiagnostic,
  readHostingRequest,
  verifyEmittedSource,
  verifyPreliminaryGraph,
} from "../helpers/preliminary-archives";

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const allTemplates = ["full-stack", "spa", "ssr", "ssg", "startkit"];

async function run(command: string, args: string[], cwd: string): Promise<string> {
  try {
    const npmCli =
      command === "npm" && process.platform === "win32" ? process.env.npm_execpath : undefined;
    if (
      command === "npm" &&
      process.platform === "win32" &&
      (!npmCli || !path.isAbsolute(npmCli))
    ) {
      throw new Error(
        "Run the template integration through npm so its absolute npm CLI is available on Windows.",
      );
    }
    const { stdout } = await execFileAsync(
      npmCli ? process.execPath : command,
      npmCli ? [npmCli, ...args] : args,
      {
        cwd,
        env: { ...process.env, NO_COLOR: "1" },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return stdout;
  } catch (cause) {
    // execFile only reports "Command failed: <cmd>", which hides which template
    // check broke and why. Surface the child output with the failure.
    const { stdout, stderr } = cause as { stdout?: string; stderr?: string };
    throw new Error(
      [
        `${command} ${args.join(" ")} failed in ${cwd}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { cause },
    );
  }
}

async function checkBuiltHosting(project: string, launchDirectory: string): Promise<void> {
  const publicFixtures = new Map([
    ["hosting-public.txt", Buffer.from("Public hosting fixture\n")],
    ["hosting-public.css", Buffer.from(".hosting-fixture { color: rgb(1, 2, 3); }\n")],
  ]);
  await fs.mkdir(path.join(project, "public"), { recursive: true });
  for (const [relative, bytes] of publicFixtures) {
    await fs.writeFile(path.join(project, "public", relative), bytes, { flag: "wx" });
  }
  await run("npm", ["run", "build"], project);
  const hostingDirectory = path.join(launchDirectory, "hosting path #100% ü");
  await fs.mkdir(hostingDirectory);
  const previewProject = path.join(hostingDirectory, path.basename(project));
  await fs.rename(project, previewProject);
  const projectManifest = JSON.parse(
    await fs.readFile(path.join(previewProject, "package.json"), "utf8"),
  );
  expect(projectManifest.scripts.preview).toBe("node dist/server/server.js");
  const dist = path.join(previewProject, "dist");
  const entry = path.join(dist, "server", "server.js");
  await fs.access(entry);
  const manifest = JSON.parse(
    await fs.readFile(path.join(dist, ".vite", "manifest.json"), "utf8"),
  ) as Record<string, { file: string; isEntry?: boolean; css?: string[] }>;
  const entries = Object.values(manifest).filter((value) => value.isEntry);
  expect(entries.length).toBeGreaterThan(0);
  const files = [...new Set(entries.flatMap((value) => [value.file, ...(value.css ?? [])]))];
  const expected = new Map<string, Buffer>();
  for (const relative of files) {
    expect(relative).toMatch(/^assets\/[A-Za-z0-9_.\/-]+$/);
    expect(relative.split("/")).not.toContain("..");
    expected.set(relative, await fs.readFile(path.join(dist, relative)));
  }

  for (const [relative, bytes] of publicFixtures) {
    expect(await fs.readFile(path.join(dist, relative)), relative).toEqual(bytes);
    expected.set(relative, bytes);
  }

  const portOwner = createServer();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      portOwner.close(() => undefined);
      reject(new Error("Owned port allocation timed out"));
    }, 2000);
    const failed = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    portOwner.once("error", failed);
    portOwner.listen(0, "127.0.0.1", () => {
      clearTimeout(timer);
      portOwner.off("error", failed);
      resolve();
    });
  });
  const address = portOwner.address();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Owned port release timed out")), 2000);
    portOwner.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
  if (!address || typeof address === "string") throw new Error("Expected an owned TCP port");
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: launchDirectory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      CSRF_SECRET: "packed-preview-fixture-CSRF-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let transcript = "";
  let ended = false;
  child.stdout.on("data", (chunk: Buffer) => {
    transcript = (transcript + chunk.toString()).slice(-65536);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    transcript = (transcript + chunk.toString()).slice(-65536);
  });
  const closed = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      transcript += error.message;
      ended = true;
      resolve();
    });
    child.once("close", (code, signal) => {
      transcript += `\nexit=${code} signal=${signal}`;
      ended = true;
      resolve();
    });
  });
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const observeExit = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    const deadline = Date.now() + 20_000;
    let html: string | undefined;
    while (Date.now() < deadline) {
      if (ended) throw new Error(`Built server exited before serving HTML:\n${transcript}`);
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
        });
        if (
          response.status === 200 &&
          response.headers.get("content-type")?.includes("text/html")
        ) {
          html = await response.text();
          break;
        }
        await response.body?.cancel();
      } catch {
        // Startup can briefly refuse connections; child exit and the absolute deadline remain failures.
      }
      await pause(25);
    }
    expect(html, `Built server did not serve HTML:\n${transcript}`).toBeDefined();
    expect(ended, transcript).toBe(false);
    for (const value of entries) expect(html).toContain(`/${value.file}`);
    const privatePaths = [
      ["/server/server.js", 404],
      ["/SERVER/server.js", 404],
      ["/%73erver/server.js", 404],
      ["//server/server.js", 400],
      ["/assets%5C..%5Cserver%5Cserver.js", 404],
      ["/.vite/manifest.json", 404],
      ["/.VITE/manifest.json", 404],
      ["/%2evite/manifest.json", 404],
      ["//.vite/manifest.json", 400],
      ["/assets%5C..%5C.vite%5Cmanifest.json", 404],
    ] as const;
    for (const [pathname, expectedStatus] of privatePaths) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${origin}${pathname}`, {
          method,
          signal: AbortSignal.timeout(2000),
        });
        expect(response.status, `${method} ${pathname}`).toBe(expectedStatus);
        const body = Buffer.from(await response.arrayBuffer());
        if (method === "HEAD") expect(body.byteLength).toBe(0);
        else
          expect(body).not.toEqual(
            await fs.readFile(
              path.join(
                dist,
                pathname.toLowerCase().includes("vite")
                  ? ".vite/manifest.json"
                  : "server/server.js",
              ),
            ),
          );
      }
    }
    for (const [relative, bytes] of expected) {
      const response = await fetch(`${origin}/${relative}`, { signal: AbortSignal.timeout(2000) });
      expect(response.status, relative).toBe(200);
      expect(response.headers.get("content-type"), relative).toMatch(
        relative.endsWith(".css")
          ? /text\/css/
          : relative.endsWith(".txt")
            ? /text\/plain/
            : /javascript/,
      );
      expect(Buffer.from(await response.arrayBuffer()), relative).toEqual(bytes);
      const head = await fetch(`${origin}/${relative}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(2000),
      });
      expect(head.status, relative).toBe(200);
      expect(head.headers.get("content-length"), relative).toBe(String(bytes.length));
      expect((await head.arrayBuffer()).byteLength, relative).toBe(0);
    }
  } finally {
    if (!ended) child.kill("SIGTERM");
    const stopped = await observeExit();
    if (!stopped) {
      child.kill("SIGKILL");
      await observeExit();
      throw new Error(`Built server did not exit after SIGTERM:\n${transcript}`);
    }
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const timer = setTimeout(() => finish(new Error("TCP shutdown observation timed out")), 1000);
      function finish(error?: Error) {
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      }
      socket.once("connect", () => finish(new Error("Built server port remains reachable")));
      socket.once("error", (error: NodeJS.ErrnoException) =>
        finish(error.code === "ECONNREFUSED" ? undefined : error),
      );
    });
  }
}

async function checkScopedSsgJsx(project: string): Promise<void> {
  await fs.copyFile(
    path.join(repository, "tests", "types", "ssg-scoped-jsx.tsx"),
    path.join(project, "src", "scoped-jsx-contract.tsx"),
  );
  await fs.writeFile(
    path.join(project, "tsconfig.scoped-jsx.json"),
    `${JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { skipLibCheck: false },
        include: ["src/scoped-jsx-contract.tsx", "src/**/*.d.ts"],
        references: [],
      },
      null,
      2,
    )}\n`,
  );
  const projectRequire = createRequire(path.join(project, "package.json"));
  const cliManifest = projectRequire.resolve("@askrjs/cli/package.json");
  // The generated app owns TS7; the installed CLI owns its TS6 parser/compiler.
  const compilers = [
    { major: 6, require: createRequire(cliManifest) },
    { major: 7, require: projectRequire },
  ];
  for (const compiler of compilers) {
    const manifestPath = compiler.require.resolve("typescript/package.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      bin: Record<string, string>;
    };
    const bin = manifest.bin[compiler.major === 6 ? "tsc6" : "tsc"];
    expect(bin).toBeTypeOf("string");
    const entry = path.resolve(path.dirname(manifestPath), bin!);
    const version = await run(process.execPath, [entry, "--version"], project);
    expect(version).toMatch(new RegExp(`^Version ${compiler.major}\\.`));
    for (const jsx of ["react-jsx", "react-jsxdev"]) {
      await run(
        process.execPath,
        [entry, "--project", "tsconfig.scoped-jsx.json", "--jsx", jsx, "--pretty", "false"],
        project,
      );
    }
  }
}

test("should ensure packed CLI passes checks for every shipped template", async () => {
  const selected = process.env.ASKR_TEMPLATE
    ? allTemplates.filter((template) => template === process.env.ASKR_TEMPLATE)
    : allTemplates;
  expect(selected, `Unknown ASKR_TEMPLATE: ${process.env.ASKR_TEMPLATE}`).not.toHaveLength(0);

  const input = await readHostingRequest(
    process.env.ASKR_PACKED_TEMPLATE_REQUEST!,
    process.env.ASKR_PACKED_TEMPLATE_REQUEST_SHA256!,
  );
  const evidenceRoot = process.env.ASKR_PACKED_TEMPLATE_EVIDENCE;
  expect(
    evidenceRoot && path.isAbsolute(evidenceRoot),
    "Owned durable preliminary hosting evidence required",
  ).toBe(true);
  expect(process.versions.node).toBe(input.closure.toolchain.node);
  expect((await run("npm", ["--version"], repository)).trim()).toBe(input.closure.toolchain.npm);
  await fs.mkdir(evidenceRoot!);
  await fs.writeFile(path.join(evidenceRoot!, "request.json"), input.raw);
  await fs.copyFile(input.request.closure.file, path.join(evidenceRoot!, "closure.json"));
  let completed = false;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-packed-templates-"));
  try {
    await run("npm", ["run", "build"], repository);
    const packed = await run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", root],
      repository,
    );
    const archive = path.join(root, packed.trim().split(/\r?\n/).at(-1)!);

    for (const template of selected) {
      const fixtureRoot = path.join(root, template);
      const project = path.join(fixtureRoot, `fixture-${template}`);
      await fs.mkdir(fixtureRoot, { recursive: true });
      await run(
        process.execPath,
        [
          path.join(repository, "dist", "cli.js"),
          "create",
          template,
          `fixture-${template}`,
          "--dir",
          project,
          "--no-install",
          "--no-skills",
        ],
        fixtureRoot,
      );

      const emitted = path.join(fixtureRoot, `emitted-${template}`);
      // Retain the untouched generated product and ranges before any fixture projection.
      await fs.rename(project, emitted);
      await fs.cp(emitted, project, { recursive: true, errorOnExist: true, force: false });
      const evidence = path.join(evidenceRoot!, template);
      await fs.mkdir(evidence);
      await fs.cp(emitted, path.join(evidence, "emitted"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const manifestPath = path.join(project, "package.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
        devDependencies?: Record<string, string>;
      };
      manifest.devDependencies = {
        ...manifest.devDependencies,
        "@askrjs/cli": `file:${archive}`,
      };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      // The preceding archive remains the original diagnostic pack. Only independently
      // admitted scripts-active archives supply this test-owned physical closure.
      await bindPreliminaryManifest(project, input.closure.packages);
      const workingManifest = await fs.readFile(manifestPath);
      await fs.writeFile(path.join(evidence, "working-package.json"), workingManifest);
      await run("npm", ["install", "--no-audit", "--no-fund"], project);
      await verifyPreliminaryGraph(project, input.closure.packages);
      const lock = await fs.readFile(path.join(project, "package-lock.json"));
      await fs.writeFile(path.join(evidence, "working-package-lock.json"), lock);
      await run("npm", ["ci", "--no-audit", "--no-fund"], project);
      expect(await fs.readFile(manifestPath)).toEqual(workingManifest);
      expect(await fs.readFile(path.join(project, "package-lock.json"))).toEqual(lock);
      await verifyPreliminaryGraph(project, input.closure.packages);
      try {
        await run("npm", ["ls", "--all"], project);
      } catch (error) {
        // Vite66's primary recipe has this one upstream optional alias peer.
        // Preserve both listings and admit only its exact lock/physical owner.
        await inspectKnownViteDiagnostic(project, evidence, error, run);
      }
      await run("npm", ["run", "check"], project);
      await verifyEmittedSource(project, emitted);
      await fs.writeFile(
        path.join(evidence, "physical-closure.json"),
        `${JSON.stringify(
          {
            stage: input.request.stage,
            cliArchiveSha512: input.closure.packages.find((value) => value.name === "@askrjs/cli")!
              .archiveSha512,
            diagnosticArchive: archive,
            manifestSha256: createHash("sha256").update(workingManifest).digest("hex"),
            lockSha256: createHash("sha256").update(lock).digest("hex"),
            normalInstallAndFreshCi: true,
            allDepthArchiveBytesVerified: true,
            originalRangeResolutionQualified: false,
            finalGraphAccepted: false,
          },
          null,
          2,
        )}\n`,
      );

      if (template === "ssr" || template === "full-stack") {
        await checkBuiltHosting(project, fixtureRoot);
      }

      if (template === "ssg") {
        await checkScopedSsgJsx(project);
        for (const relative of ["sitemap.xml", "robots.txt", ".askr/sitemap-manifest.json"]) {
          await fs.access(path.join(project, "dist", relative));
        }
      }
    }
    completed = true;
  } finally {
    if (completed) await fs.rm(root, { recursive: true, force: true });
    else
      await fs.writeFile(
        path.join(evidenceRoot!, "retained-failed-fixture.json"),
        `${JSON.stringify({ root, stage: input.request.stage, cleanupAcceptance: "Inspect original owned-preview exit/TCP observations; fixture directory retained", finalGraphAccepted: false })}\n`,
      );
  }
}, 180_000);

async function originListen(
  server: import("node:http").Server | import("node:https").Server,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Owned origin listener timed out")), 2000);
    const failed = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      clearTimeout(timer);
      server.off("error", failed);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Expected owned TCP listener"));
      else resolve(address.port);
    });
  });
}

async function originClose(
  server: import("node:http").Server | import("node:https").Server,
): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      reject(new Error("Owned origin listener did not close"));
    }, 5000);
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  });
}

async function originRequest(
  port: number,
  target: string,
  headers: Record<string, string>,
  ca?: Buffer,
): Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const transport = ca ? httpsRequest : httpRequest;
    const request = transport(
      {
        hostname: "127.0.0.1",
        port,
        path: target,
        method: "GET",
        agent: false,
        headers: { ...headers, connection: "close" },
        ...(ca ? { ca, servername: "app.example.test" } : {}),
      },
      (response) => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32768) request.destroy(new Error("Owned origin response exceeded body cap"));
          else chunks.push(chunk);
        });
        response.once("error", finish);
        response.once("end", () =>
          finish(undefined, {
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Owned origin request timed out")),
      2000,
    );
    function finish(
      error?: Error,
      result?: { status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer },
    ) {
      clearTimeout(timer);
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Missing owned origin response"));
    }
    request.once("error", finish);
    request.end();
  });
}

type OriginRun = (
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
) => Promise<string>;

async function checkProviderOrigin(
  project: string,
  directory: string,
  evidence: string,
  originRun: OriginRun,
  signal: AbortSignal,
): Promise<void> {
  const keyPath = path.join(directory, "origin.key");
  const certPath = path.join(directory, "origin.pem");
  await originRun(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      "/CN=Askr owned origin fixture",
      "-addext",
      "subjectAltName=DNS:app.example.test,DNS:oauth2.googleapis.com",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    directory,
    30_000,
  );
  const key = await fs.readFile(keyPath);
  const ca = await fs.readFile(certPath);
  const exchanges: URLSearchParams[] = [];
  const failures: string[] = [];
  const tokenServer = createHttpsServer({ key, cert: ca }, (request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) request.destroy(new Error("Owned token request exceeded body cap"));
      else chunks.push(chunk);
    });
    request.on("error", (error) => failures.push(error.message));
    request.on("end", () => {
      if (
        request.method !== "POST" ||
        request.url !== "/token" ||
        request.headers.host !== "oauth2.googleapis.com"
      ) {
        failures.push("Unexpected owned token request");
        response.writeHead(400).end();
        return;
      }
      exchanges.push(new URLSearchParams(Buffer.concat(chunks).toString()));
      response
        .writeHead(400, { "content-type": "application/json" })
        .end('{"error":"invalid_grant"}');
    });
  });
  const proxy = createHttpsServer({ key, cert: ca });
  let preview: ReturnType<typeof startOwnedCommand> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let ended = false;
  let transcript = "";
  let closed: Promise<void> | undefined;
  let backendPort: number | undefined;
  const observed: Record<string, unknown> = {};
  try {
    const tokenPort = await originListen(tokenServer);
    const frontPort = await originListen(proxy);
    // Canonical public authority is independent of the owned fixture's ephemeral destination port.
    const origin = "https://app.example.test:9443";
    const authority = new URL(origin).host;
    const portOwner = createHttpServer();
    try {
      backendPort = await originListen(portOwner);
    } finally {
      await originClose(portOwner);
    }
    proxy.on("request", (request, response) => {
      const backend = httpRequest(
        {
          hostname: "127.0.0.1",
          port: backendPort,
          path: request.url,
          method: request.method,
          agent: false,
          headers: { ...request.headers, host: authority, connection: "close" },
        },
        (upstream) => {
          response.writeHead(upstream.statusCode!, upstream.headers);
          upstream.pipe(response);
          upstream.once("error", (error) => response.destroy(error));
        },
      );
      const timer = setTimeout(
        () => backend.destroy(new Error("Owned proxy deadline exceeded")),
        2000,
      );
      backend.once("close", () => clearTimeout(timer));
      backend.once("error", (error) => {
        failures.push(error.message);
        response.destroy(error);
      });
      request.once("error", (error) => backend.destroy(error));
      response.once("close", () => backend.destroy());
      request.pipe(backend);
    });
    const preload = path.join(directory, "owned-provider-transport.mjs");
    await fs.writeFile(
      preload,
      `
      import { readFileSync } from 'node:fs';
      import { request } from 'node:https';
      const ca = readFileSync(${JSON.stringify(certPath)});
      globalThis.fetch = async (input, init) => {
        const source = new Request(input, init);
        if (source.url !== 'https://oauth2.googleapis.com/token') throw new Error('Unallowlisted fixture transport');
        const body = source.body ? Buffer.from(await source.arrayBuffer()) : undefined;
        if (body && body.length > 32768) throw new Error('Owned transport body cap');
        return new Promise((resolve, reject) => {
          const req = request({ hostname:'127.0.0.1', port:${tokenPort}, servername:'oauth2.googleapis.com', ca,
            method:source.method, path:'/token', agent:false, signal:source.signal,
            headers:{...Object.fromEntries(source.headers),host:'oauth2.googleapis.com',connection:'close'} }, res => {
            let size=0; const chunks=[];
            res.on('data', chunk => { size+=chunk.length; if(size>32768)req.destroy(new Error('Owned transport response cap'));else chunks.push(chunk); });
            res.once('error',reject);
            res.once('end',()=>{clearTimeout(timer);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));});
          });
          const timer=setTimeout(()=>req.destroy(new Error('Owned transport deadline')),2000);
          req.once('error',error=>{clearTimeout(timer);reject(error);}); req.end(body);
        });
      };
    `,
      { flag: "wx" },
    );
    preview = startOwnedCommand({
      command: process.execPath,
      args: ["--import", pathToFileURL(preload).href, path.join(project, "dist/server/server.js")],
      cwd: directory,
      evidence,
      label: "preview",
      timeoutMs: 120_000,
      signal,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(backendPort),
        APP_ORIGIN: origin,
        AUTH_SESSION_SECRET: Buffer.alloc(32, 19).toString("base64url"),
        GOOGLE_CLIENT_ID: "owned-origin-client",
        GOOGLE_CLIENT_SECRET: "OWNED_ORIGIN_CLIENT_SECRET",
        CSRF_SECRET: "packed-origin-fixture-CSRF-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      },
    });
    child = preview.child;
    child.stdout!.on("data", (chunk: Buffer) => {
      transcript = (transcript + chunk.toString()).slice(-65536);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      transcript = (transcript + chunk.toString()).slice(-65536);
    });
    closed = preview.closed.then((receipt) => {
      transcript += `\nexit=${receipt.code} signal=${receipt.signal} failure=${receipt.failure ?? "none"}`;
      ended = true;
    });
    const deadline = Date.now() + 20_000;
    let connected = false;
    while (Date.now() < deadline && !connected) {
      if (ended) throw new Error(`Origin preview exited before startup:\n${transcript}`);
      try {
        await originRequest(backendPort, "/auth/session", { host: `127.0.0.1:${backendPort}` });
        connected = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    expect(connected, transcript).toBe(true);
    const returnTo = "/?origin=1#owned";
    const localRecovery = new URL(
      `/auth/login/google?${new URLSearchParams({ returnTo })}`,
      origin,
    );
    const login = await originRequest(
      frontPort,
      localRecovery.pathname + localRecovery.search,
      { host: authority },
      ca,
    );
    observed.login = { status: login.status, headers: login.headers, body: login.body.toString() };
    expect(
      login.status,
      `Canonical Host must reach generated provider login:\n${login.body}\n${transcript}`,
    ).toBe(303);
    const authorize = new URL(login.headers.location!);
    expect(authorize.origin).toBe("https://accounts.google.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/auth/callback/google`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authorize.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]+$/);
    const cookies = login.headers["set-cookie"]!;
    expect(cookies.some((cookie) => cookie.startsWith("__Host-askr-txn-google="))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes("Secure"))).toBe(true);
    const cookie = cookies.map((value) => value.split(";", 1)[0]!).join("; ");
    const callbackPath = `/auth/callback/google?${new URLSearchParams({ code: "owned-origin-code", state: authorize.searchParams.get("state")! })}`;
    const callback = await originRequest(frontPort, callbackPath, { host: authority, cookie }, ca);
    observed.callback = {
      status: callback.status,
      headers: callback.headers,
      body: callback.body.toString(),
    };
    observed.exchanges = exchanges.map((value) => Object.fromEntries(value));
    expect(callback.status, callback.body.toString()).toBe(401);
    expect(JSON.parse(callback.body.toString())).toMatchObject({
      code: "interaction-required",
      reason: "login",
      provider: "google",
    });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.get("grant_type")).toBe("authorization_code");
    expect(exchanges[0]!.get("redirect_uri")).toBe(`${origin}/auth/callback/google`);
    expect(exchanges[0]!.get("code")).toBe("owned-origin-code");
    expect(
      createHash("sha256").update(exchanges[0]!.get("code_verifier")!).digest("base64url"),
    ).toBe(authorize.searchParams.get("code_challenge"));
    const replay = await originRequest(frontPort, callbackPath, { host: authority, cookie }, ca);
    observed.replay = { status: replay.status, body: replay.body.toString() };
    expect(replay.status).toBe(400);
    expect(JSON.parse(replay.body.toString())).toMatchObject({ code: "invalid-transaction" });
    expect(exchanges).toHaveLength(1);
    const foreign = await originRequest(backendPort, "/auth/login/google", {
      host: "foreign.example.test",
      "x-forwarded-host": authority,
      "x-forwarded-proto": "https",
    });
    observed.foreignHost = { status: foreign.status, body: foreign.body.toString() };
    expect(foreign.status).toBe(400);
    const recovery = await originRequest(
      frontPort,
      localRecovery.pathname + localRecovery.search,
      { host: authority },
      ca,
    );
    observed.recovery = {
      status: recovery.status,
      headers: recovery.headers,
      body: recovery.body.toString(),
    };
    expect(recovery.status).toBe(303);
    expect(new URL(recovery.headers.location!).searchParams.get("redirect_uri")).toBe(
      `${origin}/auth/callback/google`,
    );
    expect(failures).toEqual([]);
  } finally {
    const cleanup: Promise<unknown>[] = [];
    if (child && closed) {
      cleanup.push(
        (async () => {
          const receipt = await preview!.stop();
          await closed;
          if (receipt.failure || !receipt.childClosed || !receipt.cleanup.treeReaped)
            throw new Error(
              `Origin preview cleanup was not proven: ${receipt.failure ?? "missing tree reap"}\n${transcript}`,
              { cause: receipt },
            );
          if (backendPort !== undefined)
            await new Promise<void>((resolve, reject) => {
              const socket = createConnection({ host: "127.0.0.1", port: backendPort });
              const timer = setTimeout(
                () => finish(new Error("Origin preview shutdown observation timed out")),
                1000,
              );
              function finish(error?: Error) {
                clearTimeout(timer);
                socket.destroy();
                if (error) reject(error);
                else resolve();
              }
              socket.once("connect", () => finish(new Error("Origin preview remains reachable")));
              socket.once("error", (error: NodeJS.ErrnoException) =>
                finish(error.code === "ECONNREFUSED" ? undefined : error),
              );
            });
        })(),
      );
    }
    cleanup.push(originClose(proxy), originClose(tokenServer));
    const results = await Promise.allSettled(cleanup);
    await fs.writeFile(path.join(evidence, "preview.log"), transcript);
    await fs.writeFile(
      path.join(evidence, "origin-http.json"),
      `${JSON.stringify({ ...observed, childPid: child?.pid, backendPort, fixtureErrors: failures, cleanup: results.map((result) => (result.status === "fulfilled" ? { status: result.status } : { status: result.status, reason: String(result.reason) })) }, null, 2)}\n`,
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Owned origin fixture cleanup failed");
  }
}

interface OriginArchive {
  name: string;
  version: string;
  sourceCommit: string;
  sourceTree: string;
  archive: string;
  archiveSha512: string;
  packageJsonSha256: string;
  files: { path: string; sha256: string }[];
}

async function originCandidate(originRun: OriginRun) {
  // Root supplies this digest only after independently admitting normal archives.
  // This preliminary closure is distinct from final M18 and never discovers published Auth.
  const closurePath = process.env.ASKR_PROVIDER_ORIGIN_CLOSURE;
  const closureSha256 = process.env.ASKR_PROVIDER_ORIGIN_CLOSURE_SHA256;
  const evidenceRoot = process.env.ASKR_PROVIDER_ORIGIN_EVIDENCE;
  expect(
    evidenceRoot && path.isAbsolute(evidenceRoot),
    "An owned durable evidence root is required",
  ).toBe(true);
  expect(
    closurePath && path.isAbsolute(closurePath),
    "An admitted absolute archive closure path is required",
  ).toBe(true);
  expect(closureSha256, "An admitted archive closure digest is required").toMatch(/^[a-f0-9]{64}$/);
  const raw = await fs.readFile(closurePath!);
  expect(createHash("sha256").update(raw).digest("hex")).toBe(closureSha256);
  const closure = JSON.parse(raw.toString()) as {
    schemaVersion: number;
    boundary: string;
    toolchain: { node: string; npm: string };
    packages: OriginArchive[];
  };
  expect(closure.schemaVersion).toBe(1);
  expect(closure.boundary).toBe("CLI_PROVIDER_ORIGIN_PRELIMINARY_NORMAL_ARCHIVES");
  expect(closure.toolchain).toEqual({ node: "24.21.0", npm: "12.0.1" });
  expect(process.versions.node).toBe(closure.toolchain.node);
  expect((await originRun("npm", ["--version"], repository)).trim()).toBe(closure.toolchain.npm);
  const expected = [
    "@askrjs/askr",
    "@askrjs/auth",
    "@askrjs/charts",
    "@askrjs/cli",
    "@askrjs/i18n",
    "@askrjs/lucide",
    "@askrjs/node",
    "@askrjs/otel",
    "@askrjs/schema",
    "@askrjs/server",
    "@askrjs/themes",
    "@askrjs/ui",
    "@askrjs/vite",
  ];
  expect(closure.packages.map((value) => value.name).sort()).toEqual(expected.sort());
  for (const value of closure.packages) {
    expect(value.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(value.sourceTree).toMatch(/^[a-f0-9]{40}$/);
    expect(value.version).toMatch(/^0\.4\.\d+$/);
    expect(value.packageJsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(value.archiveSha512).toMatch(/^[a-f0-9]{128}$/);
    expect(path.isAbsolute(value.archive)).toBe(true);
    expect(
      createHash("sha512")
        .update(await fs.readFile(value.archive))
        .digest("hex"),
    ).toBe(value.archiveSha512);
    expect(value.files.length).toBeGreaterThan(0);
    expect(new Set(value.files.map((file) => file.path)).size).toBe(value.files.length);
    expect(value.files.find((file) => file.path === "package.json")?.sha256).toBe(
      value.packageJsonSha256,
    );
    for (const file of value.files) {
      expect(file.path).toMatch(/^[^\\]+$/);
      expect(path.isAbsolute(file.path)).toBe(false);
      expect(
        file.path.split("/").some((part) => part === ".." || part === "." || part === ""),
      ).toBe(false);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  }
  return { ...closure, evidenceRoot: evidenceRoot! };
}

async function originInstalledGraph(project: string, packages: OriginArchive[]) {
  const lock = JSON.parse(await fs.readFile(path.join(project, "package-lock.json"), "utf8")) as {
    lockfileVersion: number;
    packages: Record<
      string,
      { version?: string; integrity?: string; resolved?: string; link?: boolean }
    >;
  };
  expect(lock.lockfileVersion).toBe(3);
  const found = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const match = /(?:^|\/)node_modules\/(@askrjs\/[^/]+)$/.exec(key);
    if (!match) continue;
    const name = match[1]!;
    const candidate = packages.find((value) => value.name === name);
    expect(candidate, `Unregistered Askr package at ${key}`).toBeDefined();
    expect(entry.link).not.toBe(true);
    expect(entry.version).toBe(candidate!.version);
    expect(entry.resolved?.startsWith("file:")).toBe(true);
    expect(
      await fs.realpath(fileURLToPath(new URL(entry.resolved!, pathToFileURL(project + path.sep)))),
    ).toBe(await fs.realpath(candidate!.archive));
    expect(entry.integrity).toBe(
      `sha512-${Buffer.from(candidate!.archiveSha512, "hex").toString("base64")}`,
    );
    for (const file of candidate!.files) {
      expect(
        createHash("sha256")
          .update(await fs.readFile(path.join(project, key, file.path)))
          .digest("hex"),
        `${key}/${file.path}`,
      ).toBe(file.sha256);
    }
    found.add(name);
  }
  expect([...found].sort()).toEqual(packages.map((value) => value.name).sort());
  const cliManifest = path.join(project, "node_modules/@askrjs/cli/package.json");
  const cli = JSON.parse(await fs.readFile(cliManifest, "utf8")) as {
    name: string;
    version: string;
    bin: Record<string, string>;
  };
  expect(cli.name).toBe("@askrjs/cli");
  expect(cli.bin.askr).toBe("./dist/cli.js");
  return path.resolve(path.dirname(cliManifest), cli.bin.askr);
}

async function originArchiveBindings(project: string, packages: OriginArchive[]) {
  const manifestPath = path.join(project, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith("@askrjs/")) continue;
      const candidate = packages.find((value) => value.name === name);
      expect(candidate, `Unregistered generated dependency: ${name}`).toBeDefined();
      manifest[field][name] = pathToFileURL(candidate!.archive).href;
    }
  }
  // Bind the complete finite sibling/peer closure at the root, using ordinary file archives.
  // This is an explicit test-owned manifest projection; emitted source stays untouched.
  manifest.devDependencies ??= {};
  for (const candidate of packages) {
    if (!(candidate.name in (manifest.dependencies ?? {})))
      manifest.devDependencies[candidate.name] = pathToFileURL(candidate.archive).href;
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test.each(["ssr", "spa", "startkit", "full-stack"])(
  "packed provider %s preserves the configured HTTPS origin through forwarding",
  async (template) => {
    const caseController = new AbortController();
    const caseTimer = setTimeout(() => caseController.abort(), 170_000);
    let root: string | undefined;
    let evidence: string | undefined;
    let completed = false;
    try {
      const evidenceRoot = process.env.ASKR_PROVIDER_ORIGIN_EVIDENCE;
      if (!evidenceRoot || !path.isAbsolute(evidenceRoot))
        throw new Error("An owned durable evidence root is required");
      evidence = path.join(evidenceRoot, template);
      await fs.mkdir(evidence);
      let commandNumber = 0;
      const originRun: OriginRun = async (command, args, cwd, timeoutMs = 120_000) => {
        const npmCli =
          command === "npm" && process.platform === "win32" ? process.env.npm_execpath : undefined;
        if (
          command === "npm" &&
          process.platform === "win32" &&
          (!npmCli || !path.isAbsolute(npmCli))
        )
          throw new Error("Run the origin integration through npm with its absolute npm CLI");
        return runOwnedCommand({
          command: npmCli ? process.execPath : command,
          args: npmCli ? [npmCli, ...args] : args,
          requested: { command, args },
          cwd,
          evidence: evidence!,
          label: `command-${++commandNumber}`,
          timeoutMs,
          signal: caseController.signal,
          env: { ...process.env, NO_COLOR: "1" },
        });
      };
      const candidate = await originCandidate(originRun);
      await fs.writeFile(
        path.join(evidence, "closure.json"),
        await fs.readFile(process.env.ASKR_PROVIDER_ORIGIN_CLOSURE!),
      );
      root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-provider-origin-"));
      const launcher = path.join(root, "launcher");
      await fs.mkdir(launcher);
      await fs.writeFile(
        path.join(launcher, "package.json"),
        '{"name":"owned-origin-launcher","version":"0.0.0","private":true,"type":"module"}\n',
      );
      await originArchiveBindings(launcher, candidate.packages);
      await originRun("npm", ["install", "--no-audit", "--no-fund"], launcher);
      const cli = await originInstalledGraph(launcher, candidate.packages);
      try {
        await originRun("npm", ["ls", "--all"], launcher);
      } catch (error) {
        const listingEvidence = path.join(evidence, "npm-ls-launcher");
        await fs.mkdir(listingEvidence);
        await inspectKnownViteOriginDiagnostic(launcher, listingEvidence, error, originRun);
      }
      const emitted = path.join(root, "emitted");
      await originRun(
        process.execPath,
        [
          cli,
          "create",
          template,
          `origin-${template}`,
          "--dir",
          emitted,
          "--auth",
          "google",
          "--origin",
          "https://app.example.test:9443",
          "--no-install",
          "--no-skills",
        ],
        root,
      );
      await fs.cp(emitted, path.join(evidence, "emitted"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      let project = path.join(root, `working-origin-${template}`);
      await fs.cp(emitted, project, { recursive: true, errorOnExist: true, force: false });
      await originArchiveBindings(project, candidate.packages);
      await fs.copyFile(
        path.join(project, "package.json"),
        path.join(evidence, "working-package.json"),
      );
      await originRun("npm", ["install", "--no-audit", "--no-fund"], project);
      await originInstalledGraph(project, candidate.packages);
      await fs.copyFile(
        path.join(project, "package-lock.json"),
        path.join(evidence, "working-package-lock.json"),
      );
      try {
        await originRun("npm", ["ls", "--all"], project);
      } catch (error) {
        const listingEvidence = path.join(evidence, "npm-ls-working");
        await fs.mkdir(listingEvidence);
        await inspectKnownViteOriginDiagnostic(project, listingEvidence, error, originRun);
      }
      await originRun("npm", ["run", "check"], project);
      const runtimeProject = path.join(root, `working-origin-${template} path #100% ü`);
      await fs.rename(project, runtimeProject);
      project = runtimeProject;
      // Public installed Node control: an HTTPS forwarding header never changes its default HTTP base.
      const control = path.join(project, "owned-forwarded-control.mjs");
      await fs.writeFile(
        control,
        `
      import assert from 'node:assert/strict'; import {request} from 'node:http'; import {serve} from '@askrjs/node';
      const running=await serve({fetch:async req=>Response.json({origin:new URL(req.url).origin})},{host:'127.0.0.1',allowedHosts:['app.example.test:9443']});
      try{const port=Number(new URL(running.url).port);const data=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:'/',agent:false,headers:{host:'app.example.test:9443','x-forwarded-proto':'https','x-forwarded-host':'foreign.example.test',connection:'close'}},res=>{let body='';res.on('data',c=>{body+=c;if(body.length>1024)req.destroy(new Error('Control body cap'));});res.once('error',reject);res.once('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,body});});});const timer=setTimeout(()=>req.destroy(new Error('Control absolute deadline')),2000);req.once('error',e=>{clearTimeout(timer);reject(e);});req.end();});assert.equal(data.status,200);assert.equal(JSON.parse(data.body).origin,'http://app.example.test:9443');}finally{await running.close();}
    `,
        { flag: "wx" },
      );
      await originRun(process.execPath, [control], project, 10_000);
      await fs.copyFile(
        path.join(project, "dist/server/server.js"),
        path.join(evidence, "compiled-server.js"),
      );
      await checkProviderOrigin(project, root, evidence, originRun, caseController.signal);
      completed = true;
    } finally {
      clearTimeout(caseTimer);
      if (root && completed) await fs.rm(root, { recursive: true, force: true });
      else if (root && evidence)
        await fs.writeFile(
          path.join(evidence, "retained-failed-fixture.json"),
          `${JSON.stringify({ root, reason: "Failed origin fixture retained; inspect owned command cleanup receipts before disposal" })}\n`,
        );
    }
  },
  180_000,
);
