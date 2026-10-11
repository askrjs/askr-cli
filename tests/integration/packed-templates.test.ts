import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";

import {
  bindPreliminaryManifest,
  inspectKnownViteDiagnostic,
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
      "/server/server.js",
      "/SERVER/server.js",
      "/%73erver/server.js",
      "//server/server.js",
      "/assets%5C..%5Cserver%5Cserver.js",
      "/.vite/manifest.json",
      "/.VITE/manifest.json",
      "/%2evite/manifest.json",
      "//.vite/manifest.json",
      "/assets%5C..%5C.vite%5Cmanifest.json",
    ];
    for (const pathname of privatePaths) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${origin}${pathname}`, {
          method,
          signal: AbortSignal.timeout(2000),
        });
        expect(response.status, `${method} ${pathname}`).toBe(404);
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
