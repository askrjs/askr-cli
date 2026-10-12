import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { expect } from "vite-plus/test";

export type PackedRun = (command: string, args: string[], cwd: string) => Promise<string>;

// The caller owns commands; an optional signal also cancels its hosting preview.
export function packedHostingChecks(run: PackedRun, repository: string, signal?: AbortSignal) {
  async function checkBuiltHosting(
    project: string,
    launchDirectory: string,
    onRelocated?: (project: string) => void,
  ): Promise<string> {
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
    onRelocated?.(previewProject);
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
    signal?.throwIfAborted();
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
    const abortPreview = () => {
      if (!ended) child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abortPreview, { once: true });
    if (signal?.aborted) abortPreview();
    const requestSignal = (timeoutMs: number) =>
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
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
        signal?.throwIfAborted();
        if (ended) throw new Error(`Built server exited before serving HTML:\n${transcript}`);
        try {
          const response = await fetch(origin, {
            signal: requestSignal(Math.max(1, Math.min(1000, deadline - Date.now()))),
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
      signal?.throwIfAborted();
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
        signal?.throwIfAborted();
        for (const method of ["GET", "HEAD"]) {
          const response = await fetch(`${origin}${pathname}`, {
            method,
            signal: requestSignal(2000),
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
        signal?.throwIfAborted();
        const response = await fetch(`${origin}/${relative}`, {
          signal: requestSignal(2000),
        });
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
          signal: requestSignal(2000),
        });
        expect(head.status, relative).toBe(200);
        expect(head.headers.get("content-length"), relative).toBe(String(bytes.length));
        expect((await head.arrayBuffer()).byteLength, relative).toBe(0);
      }
    } finally {
      signal?.removeEventListener("abort", abortPreview);
      if (!ended) child.kill("SIGTERM");
      const stopped = await observeExit();
      if (!stopped) {
        child.kill("SIGKILL");
        await observeExit();
        throw new Error(`Built server did not exit after SIGTERM:\n${transcript}`);
      }
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        const timer = setTimeout(
          () => finish(new Error("TCP shutdown observation timed out")),
          1000,
        );
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
    return previewProject;
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
  return { checkBuiltHosting, checkScopedSsgJsx };
}
