import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import {
  ExecutionCancelledError,
  PreflightError,
  RpcProxy,
  runRpcBlackout,
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
): Promise<{
  readonly status: number;
  readonly json: Record<string, unknown>;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
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
});
