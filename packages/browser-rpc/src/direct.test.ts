import { describe, expect, it, vi } from "vitest";
import { DirectRpcTransport } from "./direct.js";
import {
  assertReadOnlyMethod,
  BrowserRpcError,
  READ_ONLY_METHODS,
  redactMessage,
} from "./types.js";

const endpoint = "http://127.0.0.1:8545";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DirectRpcTransport", () => {
  it("sends an allowlisted read-only request and records success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    );
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });

    const observation = await transport.request("eth_chainId");

    expect(observation.success).toBe(true);
    expect(observation.route).toBe("direct");
    expect(observation.receivedThroughHarness).toBe(false);
    expect(observation.harnessReady).toBe(false);
    expect(observation.value).toBe("0x1");
    expect(observation.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(observation.endedAt)).toBeGreaterThanOrEqual(
      Date.parse(observation.startedAt),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${endpoint}/`);
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: "eth_chainId",
      params: [],
    });
  });

  it("uses only public non-sensitive parameters for eth_getBalance", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x0" }));
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    await transport.request("eth_getBalance");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).params).toEqual([
      "0x0000000000000000000000000000000000000000",
      "latest",
    ]);
  });

  it("classifies HTTP failures without leaking the endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    const transport = new DirectRpcTransport({
      endpoint: "https://user:secret@example.test/rpc?apikey=abc",
      fetchImpl,
    });
    const observation = await transport.request("eth_blockNumber");
    expect(observation.success).toBe(false);
    expect(observation.errorCategory).toBe("http");
    expect(JSON.stringify(observation)).not.toContain("secret");
    expect(JSON.stringify(observation)).not.toContain("apikey");
  });

  it("classifies invalid JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("{not json", { status: 200 }),
    );
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    const observation = await transport.request("eth_blockNumber");
    expect(observation.errorCategory).toBe("json");
  });

  it("classifies JSON-RPC errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: -32000, message: "execution reverted" } }),
    );
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    const observation = await transport.request("eth_call");
    expect(observation.success).toBe(false);
    expect(observation.errorCategory).toBe("json-rpc");
    expect(observation.errorMessage).toContain("-32000");
  });

  it("classifies connection failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("connection");
  });

  it("times out a hanging request", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const transport = new DirectRpcTransport({
      endpoint,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });
    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("timeout");
    expect(observation.success).toBe(false);
  });

  it("reports external cancellation as aborted, not timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const transport = new DirectRpcTransport({
      endpoint,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5_000,
    });
    const controller = new AbortController();
    const pending = transport.request("eth_chainId", {
      signal: controller.signal,
    });
    controller.abort();
    const observation = await pending;
    expect(observation.errorCategory).toBe("aborted");
  });

  it("rejects unsupported and wallet methods", () => {
    expect(() => assertReadOnlyMethod("eth_sendTransaction")).toThrow(
      BrowserRpcError,
    );
    expect(() => assertReadOnlyMethod("personal_sign")).toThrow(
      /wallet or transaction/,
    );
    expect(() => assertReadOnlyMethod("debug_traceCall")).toThrow(/allowlist/);
    for (const method of READ_ONLY_METHODS) {
      expect(assertReadOnlyMethod(method)).toBe(method);
    }
  });

  it("refuses wallet methods at runtime, not only at compile time", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1" }));
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    await expect(
      transport.request("eth_sendTransaction" as never),
    ).rejects.toMatchObject({ category: "unsupported-method" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed or non-http endpoints at construction", () => {
    expect(() => new DirectRpcTransport({ endpoint: "not a url" })).toThrow(
      BrowserRpcError,
    );
    expect(
      () => new DirectRpcTransport({ endpoint: "file:///tmp/rpc" }),
    ).toThrow(/http or https/);
  });

  it("does not send after close", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1" }));
    const transport = new DirectRpcTransport({ endpoint, fetchImpl });
    transport.close();
    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("not-ready");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("redactMessage", () => {
  it("reduces URLs to origins and drops credentials and query strings", () => {
    const message = redactMessage(
      "failed at https://user:pass@rpc.example/abc?token=supersecret while dialing",
    );
    expect(message).toContain("https://rpc.example");
    expect(message).not.toContain("supersecret");
    expect(message).not.toContain("pass@");
  });

  it("truncates long messages", () => {
    expect(redactMessage("x".repeat(500)).length).toBeLessThanOrEqual(201);
  });
});
