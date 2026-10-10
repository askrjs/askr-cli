import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  responses: [] as Array<{
    status?: number;
    headers?: Record<string, string>;
    chunks?: string[];
    neverEnd?: boolean;
    abort?: boolean;
  }>,
  requests: [] as Array<{ url: URL; options: Record<string, unknown> }>,
  observations: [] as Array<{ destroyed: boolean; resumed: boolean; bytes: number }>,
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    request(
      url: URL,
      options: Record<string, unknown>,
      callback: (message: EventEmitter & Record<string, unknown>) => void,
    ) {
      transport.requests.push({ url, options });
      const request = new EventEmitter() as EventEmitter & {
        setTimeout(ms: number, listener: () => void): void;
        destroy(error?: Error): void;
        end(): void;
      };
      request.setTimeout = () => {};
      request.destroy = (error) => {
        if (error) request.emit("error", error);
      };
      request.end = () => {
        const response = transport.responses.shift() ?? {};
        const message = new EventEmitter() as EventEmitter & Record<string, unknown>;
        message.statusCode = response.status ?? 200;
        message.statusMessage = "OK";
        message.headers = response.headers ?? {};
        const state = { destroyed: false, resumed: false, bytes: 0 };
        transport.observations.push(state);
        message.resume = () => {
          state.resumed = true;
        };
        message.destroy = () => {
          state.destroyed = true;
        };
        callback(message);
        setTimeout(() => {
          for (const chunk of response.chunks ?? []) {
            if (state.destroyed) return;
            state.bytes += Buffer.byteLength(chunk);
            message.emit("data", Buffer.from(chunk));
          }
          if (state.destroyed) return;
          if (response.abort) message.emit("aborted");
          else if (!response.neverEnd) message.emit("end");
        }, 0);
      };
      return request;
    },
  };
});

import { loadOpenApi } from "../src/generate/generator";

const document = "openapi: 3.1.0\ninfo: { title: Remote, version: '1' }\npaths: {}\n";

describe("remote OpenAPI transport", () => {
  beforeEach(() => {
    transport.responses.length = 0;
    transport.requests.length = 0;
    transport.observations.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should pin vetted addresses while preserving the TLS hostname", async () => {
    transport.responses.push({ chunks: [document] });
    await expect(loadOpenApi("https://spec.example/openapi.yaml")).resolves.toMatchObject({
      openapi: "3.1.0",
    });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.options.servername).toBe("spec.example");
    expect(transport.requests[0]!.options.headers).toMatchObject({
      "accept-encoding": "identity",
    });
    const lookup = transport.requests[0]!.options.lookup as Function;
    const callback = vi.fn();
    lookup("spec.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(transport.observations[0]!.destroyed).toBe(false);
  });

  it("should revalidate redirects and reject encoded bodies", async () => {
    transport.responses.push(
      { status: 302, headers: { location: "/next.yaml" } },
      { headers: { "content-encoding": "gzip" }, chunks: [document] },
    );
    await expect(loadOpenApi("https://spec.example/openapi.yaml")).rejects.toThrow(
      "unsupported content encoding",
    );
    expect(transport.requests.map(({ url }) => url.pathname)).toEqual([
      "/openapi.yaml",
      "/next.yaml",
    ]);
    expect(transport.observations.map(({ destroyed }) => destroyed)).toEqual([true, true]);
  });

  it("should reject chunked bodies above the byte ceiling", async () => {
    transport.responses.push({ chunks: ["12345", "67890"] });
    await expect(loadOpenApi("https://spec.example/openapi.yaml", { maxBytes: 8 })).rejects.toThrow(
      "exceeds 8 bytes",
    );
    expect(transport.observations[0]!.destroyed).toBe(true);
  });

  it.each([
    [
      "encoding",
      [{ headers: { "content-encoding": "gzip" }, neverEnd: true }],
      {},
      /unsupported content encoding/,
    ],
    [
      "declared byte limit",
      [{ headers: { "content-length": "100" }, neverEnd: true }],
      { maxBytes: 8 },
      /exceeds 8 bytes/,
    ],
    [
      "redirect limit",
      [
        { status: 302, headers: { location: "/again" }, neverEnd: true },
        { status: 302, headers: { location: "/again" }, neverEnd: true },
      ],
      { maxRedirects: 1 },
      /Too many redirects/,
    ],
    ["missing redirect location", [{ status: 302, neverEnd: true }], {}, /missing Location/],
    ["HTTP error", [{ status: 503, neverEnd: true }], {}, /Unable to fetch/],
  ] as const)(
    "destroys rejected %s response bodies instead of leaving them streaming",
    async (_name, responses, options, message) => {
      transport.responses.push(...responses);
      await expect(loadOpenApi("https://spec.example/openapi.yaml", options)).rejects.toThrow(
        message,
      );
      expect(transport.observations).toHaveLength(responses.length);
      expect(transport.observations.every(({ destroyed }) => destroyed)).toBe(true);
      expect(transport.observations.every(({ resumed }) => !resumed)).toBe(true);
    },
  );

  it("disposes a redirected body before following a permitted redirect and retains the complete final response", async () => {
    transport.responses.push(
      { status: 302, headers: { location: "/next.yaml" }, neverEnd: true },
      { chunks: [document] },
    );
    await expect(loadOpenApi("https://spec.example/openapi.yaml")).resolves.toMatchObject({
      openapi: "3.1.0",
    });
    expect(transport.observations.map(({ destroyed }) => destroyed)).toEqual([true, false]);
    expect(transport.requests.map(({ url }) => url.pathname)).toEqual([
      "/openapi.yaml",
      "/next.yaml",
    ]);
  });

  it("disposes a redirect body before rejecting its cross-origin destination", async () => {
    transport.responses.push({
      status: 302,
      headers: { location: "https://foreign.example/spec" },
      neverEnd: true,
    });
    await expect(loadOpenApi("https://spec.example/openapi.yaml")).rejects.toThrow(
      "Cross-origin OpenAPI reference is not allowed",
    );
    expect(transport.requests).toHaveLength(1);
    expect(transport.observations[0]!.destroyed).toBe(true);
  });

  it("destroys a response that stalls past the load deadline", async () => {
    vi.useFakeTimers();
    transport.responses.push({ chunks: ["partial"], neverEnd: true });
    const result = expect(
      loadOpenApi("https://spec.example/openapi.yaml", { timeoutMs: 20 }),
    ).rejects.toThrow(/Timed out/);
    await vi.runAllTimersAsync();
    await result;
    expect(transport.observations[0]!.destroyed).toBe(true);
  });

  it("destroys an aborted response without parsing its incomplete body", async () => {
    transport.responses.push({ chunks: ["partial"], abort: true });
    await expect(loadOpenApi("https://spec.example/openapi.yaml")).rejects.toThrow(
      "OpenAPI response body was aborted",
    );
    expect(transport.observations[0]!.destroyed).toBe(true);
  });
});
