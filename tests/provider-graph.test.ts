import { expect, test } from "vite-plus/test";
import {
  finalNames,
  loadFinalAdmission,
  validateAdmission,
  validateManifest,
  validateRanges,
  ownedEnvironment,
  validateParentWitness,
  digest,
  type FinalManifest,
  type FinalAdmission,
} from "./helpers/final-provider-graph";
import { relayBrowserRequest } from "./helpers/signed-starter-provider";

const h = (length: number) => "a".repeat(length);
function manifest(): FinalManifest {
  return {
    schemaVersion: 1,
    release: "0.5.0",
    complete: true,
    toolchain: { node: "24.21.0", npm: "12.0.1" },
    packages: finalNames.map((name) => ({
      name,
      repo: name === "@askrjs/askr" ? "askrjs/askr" : `askrjs/askr-${name.slice(8)}`,
      commit: h(40),
      tree: h(40),
      packageJsonSha256: h(64),
      lockSha256: h(64),
      archiveSha512: h(128),
    })),
  };
}
function admission(): FinalAdmission {
  const ref = { file: "/owned/proof", sha256: h(64) };
  return {
    schemaVersion: 1,
    boundary: "CLI_PROVIDER_STARTERS_FINAL18",
    approvedForExecution: true,
    platform: "linux",
    phase: "all",
    manifest: ref,
    rootReadback: ref,
    independentReview: ref,
    publicHelperReadback: ref,
    caller: ref,
    helper: { commit: h(40), tree: h(40) },
    registry: { url: "http://127.0.0.1:12345/", id: "12345678-1234-1234-1234-123456789abc" },
    archives: manifest().packages.map((row) => ({
      name: row.name,
      archive: "/owned/archive.tgz",
      archiveSha512: row.archiveSha512,
      packageJsonSha256: row.packageJsonSha256,
      files: [{ path: "package.json", mode: 0o644, sha256: row.packageJsonSha256, size: 1 }],
    })),
    tools: {
      npmCli: ref,
      openssl: { executable: ref, version: "synthetic-model-only" },
      typescript6: { cli: ref, packageJson: ref, version: "6.0.2" },
      typescript7: { cli: ref, packageJson: ref, version: "7.0.2" },
      playwright: {
        packageJson: ref,
        version: "1.63.0",
        browsers: ["chromium", "firefox", "webkit"].map((name) => ({
          name,
          executable: ref,
          rootExecutable: ref,
        })),
      },
    },
  };
}
test("missing final admission rejects before any registry request or install", async () => {
  await expect(loadFinalAdmission(undefined, undefined)).rejects.toThrow(
    /Explicit final18 admission/u,
  );
});
test("product child environment has owned paths and no ambient credentials or injectors", () => {
  const env = ownedEnvironment(
    {
      HOME: "/human",
      PATH: "/untrusted",
      GITHUB_TOKEN: "PRIVATE_CANARY",
      ASKR_FOREIGN_AUTHORITY: "PRIVATE_CANARY",
    },
    "linux",
    "/owned",
    "/tool/node",
    "/tool/openssl",
  );
  expect(env.HOME).toBe("/owned/owned-home");
  expect(env.PATH).toBe("/tool:/usr/bin:/bin:/usr/sbin:/sbin");
  expect(env.GITHUB_TOKEN).toBeUndefined();
  expect(env.ASKR_FOREIGN_AUTHORITY).toBeUndefined();
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "HTTPS_PROXY", "BASH_ENV", "ENV", "LD_PRELOAD"])
    expect(() =>
      ownedEnvironment(
        { [name]: "PRIVATE_CANARY" },
        "linux",
        "/owned",
        "/tool/node",
        "/tool/openssl",
      ),
    ).toThrow();
});
test("finite parent witness is mandatory and exact without retaining values", () => {
  const m = manifest(),
    a = admission(),
    ambient = { HOME: "/owned/home", PATH: "/tool:/usr/bin:/bin" };
  const pairs = Object.entries(ambient).sort(([x], [y]) => x.localeCompare(y));
  const value = {
    schemaVersion: 1,
    boundary: "REVIEWED_FINAL16_FINITE_PARENT",
    finiteEnvironmentReviewed: true,
    platform: a.platform,
    phase: a.phase,
    manifestSha256: a.manifest.sha256,
    callerCommit: m.packages.find((row) => row.name === "@askrjs/cli")!.commit,
    callerTree: m.packages.find((row) => row.name === "@askrjs/cli")!.tree,
    cwd: "/owned/checkout",
    environmentSha256: digest(Buffer.from(JSON.stringify(pairs))),
    environmentKeys: pairs.map(([name]) => name),
    nodeExecutable: { file: "/tool/node", sha256: h(64) },
    terminationTool: null,
  };
  expect(() => validateParentWitness(value, a, m, ambient, "/owned/checkout")).not.toThrow();
  expect(() =>
    validateParentWitness(
      value,
      a,
      m,
      { ...ambient, GITHUB_TOKEN: "PRIVATE_CANARY" },
      "/owned/checkout",
    ),
  ).toThrow();
  expect(() =>
    validateParentWitness(value, a, m, { ...ambient, PATH: "/foreign" }, "/owned/checkout"),
  ).toThrow();
  expect(() => validateParentWitness(value, a, m, ambient, "/foreign")).toThrow();
  expect(() =>
    validateParentWitness(
      { ...value, finiteEnvironmentReviewed: false },
      a,
      m,
      ambient,
      "/owned/checkout",
    ),
  ).toThrow();
});
test("browser relay forwards actual allHeaders cookie/origin instead of the filtered headers view", async () => {
  let all = 0,
    filtered = 0;
  const body = Buffer.from("state=sealed");
  const source = {
    url: () => "https://app.example.test/auth/callback/apple",
    method: () => "POST",
    headers: () => {
      filtered++;
      return { "content-type": "application/x-www-form-urlencoded" };
    },
    allHeaders: async () => {
      all++;
      return {
        cookie: "actual-browser-transaction",
        origin: "https://appleid.apple.com",
        "content-type": "application/x-www-form-urlencoded",
      };
    },
    postDataBuffer: () => body,
  };
  const reply = await relayBrowserRequest(source, async (url, request) => {
    expect(url).toBe(source.url());
    expect(request.method).toBe("POST");
    expect(request.headers.cookie).toBe("actual-browser-transaction");
    expect(request.headers.origin).toBe("https://appleid.apple.com");
    expect(request.body).toBe(body);
    return { status: 303, headers: {}, body: Buffer.alloc(0) };
  });
  expect(reply.status).toBe(303);
  expect(all).toBe(1);
  expect(filtered).toBe(0);
});
test.each([false, null, undefined])(
  "unapproved admission %s is rejected",
  (approvedForExecution) => {
    const value = admission();
    Object.assign(value, { approvedForExecution });
    expect(() => validateAdmission(value, manifest())).toThrow();
  },
);
test("preliminary13 and incomplete/future tool graphs cannot become final18", () => {
  for (const alter of [
    (m: FinalManifest) => {
      m.complete = false;
    },
    (m: FinalManifest) => {
      m.packages.length = 13;
    },
    (m: FinalManifest) => {
      m.packages[1] = m.packages[0]!;
    },
    (m: FinalManifest) => {
      m.toolchain.npm = "11.19.0";
    },
    (m: FinalManifest) => {
      m.release = "0.4.2";
    },
    (m: FinalManifest) => {
      m.packages[0]!.commit = "";
    },
  ]) {
    const value = manifest();
    alter(value);
    expect(() => validateManifest(value)).toThrow();
  }
});
test("original final product ranges are checked without a fixture projection", () => {
  expect(() =>
    validateRanges({ dependencies: { "@askrjs/auth": ">=0.5.0 <0.6.0" } }),
  ).not.toThrow();
  for (const range of [">=0.4.0 <0.5.0", "file:/owned/auth.tgz", "latest"]) {
    expect(() => validateRanges({ dependencies: { "@askrjs/auth": range } })).toThrow();
  }
  expect(() => validateRanges({ dependencies: { "@askrjs/unknown": "0.5.0" } })).toThrow();
  expect(() => validateRanges({})).toThrow();
});
test("registry identity, archive hash, owner and path boundaries fail closed", () => {
  const changes: ((a: FinalAdmission) => void)[] = [
    (a) => {
      a.registry.url = "https://registry.npmjs.org/";
    },
    (a) => {
      a.registry.url = "http://127.0.0.1:12345/redirect";
    },
    (a) => {
      a.registry.url = "http://user@127.0.0.1:12345/";
    },
    (a) => {
      a.registry.id = "";
    },
    (a) => {
      a.helper.commit = "";
    },
    (a) => {
      a.archives[0]!.archiveSha512 = "b".repeat(128);
    },
    (a) => {
      a.archives[0]!.files[0]!.path = "../package.json";
    },
    (a) => {
      a.archives[0]!.files[0]!.path = "server\\package.json";
    },
    (a) => {
      a.archives[0]!.files[0]!.mode = 0o777;
    },
    (a) => {
      a.archives[0]!.files[0]!.size = -1;
    },
    (a) => {
      a.tools.typescript7.version = "6.0.2";
    },
    (a) => {
      a.tools.playwright.browsers.length = 2;
    },
  ];
  expect(() => validateAdmission(admission(), manifest())).not.toThrow();
  for (const alter of changes) {
    const value = admission();
    alter(value);
    expect(() => validateAdmission(value, manifest())).toThrow();
  }
});
