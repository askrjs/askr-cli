import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  fetchPackuments,
  loadNpmConfiguration,
  sanitizeRegistryError,
} from "../src/update/registry";

const temporaryRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "askr-update-registry-"));
  temporaryRoots.push(root);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("update npm configuration and registry", () => {
  test("should apply npm precedence given global user project and environment settings when loading", async () => {
    const root = await tempRoot();
    const user = path.join(root, "user.npmrc");
    const global = path.join(root, "global.npmrc");
    await fs.writeFile(global, "registry=https://global.invalid/\n");
    await fs.writeFile(user, "registry=https://user.invalid/\n");
    await fs.writeFile(path.join(root, ".npmrc"), "registry=https://project.invalid/\n");

    const project = await loadNpmConfiguration(root, {
      HOME: root,
      npm_config_globalconfig: global,
      npm_config_userconfig: user,
    });
    const environment = await loadNpmConfiguration(root, {
      HOME: root,
      npm_config_globalconfig: global,
      npm_config_registry: "https://environment.invalid/",
      npm_config_userconfig: user,
    });

    expect(project.registry).toBe("https://project.invalid/");
    expect(environment.registry).toBe("https://environment.invalid/");
  });

  test("should route a scoped package with authentication given scoped npm configuration when fetching", async () => {
    const root = await tempRoot();
    let authorization = "";
    let requestPath = "";
    const server = http.createServer((request, response) => {
      authorization = request.headers.authorization ?? "";
      requestPath = request.url ?? "";
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { version: "1.0.0" } },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture registry did not start");
    const registry = `http://127.0.0.1:${address.port}/`;
    await fs.writeFile(
      path.join(root, ".npmrc"),
      [
        `@scope:registry=${registry}`,
        `//127.0.0.1:${address.port}/:_authToken=fixture-secret-token`,
        "",
      ].join("\n"),
    );

    try {
      const configuration = await loadNpmConfiguration(root, { HOME: root });
      const result = await fetchPackuments(["@scope/fixture"], configuration);

      expect(result.failures.size).toBe(0);
      expect(result.packuments.has("@scope/fixture")).toBe(true);
      expect(requestPath.toLowerCase()).toContain("@scope%2ffixture");
      expect(authorization).toBe("Bearer fixture-secret-token");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("should deduplicate package requests given repeated names when fetching", async () => {
    let calls = 0;
    const result = await fetchPackuments(["fixture", "fixture"], {}, async () => {
      calls += 1;
      return { "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } };
    });

    expect(calls).toBe(1);
    expect(result.packuments.size).toBe(1);
  });

  test("should sanitize credentials given a registry error with a credential-bearing message when reporting", () => {
    const error = Object.assign(new Error("https://user:secret@example.invalid/token"), {
      statusCode: 401,
    });

    expect(sanitizeRegistryError(error)).toBe("registry authentication or authorization failed");
    expect(sanitizeRegistryError(error)).not.toContain("secret");
  });
});
