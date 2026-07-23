import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  responses: [] as Array<{
    status?: number;
    headers?: Record<string, string>;
    chunks?: string[];
  }>,
  requests: [] as Array<{ url: URL; options: Record<string, unknown> }>,
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
        message.resume = () => {};
        message.destroy = () => {};
        callback(message);
        setTimeout(() => {
          for (const chunk of response.chunks ?? []) {
            message.emit("data", Buffer.from(chunk));
          }
          message.emit("end");
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
  });

  it("should reject chunked bodies above the byte ceiling", async () => {
    transport.responses.push({ chunks: ["12345", "67890"] });
    await expect(loadOpenApi("https://spec.example/openapi.yaml", { maxBytes: 8 })).rejects.toThrow(
      "exceeds 8 bytes",
    );
  });
});
