import { describe, expect, it, vi } from "vitest";
import {
  AnonRpcSession,
  SUPPORTED_METHODS,
  type WorkerLike,
} from "./harness.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function worker(overrides: Partial<WorkerLike> = {}): WorkerLike {
  return {
    ready: Promise.resolve(),
    fetch: vi.fn(async () =>
      response({ jsonrpc: "2.0", id: 1, result: "0x1" }),
    ),
    close: vi.fn(),
    ...overrides,
  };
}

const options = {
  endpoint: "https://rpc.example",
  bootstrapRpcUrl: "https://bootstrap.example",
  workerAddress: "0x0000000000000000000000000000000000000001",
};

describe("AnonRpcSession", () => {
  it("awaits readiness and forwards supported read-only methods through the worker", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const instance = worker({ ready });
    const session = new AnonRpcSession({
      ...options,
      workerFactory: () => instance,
    });
    const initializing = session.initialize();
    expect(session.ready).toBe(false);
    resolveReady();
    await initializing;
    expect(session.ready).toBe(true);
    const observation = await session.request("eth_getBalance");
    expect(observation).toMatchObject({
      method: "eth_getBalance",
      success: true,
      harnessReady: true,
      receivedThroughHarness: true,
    });
    expect(instance.fetch).toHaveBeenCalledOnce();
    session.close();
    expect(instance.close).toHaveBeenCalledOnce();
  });

  it("does not create another worker for repeated initialization", async () => {
    const instances = [worker(), worker()];
    const factory = vi
      .fn()
      .mockImplementationOnce(() => instances[0])
      .mockImplementationOnce(() => instances[1]);
    const session = new AnonRpcSession({
      ...options,
      workerFactory: factory,
    });
    await session.initialize();
    await session.initialize();
    expect(factory).toHaveBeenCalledOnce();
    session.close();
    await session.initialize();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the worker fails", async () => {
    const instance = worker({
      ready: Promise.reject(new Error("worker failed")),
    });
    const session = new AnonRpcSession({
      ...options,
      workerFactory: () => instance,
    });
    await expect(session.initialize()).rejects.toThrow("worker failed");
    expect(instance.close).toHaveBeenCalledOnce();
  });

  it("collects worker logs and stops collecting them during cleanup", async () => {
    const acceptLog = vi
      .fn()
      .mockResolvedValueOnce({ level: "info", args: ["ready"] })
      .mockImplementation(
        ({ signal }: { signal?: AbortSignal } = {}) =>
          new Promise((_, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
    const instance = worker({ acceptLog });
    const session = new AnonRpcSession({
      ...options,
      workerFactory: () => instance,
    });
    await session.initialize();
    await vi.waitFor(() => expect(session.logs).toHaveLength(1));
    session.close();
    expect(acceptLog).toHaveBeenCalled();
  });

  it("reports harness request failures distinctly and redacts request details", async () => {
    const instance = worker({
      fetch: vi.fn(async () => {
        throw new Error("worker request failed");
      }),
    });
    const session = new AnonRpcSession({
      ...options,
      workerFactory: () => instance,
    });
    await session.initialize();
    const observation = await session.request("eth_call");
    expect(observation).toMatchObject({
      success: false,
      errorCategory: "harness",
      receivedThroughHarness: false,
    });
    expect(JSON.stringify(observation)).not.toContain(
      "0000000000000000000000000000000000000000",
    );
  });

  it("keeps the read-only method allowlist explicit", () => {
    expect(SUPPORTED_METHODS).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBalance",
      "eth_call",
    ]);
  });
});
