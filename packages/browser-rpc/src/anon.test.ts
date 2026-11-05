import { describe, expect, it, vi } from "vitest";
import {
  AnonRpcTransport,
  type WorkerInitLike,
  type WorkerInstance,
} from "./anon.js";
import { BrowserRpcError, findWorker, OFFICIAL_WORKERS } from "./types.js";

const endpoint = "https://rpc.example.test";
const passthrough = findWorker("passthrough");
const torJs = findWorker("tor-js");

if (passthrough === undefined || torJs === undefined) {
  throw new Error("official worker registry is missing an entry");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createWorker(
  overrides: Partial<WorkerInstance> = {},
): WorkerInstance & { closed: ReturnType<typeof vi.fn> } {
  const closed = vi.fn();
  const fetchSpy = vi.fn(async () =>
    jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x1" }),
  );
  return {
    ready: Promise.resolve(),
    fetch: fetchSpy,
    acceptLog: () =>
      new Promise<never>(() => {
        // Never resolves: the transport aborts collection on close.
      }),
    close: closed,
    ...overrides,
  } as WorkerInstance & { closed: ReturnType<typeof vi.fn> };
}

function makeTransport(
  worker: WorkerInstance,
  options: Partial<ConstructorParameters<typeof AnonRpcTransport>[0]> = {},
): {
  transport: AnonRpcTransport;
  factory: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
} {
  const factory = vi.fn((_init: WorkerInitLike) => worker);
  const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1" }));
  const transport = new AnonRpcTransport({
    endpoint,
    worker: passthrough,
    bootstrapRpcUrl: endpoint,
    workerFactory: factory,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...options,
  });
  return { transport, factory, fetchImpl };
}

describe("AnonRpcTransport lifecycle", () => {
  it("never performs a request before the worker is ready", async () => {
    const worker = createWorker();
    const { transport, fetchImpl } = makeTransport(worker);

    const observation = await transport.request("eth_chainId");

    expect(observation.success).toBe(false);
    expect(observation.errorCategory).toBe("not-ready");
    expect(observation.receivedThroughHarness).toBe(false);
    expect(worker.fetch).not.toHaveBeenCalled?.();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("becomes ready and reports harness-related observations", async () => {
    const worker = createWorker();
    const { transport, factory } = makeTransport(worker);

    expect(transport.state).toBe("idle");
    await transport.initialize();
    expect(transport.state).toBe("ready");
    expect(transport.label).toBe("Anon-RPC reference worker");
    expect(factory).toHaveBeenCalledOnce();

    const observation = await transport.request("eth_blockNumber");
    expect(observation.success).toBe(true);
    expect(observation.route).toBe("anon-rpc");
    expect(observation.workerId).toBe("passthrough");
    expect(observation.workerKind).toBe("reference");
    expect(observation.harnessReady).toBe(true);
    expect(observation.receivedThroughHarness).toBe(true);
  });

  it("labels a network worker differently from a reference worker", async () => {
    const worker = createWorker();
    const { transport } = makeTransport(worker, { worker: torJs });
    await transport.initialize();
    const observation = await transport.request("eth_chainId");
    expect(transport.label).toBe("Anon-RPC network worker");
    expect(observation.workerKind).toBe("network");
  });

  it("does not create a second worker when initialize is called twice", async () => {
    const worker = createWorker();
    const { transport, factory } = makeTransport(worker);

    await Promise.all([transport.initialize(), transport.initialize()]);
    await transport.initialize();

    expect(factory).toHaveBeenCalledOnce();
    expect(worker.close).not.toHaveBeenCalled();
  });

  it("closes the sandbox and never falls back when initialization fails", async () => {
    const worker = createWorker({
      ready: Promise.reject(new Error("specifier read failed")),
    });
    const { transport, fetchImpl } = makeTransport(worker);

    await expect(transport.initialize()).rejects.toThrow(BrowserRpcError);
    expect(transport.state).toBe("failed");
    expect(worker.close).toHaveBeenCalledOnce();

    fetchImpl.mockClear();
    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("not-ready");
    expect(observation.receivedThroughHarness).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries initialization after a failure without leaking the old worker", async () => {
    let attempt = 0;
    const broken = createWorker({
      ready: Promise.reject(new Error("boot failure")),
    });
    const healthy = createWorker();
    const factory = vi.fn(() => {
      attempt += 1;
      return attempt === 1 ? broken : healthy;
    });
    const transport = new AnonRpcTransport({
      endpoint,
      worker: passthrough,
      bootstrapRpcUrl: endpoint,
      workerFactory: factory,
      fetchImpl: (async () =>
        jsonResponse({ result: "0x1" })) as unknown as typeof fetch,
    });

    await expect(transport.initialize()).rejects.toThrow();
    await transport.initialize();

    expect(transport.state).toBe("ready");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(broken.close).toHaveBeenCalledOnce();
  });

  it("times out readiness, closes the worker, and reports a timeout", async () => {
    const worker = createWorker({ ready: new Promise<void>(() => {}) });
    const { transport } = makeTransport(worker, {
      initializationTimeoutMs: 10,
    });

    await expect(transport.initialize()).rejects.toMatchObject({
      category: "timeout",
    });
    expect(transport.state).toBe("failed");
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it("supports cancellation during initialization", async () => {
    const worker = createWorker({ ready: new Promise<void>(() => {}) });
    const { transport } = makeTransport(worker);
    const controller = new AbortController();
    const pending = transport.initialize(controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BrowserRpcError);
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it("closes the worker once and refuses further requests", async () => {
    const worker = createWorker();
    const { transport } = makeTransport(worker);
    await transport.initialize();

    transport.close();
    transport.close();

    expect(transport.state).toBe("closed");
    expect(worker.close).toHaveBeenCalledOnce();
    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("not-ready");
  });

  it("stays closed when closed during initialization", async () => {
    let rejectReady: (error: unknown) => void = () => {};
    const ready = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    const worker = createWorker({ ready });
    const { transport } = makeTransport(worker);

    const pending = transport.initialize();
    transport.close();
    rejectReady(new Error("sandbox torn down"));

    await expect(pending).rejects.toBeInstanceOf(BrowserRpcError);
    expect(transport.state).toBe("closed");
  });

  it("counts worker log entries without retaining their contents", async () => {
    let calls = 0;
    const worker = createWorker({
      acceptLog: (opts) => {
        calls += 1;
        if (calls <= 3)
          return Promise.resolve({ level: "info", args: ["boot"] });
        return new Promise<never>((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
    });
    const { transport } = makeTransport(worker);
    await transport.initialize();
    await vi.waitFor(() => expect(transport.logCount).toBe(3));
    transport.close();
    expect(transport.logCount).toBe(3);
  });
});

describe("AnonRpcTransport error handling", () => {
  it("maps harness fetch failures to the worker category, not connection", async () => {
    const worker = createWorker({
      fetch: async () => {
        throw new TypeError("worker died");
      },
    });
    const { transport } = makeTransport(worker);
    await transport.initialize();

    const observation = await transport.request("eth_chainId");
    expect(observation.errorCategory).toBe("worker");
    expect(observation.receivedThroughHarness).toBe(false);
    expect(observation.success).toBe(false);
  });

  it("keeps upstream JSON-RPC errors distinguishable from harness errors", async () => {
    const worker = createWorker({
      fetch: async () =>
        jsonResponse({ error: { code: -32601, message: "nope" } }),
    });
    const { transport } = makeTransport(worker);
    await transport.initialize();

    const observation = await transport.request("eth_call");
    expect(observation.errorCategory).toBe("json-rpc");
    expect(observation.receivedThroughHarness).toBe(true);
  });

  it("fails initialization when the bootstrap provider errors", async () => {
    const factory = vi.fn(
      (init: WorkerInitLike) =>
        ({
          ready: (async () => {
            await init.preExisting?.rpcProvider?.request({
              method: "eth_call",
              params: [{ to: passthrough.specifier, data: "0x" }, "latest"],
            });
          })(),
          fetch: async () => jsonResponse({ result: "0x1" }),
          close: vi.fn(),
        }) satisfies WorkerInstance,
    );
    const fetchImpl = vi.fn(async () => jsonResponse({}, 502));
    const transport = new AnonRpcTransport({
      endpoint,
      worker: passthrough,
      bootstrapRpcUrl: endpoint,
      workerFactory: factory,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.initialize()).rejects.toThrow(/HTTP 502/);
    expect(transport.state).toBe("failed");
  });

  it("rejects wallet, transaction, and unknown methods", async () => {
    const worker = createWorker();
    const { transport } = makeTransport(worker);
    await transport.initialize();

    await expect(
      transport.request("eth_sendTransaction" as never),
    ).rejects.toMatchObject({ category: "unsupported-method" });
    await expect(transport.request("eth_sign" as never)).rejects.toThrow(
      /wallet or transaction/,
    );
    await expect(transport.request("debug_traceCall" as never)).rejects.toThrow(
      /allowlist/,
    );
    expect(worker.fetch).not.toHaveBeenCalled?.();
  });

  it("rejects an invalid worker specifier at construction", () => {
    expect(
      () =>
        new AnonRpcTransport({
          endpoint,
          bootstrapRpcUrl: endpoint,
          worker: { ...passthrough, specifier: "0x1234" },
        }),
    ).toThrow(/20-byte address/);
  });
});

describe("official worker registry", () => {
  it("contains the documented adopter workers with their chains", () => {
    expect(OFFICIAL_WORKERS.map((worker) => worker.id)).toEqual([
      "passthrough",
      "tor-js",
      "nym",
      "nox",
    ]);
    expect(passthrough.kind).toBe("reference");
    expect(torJs.kind).toBe("network");
    expect(
      OFFICIAL_WORKERS.find((worker) => worker.id === "nox")?.chainId,
    ).toBe(11155111);
  });
});
