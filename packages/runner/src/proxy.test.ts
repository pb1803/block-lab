import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import {
  ExecutionCancelledError,
  PreflightError,
  RpcProxy,
  runRpcBlackout,
  runRpcIntermittentFailure,
  runRpcLatency,
} from "./index.js";

async function listen(
  server: Server,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not start.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function rpc(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly json: Record<string, unknown>;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    status: response.status,
    headers: response.headers,
    json: (await response.json()) as Record<string, unknown>,
  };
}

describe("local RPC proxy", () => {
  it("forwards a JSON-RPC request and preserves its response ID", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 7, result: "0x10" }));
      }),
    );
    const proxy = new RpcProxy({ upstreamUrl: upstream.url });
    const address = await proxy.start();

    const result = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 7,
      method: "eth_blockNumber",
    });

    expect(result.json).toEqual({ jsonrpc: "2.0", id: 7, result: "0x10" });
    expect(proxy.evidence[0]?.outcome).toBe("forwarded_success");
    expect(proxy.evidence[0]?.upstreamOrigin).toBe(upstream.url);
    await proxy.close();
    await upstream.close();
  });

  it("blocks exactly at blackout start and forwards exactly at blackout end", async () => {
    let now = 1_700_000_000_000;
    let forwarded = 0;
    const upstream = await listen(
      createServer((request, response) => {
        forwarded += 1;
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => now,
      blackout: { startOffsetMs: 100, durationMs: 100 },
    });
    const address = await proxy.start();

    now += 100;
    const blocked = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
    });
    now += 100;
    const restored = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
    });

    expect(blocked.json.error).toEqual({
      code: -32098,
      message: "BLOCKLAB injected RPC blackout.",
    });
    expect(restored.json.result).toBe("0x1");
    expect(forwarded).toBe(1);
    expect(proxy.evidence.map((entry) => entry.outcome)).toEqual([
      "injected_blackout",
      "forwarded_success",
    ]);
    await proxy.close();
    await upstream.close();
  });

  it("rejects malformed, batched, unsupported, oversized, and credentialed requests", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end("{}");
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      requestBodyLimitBytes: 200,
    });
    const address = await proxy.start();

    const invalidJson = await fetch(address.url, {
      method: "POST",
      body: "{",
    });
    const batch = await rpc(address.url, [
      { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
    ]);
    const unsupported = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_sendRawTransaction",
    });
    const oversized = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "eth_chainId",
      params: ["x".repeat(300)],
    });

    expect(invalidJson.status).toBe(400);
    expect(batch.status).toBe(400);
    expect(unsupported.json.error).toMatchObject({ code: -32601 });
    expect(oversized.status).toBe(413);
    expect(
      () => new RpcProxy({ upstreamUrl: "http://user:pass@127.0.0.1:8545" }),
    ).toThrow(PreflightError);
    await proxy.close();
    await upstream.close();
  });

  it("returns a bounded timeout without exposing the upstream URL", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        setTimeout(() => response.end(JSON.stringify({ result: "late" })), 100);
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: `${upstream.url}/rpc?redaction-marker=not-stored`,
      upstreamTimeoutMs: 10,
    });
    const address = await proxy.start();

    const result = await rpc(address.url, {
      jsonrpc: "2.0",
      id: "x",
      method: "eth_chainId",
    });

    expect(result.json.error).toMatchObject({ code: -32001 });
    expect(JSON.stringify(proxy.evidence)).not.toContain("not-stored");
    expect(proxy.evidence[0]?.outcome).toBe("upstream_timeout");
    await proxy.close();
    await upstream.close();
  });

  it("adds the configured delay only inside the half-open fault interval", async () => {
    let now = Date.now();
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => now,
      latency: {
        delayMs: 40,
        startOffsetMs: 100,
        durationMs: 100,
      },
    });
    const address = await proxy.start();
    const request = (): Promise<Response> =>
      fetch(address.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId" }),
      });

    const baselineStart = Date.now();
    await request();
    void baselineStart;
    now += 100;
    const faultStart = Date.now();
    await request();
    const faultElapsed = Date.now() - faultStart;
    now += 100;
    const recoveryStart = Date.now();
    await request();
    const recoveryElapsed = Date.now() - recoveryStart;

    expect(faultElapsed).toBeGreaterThan(recoveryElapsed + 20);
    expect(faultElapsed).not.toBeLessThan(recoveryElapsed + 20);
    expect(proxy.evidence.map((entry) => entry.injected)).toEqual([
      false,
      true,
      false,
    ]);
    expect(proxy.evidence[1]?.injectedDelayMs).toBe(40);
    await proxy.close();
    await upstream.close();
  });

  it("keeps delayed requests independent and preserves JSON-RPC IDs", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 99, result: "0x2" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      latency: {
        delayMs: 30,
        startOffsetMs: 0,
        durationMs: 1_000,
      },
    });
    const address = await proxy.start();
    const send = async (id: number): Promise<Record<string, unknown>> => {
      const response = await rpc(address.url, {
        jsonrpc: "2.0",
        id,
        method: "eth_chainId",
      });
      return response.json;
    };
    const started = Date.now();
    const results = await Promise.all([send(11), send(12)]);
    expect(Date.now() - started).toBeLessThan(200);
    expect(results.map((result) => result.result)).toEqual(["0x2", "0x2"]);
    expect(proxy.evidence.map((entry) => entry.requestId).sort()).toEqual([
      11, 12,
    ]);
    await proxy.close();
    await upstream.close();
  });

  it("cancels a request while it is waiting in the injected delay", async () => {
    let forwarded = 0;
    let delayStarted!: () => void;
    const waitingForDelay = new Promise<void>((resolve) => {
      delayStarted = resolve;
    });
    let clockCalls = 0;
    const upstream = await listen(
      createServer((request, response) => {
        forwarded += 1;
        request.resume();
        response.end("{}");
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => {
        clockCalls += 1;
        if (clockCalls === 3) delayStarted();
        return Date.now();
      },
      latency: { delayMs: 1_000, startOffsetMs: 0, durationMs: 2_000 },
    });
    const address = await proxy.start();
    const pending = rpc(address.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "eth_chainId",
    });
    pending.catch(() => undefined);
    await waitingForDelay;
    await proxy.close();
    const result = await pending;
    expect(result.json.error).toMatchObject({ code: -32003 });
    expect(forwarded).toBe(0);
    expect(proxy.evidence.at(-1)?.errorCategory).toBe("proxy");
    await upstream.close();
  });

  it("cleans up the latency proxy when the experiment times out", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end("{}");
      }),
    );
    let activeProxy: RpcProxy | undefined;
    const handle = runRpcLatency(
      {
        execution: { scenarioId: "rpc-latency", timeoutMs: 30 },
        proxy: {
          upstreamUrl: upstream.url,
          latency: { delayMs: 1_000, startOffsetMs: 0, durationMs: 2_000 },
        },
      },
      async (proxy, context) => {
        activeProxy = proxy;
        const address = proxy.listeningAddress;
        if (address === undefined) throw new Error("Proxy did not start.");
        await fetch(address.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "eth_chainId",
          }),
          signal: context.cancellationSignal,
        }).catch(() => undefined);
        await context.waitForInterruption();
      },
    );
    const result = await handle.result;
    expect(result.state).toBe("timed_out");
    expect(activeProxy?.listeningAddress).toBeDefined();
    await expect(
      fetch(activeProxy?.listeningAddress?.url ?? ""),
    ).rejects.toThrow();
    await upstream.close();
  });
  it("categorizes an unavailable upstream without opening an external target", async () => {
    const proxy = new RpcProxy({
      upstreamUrl: "http://127.0.0.1:1",
      upstreamTimeoutMs: 100,
    });
    const address = await proxy.start();

    const result = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 9,
      method: "eth_chainId",
    });

    expect(result.json.error).toMatchObject({ code: -32002 });
    expect(proxy.evidence[0]?.outcome).toBe("upstream_unavailable");
    await proxy.close();
  });

  it("closes through the execution cleanup path on cancellation", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end("{}");
      }),
    );
    let activeProxy: RpcProxy | undefined;
    const handle = runRpcBlackout(
      {
        execution: { scenarioId: "rpc-blackout", timeoutMs: 500 },
        proxy: { upstreamUrl: upstream.url },
      },
      async (proxy, context) => {
        activeProxy = proxy;
        await new Promise<void>((resolve) => {
          context.cancellationSignal.addEventListener(
            "abort",
            () => resolve(),
            { once: true },
          );
        });
        throw new ExecutionCancelledError();
      },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    handle.context.requestCancellation();
    const result = await handle.result;
    expect(result.state).toBe("cancelled");
    expect(activeProxy?.listeningAddress).toBeDefined();
    await expect(
      fetch(activeProxy?.listeningAddress?.url ?? ""),
    ).rejects.toThrow();
    await upstream.close();
  });

  it("injects intermittent failures at exact boundaries and recovers between cycles", async () => {
    let now = 0;
    let forwarded = 0;
    const upstream = await listen(
      createServer((request, response) => {
        forwarded += 1;
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => now,
      intermittent: {
        startOffsetMs: 100,
        failureDurationMs: 50,
        recoveryIntervalMs: 50,
        windowCount: 2,
      },
    });
    const address = await proxy.start();

    const outcomes: string[] = [];
    const statuses: number[] = [];
    const faultBodies: Record<string, unknown>[] = [];
    for (const [timestamp, id] of [
      [99, 1],
      [100, 2],
      [149, 3],
      [150, 4],
      [199, 5],
      [200, 6],
      [249, 7],
      [250, 8],
    ] as const) {
      now = timestamp;
      const result = await rpc(address.url, {
        jsonrpc: "2.0",
        id,
        method: "eth_chainId",
      });
      statuses.push(result.status);
      outcomes.push(
        result.json.error === undefined
          ? "forwarded_success"
          : "injected_failure",
      );
      if (result.json.error !== undefined) faultBodies.push(result.json);
    }

    expect(outcomes).toEqual([
      "forwarded_success",
      "injected_failure",
      "injected_failure",
      "forwarded_success",
      "forwarded_success",
      "injected_failure",
      "injected_failure",
      "forwarded_success",
    ]);
    expect(statuses).toEqual([200, 503, 503, 200, 200, 503, 503, 200]);
    expect(faultBodies).toEqual([
      {
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32097,
          message: "BLOCKLAB injected intermittent RPC failure.",
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32097,
          message: "BLOCKLAB injected intermittent RPC failure.",
        },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        error: {
          code: -32097,
          message: "BLOCKLAB injected intermittent RPC failure.",
        },
      },
      {
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32097,
          message: "BLOCKLAB injected intermittent RPC failure.",
        },
      },
    ]);
    expect(proxy.evidence.map((entry) => entry.outcome)).toEqual([
      "forwarded_success",
      "injected_failure",
      "injected_failure",
      "forwarded_success",
      "forwarded_success",
      "injected_failure",
      "injected_failure",
      "forwarded_success",
    ]);
    expect(proxy.evidence.filter((entry) => entry.injected)).toHaveLength(4);
    expect(forwarded).toBe(4);
    await proxy.close();
    await upstream.close();
  });

  it("enforces the exact quota, Retry-After, and reset boundary without retrying", async () => {
    let now = 0;
    let forwarded = 0;
    const upstream = await listen(
      createServer((request, response) => {
        forwarded += 1;
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => now,
      rateLimit: { maxRequests: 2, windowMs: 100, retryAfterSeconds: 2 },
    });
    const address = await proxy.start();

    const first = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
    });
    const second = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_chainId",
    });
    const third = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 3,
      method: "eth_chainId",
    });
    now = 100;
    const fourth = await rpc(address.url, {
      jsonrpc: "2.0",
      id: 4,
      method: "eth_chainId",
    });

    expect(first.json.result).toBe("0x1");
    expect(second.json.result).toBe("0x1");
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("2");
    expect(third.json.error).toMatchObject({ code: -32005 });
    expect(fourth.json.result).toBe("0x1");
    expect(proxy.evidence.map((entry) => entry.outcome)).toEqual([
      "forwarded_success",
      "forwarded_success",
      "rate_limited",
      "forwarded_success",
    ]);
    expect(forwarded).toBe(3);
    expect(proxy.evidence).toHaveLength(4);
    await proxy.close();
    await upstream.close();
  });

  it("records every concurrent intermittent failure at the active window boundary", async () => {
    let now = 0;
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      now: () => now,
      intermittent: {
        startOffsetMs: 100,
        failureDurationMs: 50,
        recoveryIntervalMs: 50,
        windowCount: 2,
      },
    });
    const address = await proxy.start();
    now = 100;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, id) =>
        rpc(address.url, {
          jsonrpc: "2.0",
          id,
          method: "eth_chainId",
        }),
      ),
    );

    expect(results.map((result) => result.status)).toEqual([
      503, 503, 503, 503, 503,
    ]);
    for (const result of results) {
      expect(result.json.error).toMatchObject({ code: -32097 });
    }
    expect(proxy.evidence).toHaveLength(5);
    expect(
      proxy.evidence.every((entry) => entry.outcome === "injected_failure"),
    ).toBe(true);
    expect(proxy.evidence.every((entry) => entry.injected)).toBe(true);
    await proxy.close();
    await upstream.close();
  });

  it("applies rate quota atomically to concurrent requests without retrying or queueing", async () => {
    let forwarded = 0;
    const upstream = await listen(
      createServer((request, response) => {
        forwarded += 1;
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    const proxy = new RpcProxy({
      upstreamUrl: upstream.url,
      rateLimit: { maxRequests: 3, windowMs: 1_000, retryAfterSeconds: 1 },
    });
    const address = await proxy.start();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, id) =>
        rpc(address.url, {
          jsonrpc: "2.0",
          id,
          method: "eth_chainId",
        }),
      ),
    );

    expect(results.filter((result) => result.status === 200)).toHaveLength(3);
    expect(results.filter((result) => result.status === 429)).toHaveLength(5);
    expect(
      results
        .filter((result) => result.status === 429)
        .every((result) => result.headers.get("retry-after") === "1"),
    ).toBe(true);
    expect(forwarded).toBe(3);
    expect(proxy.evidence).toHaveLength(8);
    expect(
      proxy.evidence.filter((entry) => entry.outcome === "rate_limited"),
    ).toHaveLength(5);
    await proxy.close();
    await upstream.close();
  });

  it("cancels intermittent-failure execution and closes its proxy", async () => {
    const upstream = await listen(
      createServer((request, response) => {
        request.resume();
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      }),
    );
    let resolveProxyStarted: (url: string) => void = () => {
      throw new Error("Proxy-start promise was not initialized.");
    };
    const proxyStarted = new Promise<string>((resolve) => {
      resolveProxyStarted = resolve;
    });
    const handle = runRpcIntermittentFailure(
      {
        execution: {
          scenarioId: "rpc-intermittent-failure",
          timeoutMs: 1_000,
        },
        proxy: {
          upstreamUrl: upstream.url,
          intermittent: {
            startOffsetMs: 0,
            failureDurationMs: 500,
            recoveryIntervalMs: 100,
            windowCount: 1,
          },
        },
      },
      async (proxy, context) => {
        const address = proxy.listeningAddress;
        if (address === undefined) throw new Error("Proxy did not start.");
        resolveProxyStarted(address.url);
        await rpc(address.url, {
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
        });
        await new Promise<void>((resolve) => {
          context.cancellationSignal.addEventListener(
            "abort",
            () => resolve(),
            { once: true },
          );
        });
        throw new ExecutionCancelledError();
      },
    );
    const address = await proxyStarted;
    handle.context.requestCancellation();
    expect((await handle.result).state).toBe("cancelled");
    await expect(
      fetch(address, { method: "POST", body: "{}" }),
    ).rejects.toThrow();
    await upstream.close();
  });

  it.each(["connection-reset", "premature-close"] as const)(
    "injects %s transport failures without forwarding and recovers",
    async (mode) => {
      let now = 0;
      let forwarded = 0;
      const upstream = await listen(
        createServer((request, response) => {
          forwarded += 1;
          request.resume();
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }),
          );
        }),
      );
      const proxy = new RpcProxy({
        upstreamUrl: upstream.url,
        now: () => now,
        connectionFailure: {
          faultMode: mode,
          startOffsetMs: 100,
          durationMs: 100,
        },
      });
      const address = await proxy.start();

      now = 99;
      const before = await rpc(address.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
      });
      now = 100;
      await expect(
        rpc(address.url, {
          jsonrpc: "2.0",
          id: 2,
          method: "eth_chainId",
        }),
      ).rejects.toMatchObject({ name: "TypeError" });
      now = 200;
      const after = await rpc(address.url, {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_chainId",
      });

      expect(before.json.result).toBe("0x1");
      expect(after.json.result).toBe("0x1");
      expect(proxy.evidence.map((entry) => entry.outcome)).toEqual([
        "forwarded_success",
        "injected_connection_failure",
        "forwarded_success",
      ]);
      expect(proxy.evidence[1]).toMatchObject({
        injected: true,
        faultMode: mode,
        errorCategory: "connection_failure",
      });
      expect(forwarded).toBe(2);

      await proxy.close();
      await upstream.close();
    },
  );

  it.each([
    ["invalid-json", '{"jsonrpc": "2.0", broken'],
    ["missing-version", '{"id":1,"result":"0x1"}'],
    ["missing-result-and-error", '{"jsonrpc":"2.0","id":1}'],
    ["missing-id", '{"jsonrpc":"2.0","result":"0x1"}'],
    ["mismatched-id", '{"jsonrpc":"2.0","id":100000,"result":"0x1"}'],
    ["invalid-structure", '["not-a-jsonrpc-object"]'],
  ] as const)(
    "returns exact %s malformed content only inside the fault window",
    async (faultMode, expectedBody) => {
      let now = 0;
      let forwarded = 0;
      const upstream = await listen(
        createServer((request, response) => {
          forwarded += 1;
          request.resume();
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }),
          );
        }),
      );
      const proxy = new RpcProxy({
        upstreamUrl: upstream.url,
        now: () => now,
        malformed: {
          faultMode,
          startOffsetMs: 100,
          durationMs: 100,
        },
      });
      const address = await proxy.start();

      const send = async (id: number): Promise<Response> =>
        fetch(address.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_chainId" }),
        });
      now = 99;
      const before = await send(1);
      expect(await before.text()).toBe(
        '{"jsonrpc":"2.0","id":1,"result":"0x1"}',
      );
      now = 100;
      const faulty = await send(1);
      const responseText = await faulty.text();
      expect(faulty.status).toBe(200);
      expect(faulty.headers.get("content-type")).toBe("application/json");
      expect(responseText).toBe(expectedBody);
      if (faultMode === "invalid-json") {
        expect(() => JSON.parse(responseText)).toThrow();
      } else {
        expect(JSON.parse(responseText)).toEqual(JSON.parse(expectedBody));
      }
      now = 200;
      const after = await send(2);
      expect(await after.text()).toBe(
        '{"jsonrpc":"2.0","id":1,"result":"0x1"}',
      );
      expect(after.status).toBe(200);
      expect(forwarded).toBe(2);
      expect(proxy.evidence.map((entry) => entry.outcome)).toEqual([
        "forwarded_success",
        "injected_malformed_response",
        "forwarded_success",
      ]);
      expect(proxy.evidence[1]).toMatchObject({
        injected: true,
        faultMode,
        errorCategory: "malformed_response",
      });

      await proxy.close();
      await upstream.close();
    },
  );
});
