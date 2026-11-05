import { createPublicClient, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { AnonRpcTransport, type WorkerInitLike } from "./anon.js";
import { DirectRpcTransport } from "./direct.js";
import {
  BrowserRpcError,
  findWorker,
  type WorkerDescriptor,
  type WorkerInstance,
} from "./types.js";
import {
  BlocklabRpcError,
  type BlocklabViemRoute,
  createDirectViemRoute,
  createViemRoute,
  isBlocklabRpcError,
} from "./viem.js";

const endpoint = "https://rpc.example.test";
const passthrough = findWorker("passthrough");
const account = "0x00000000000000000000000000000000000000aa" as const;
const contract = "0x00000000000000000000000000000000000000bb" as const;

if (passthrough === undefined) {
  throw new Error("official worker registry is missing passthrough");
}
const passthroughWorker: WorkerDescriptor = passthrough;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Recorder {
  readonly fetchImpl: ReturnType<typeof vi.fn>;
  readonly bodies: Array<{ method: string; params?: unknown }>;
}

function recordingFetch(
  results: Record<string, unknown> = {},
  overrides: Partial<Record<string, unknown>> = {},
): Recorder {
  const bodies: Array<{ method: string; params?: unknown }> = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params?: unknown;
    };
    bodies.push(body);
    if (overrides[body.method] !== undefined) {
      return jsonResponse(overrides[body.method] as never);
    }
    const result =
      results[body.method] ??
      (body.method === "eth_chainId"
        ? "0x1"
        : body.method === "eth_blockNumber"
          ? "0x7b"
          : body.method === "eth_getBalance"
            ? "0x5"
            : "0x");
    return jsonResponse({ jsonrpc: "2.0", id: 1, result });
  });
  return { fetchImpl, bodies };
}

function makeDirectRoute(
  recorder: Recorder = recordingFetch(),
  adapter = {},
): BlocklabViemRoute {
  return createDirectViemRoute(
    { endpoint, fetchImpl: recorder.fetchImpl as unknown as typeof fetch },
    adapter,
  );
}

function createWorker(
  result: unknown = "0x1",
  overrides: Partial<WorkerInstance> = {},
): WorkerInstance {
  return {
    ready: Promise.resolve(),
    fetch: vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 1, result })),
    acceptLog: () =>
      new Promise<never>(() => {
        // Collection is aborted on close.
      }),
    close: vi.fn(),
    ...overrides,
  } as WorkerInstance;
}

function makeAnonRoute(
  worker: WorkerInstance,
  options: { requestTimeoutMs?: number } = {},
): {
  route: BlocklabViemRoute;
  factory: ReturnType<typeof vi.fn>;
  bootstrapFetch: ReturnType<typeof vi.fn>;
} {
  const factory = vi.fn((_init: WorkerInitLike) => worker);
  const bootstrapFetch = vi.fn(async () => jsonResponse({ result: "0x1" }));
  const route = createViemRoute(
    new AnonRpcTransport({
      endpoint,
      worker: passthroughWorker,
      bootstrapRpcUrl: endpoint,
      workerFactory: factory,
      fetchImpl: bootstrapFetch as unknown as typeof fetch,
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
    }),
  );
  return { route, factory, bootstrapFetch };
}

function makeClient(route: BlocklabViemRoute): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: route.transport,
    cacheTime: 0,
  });
}

describe("Viem adapter: direct route", () => {
  it("answers getChainId through a real Viem client", async () => {
    const recorder = recordingFetch();
    const client = makeClient(makeDirectRoute(recorder));

    await expect(client.getChainId()).resolves.toBe(1);
    expect(recorder.bodies).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
    ]);
  });

  it("returns bigint quantities and forwards getBalance parameters", async () => {
    const recorder = recordingFetch();
    const client = makeClient(makeDirectRoute(recorder));

    await expect(client.getBlockNumber()).resolves.toBe(123n);
    await expect(client.getBalance({ address: account })).resolves.toBe(5n);

    const balanceCall = recorder.bodies.find(
      (body) => body.method === "eth_getBalance",
    );
    expect(balanceCall?.params).toEqual([account, "latest"]);
  });

  it("supports a read-only contract call with caller parameters", async () => {
    const recorder = recordingFetch({ eth_call: "0x00000001" }, {});
    const client = makeClient(makeDirectRoute(recorder));

    const result = await client.call({
      to: contract,
      data: "0x18160ddd",
    });

    expect(result.data).toBe("0x00000001");
    const call = recorder.bodies.find((body) => body.method === "eth_call");
    const params = call?.params as [Record<string, unknown>, string];
    expect(params[0]).toMatchObject({ to: contract, data: "0x18160ddd" });
    expect(params[1]).toBe("latest");
  });

  it("never uses a Viem-level retry by default", async () => {
    const recorder = recordingFetch({}, {
      eth_blockNumber: { jsonrpc: "2.0", id: 1, error: { code: -32000 } },
    } as never);
    const route = makeDirectRoute(recorder);
    const client = makeClient(route);

    await expect(client.getBlockNumber()).rejects.toBeInstanceOf(
      BlocklabRpcError,
    );
    expect(
      recorder.bodies.filter((body) => body.method === "eth_blockNumber"),
    ).toHaveLength(1);
    expect(route.transport({ chain: mainnet }).config.retryCount).toBe(0);
  });
});

