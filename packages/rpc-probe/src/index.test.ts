import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeRpc } from "./index.js";

const servers: Server[] = [];

async function serverWith(
  handler: (
    body: string,
  ) =>
    | { status: number; body: string }
    | Promise<{ status: number; body: string }>,
): Promise<string> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const result = await handler(body);
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(result.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("RPC baseline probe", () => {
  it("records a successful JSON-RPC response", async () => {
    const url = await serverWith(() => ({
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x7b" }),
    }));
    const result = await probeRpc({ rpcUrl: url, method: "eth_blockNumber" });
    expect(result.success).toBe(true);
    expect(result.blockNumber).toBe(123);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("categorizes invalid JSON", async () => {
    const url = await serverWith(() => ({ status: 200, body: "{invalid" }));
    await expect(
      probeRpc({ rpcUrl: url, method: "eth_blockNumber" }),
    ).resolves.toMatchObject({ success: false, category: "json" });
  });

  it("categorizes JSON-RPC errors", async () => {
    const url = await serverWith(() => ({
      status: 200,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "unavailable" },
      }),
    }));
    await expect(
      probeRpc({ rpcUrl: url, method: "eth_blockNumber" }),
    ).resolves.toMatchObject({ success: false, category: "json-rpc" });
  });

  it("categorizes refused connections and timeouts", async () => {
    await expect(
      probeRpc({
        rpcUrl: "http://127.0.0.1:1",
        method: "eth_blockNumber",
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ success: false, category: "connection" });
    const url = await serverWith(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: 200, body: JSON.stringify({ result: "0x1" }) };
    });
    await expect(
      probeRpc({ rpcUrl: url, method: "eth_blockNumber", timeoutMs: 10 }),
    ).resolves.toMatchObject({ success: false, category: "timeout" });
  });

  it("rejects an unexpected chain ID", async () => {
    const url = await serverWith(() => ({
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    }));
    await expect(
      probeRpc({
        rpcUrl: url,
        method: "eth_chainId",
        expectedChainId: 31337,
      }),
    ).resolves.toMatchObject({ success: false, category: "invalid-chain-id" });
  });

  it("categorizes non-success HTTP responses", async () => {
    const url = await serverWith(() => ({ status: 503, body: "{}" }));
    await expect(
      probeRpc({ rpcUrl: url, method: "eth_blockNumber" }),
    ).resolves.toMatchObject({ success: false, category: "http" });
  });
});