describe("Viem adapter: anon route", () => {
  it("lazily initializes, forwards calls, and stays on the harness", async () => {
    const worker = createWorker("0x1");
    const { route, factory, bootstrapFetch } = makeAnonRoute(worker);
    const client = makeClient(route);

    expect(route.state).toBe("idle");
    await expect(client.getChainId()).resolves.toBe(1);
    expect(factory).toHaveBeenCalledOnce();
    expect(route.state).toBe("ready");
    expect(worker.fetch).toHaveBeenCalledOnce();
    // Only the worker produced the response; the bootstrap fetch was untouched.
    expect(bootstrapFetch).not.toHaveBeenCalled();
  });

  it("shares one worker across multiple clients and requests", async () => {
    const worker = createWorker("0x7b");
    const { route, factory } = makeAnonRoute(worker);
    const first = makeClient(route);
    const second = makeClient(route);

    await expect(first.getBlockNumber()).resolves.toBe(123n);
    await expect(second.getBlockNumber()).resolves.toBe(123n);
    expect(factory).toHaveBeenCalledOnce();
    expect(worker.fetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces worker initialization failure without a direct fallback", async () => {
    const worker = createWorker("0x1", {
      ready: Promise.reject(new Error("specifier unavailable")),
    });
    const { route, bootstrapFetch } = makeAnonRoute(worker);
    const client = makeClient(route);

    const error = await client.getBlockNumber().catch((cause) => cause);

    expect(error).toBeInstanceOf(BlocklabRpcError);
    expect(error.category).toBe("initialization");
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(bootstrapFetch).not.toHaveBeenCalled();
  });

  it("refuses requests after close and never falls back", async () => {
    const worker = createWorker("0x1");
    const { route } = makeAnonRoute(worker);
    const client = makeClient(route);

    await expect(client.getChainId()).resolves.toBe(1);
    route.close();

    const error = await client.getBlockNumber().catch((cause) => cause);
    expect(error).toBeInstanceOf(BlocklabRpcError);
    expect(error.category).toBe("not-ready");
    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(worker.close).toHaveBeenCalled();
  });

  it("classifies a hung worker request as a timeout", async () => {
    const worker = createWorker("0x1", {
      // Behaves like real fetch: only settles when the request is aborted.
      fetch: vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(
                  Object.assign(new Error("aborted"), { name: "AbortError" }),
                );
              },
              { once: true },
            );
          }),
      ) as unknown as WorkerInstance["fetch"],
    });
    const { route } = makeAnonRoute(worker, { requestTimeoutMs: 25 });
    const client = makeClient(route);

    const error = await client.getChainId().catch((cause) => cause);
    expect(error).toBeInstanceOf(BlocklabRpcError);
    expect(error.category).toBe("timeout");
  });

  it("propagates a worker JSON-RPC error as a typed failure", async () => {
    const worker = createWorker("0x1", {
      fetch: vi.fn(async () =>
        jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32602, message: "invalid argument 0" },
        }),
      ),
    });
    const { route } = makeAnonRoute(worker);
    const client = makeClient(route);

    const error = await client
      .getBalance({ address: account })
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(BlocklabRpcError);
    expect(error.category).toBe("json-rpc");
    expect(error.message).toContain("-32602");
  });
});

describe("Viem adapter: allowlist and parameters", () => {
  it("rejects wallet methods before any network activity", async () => {
    const recorder = recordingFetch();
    const route = makeDirectRoute(recorder);
    const client = makeClient(route);

    const error = await client
      .request({ method: "eth_sendTransaction", params: [] })
      .catch((cause) => cause);

    expect(error).toBeInstanceOf(BlocklabRpcError);
    expect(error.category).toBe("unsupported-method");
    expect(recorder.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed balance and call parameters", async () => {
    const recorder = recordingFetch();
    const client = makeClient(makeDirectRoute(recorder));

    const badAddress = await client
      .request({ method: "eth_getBalance", params: ["0x12"] })
      .catch((cause) => cause);
    expect(badAddress.category).toBe("invalid-params");

    const stateOverride = await client
      .request({
        method: "eth_call",
        params: [{ to: contract, data: "0x" }, "latest", { [contract]: {} }],
      })
      .catch((cause) => cause);
    expect(stateOverride.category).toBe("invalid-params");

    const unknownField = await client
      .request({
        method: "eth_call",
        params: [{ to: contract, data: "0x", blobVersionedHashes: [] }],
      })
      .catch((cause) => cause);
    expect(unknownField.category).toBe("invalid-params");
    expect(recorder.fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes numeric block tags for caller-supplied parameters", async () => {
    const recorder = recordingFetch();
    const client = makeClient(makeDirectRoute(recorder));

    await client.request({
      method: "eth_getBalance",
      params: [account, "0x10"],
    });
    expect(recorder.bodies.at(-1)?.params).toEqual([account, "0x10"]);
  });

  it("exposes the transport identity and a timeout ceiling", () => {
    const route = makeDirectRoute();
    const resolved = route.transport({ chain: mainnet });

    expect(resolved.config.key).toBe("blocklab-direct");
    expect(resolved.config.type).toBe("blocklab");
    expect(resolved.config.timeout).toBeGreaterThan(route.instance.timeoutMs);
    expect(isBlocklabRpcError(new BrowserRpcError("timeout", "x"))).toBe(true);
    expect(isBlocklabRpcError(new Error("x"))).toBe(false);
  });

  it("delegates initialize and observations to the wrapped transport", async () => {
    const instance = new DirectRpcTransport({ endpoint });
    const route = createViemRoute(instance);
    await route.initialize();

    const observation = await route.request("eth_chainId");
    expect(observation.route).toBe("direct");
    expect(route.route).toBe("direct");
    expect(route.instance).toBe(instance);
  });
});
