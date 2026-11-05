import { describe, expect, it } from "vitest";
import { buildComparison, runWorkload, summarizeRoute } from "./compare.js";
import {
  READ_ONLY_METHODS,
  type ReadOnlyMethod,
  type RpcObservation,
  type RpcTransport,
  type TransportState,
} from "./types.js";

function observation(
  method: ReadOnlyMethod,
  overrides: Partial<RpcObservation> = {},
): RpcObservation {
  const startedAt = "2026-11-05T10:00:00.000Z";
  return {
    route: "direct",
    method,
    startedAt,
    endedAt: startedAt,
    durationMs: 10,
    success: true,
    harnessReady: false,
    receivedThroughHarness: false,
    ...overrides,
  };
}

function fakeTransport(
  route: "direct" | "anon-rpc",
  observations: readonly RpcObservation[],
  state: TransportState = "ready",
): RpcTransport {
  let index = 0;
  return {
    route,
    label: route === "direct" ? "Direct RPC" : "Anon-RPC reference worker",
    state,
    initialize: async () => {},
    request: async () => {
      const value = observations[index];
      index += 1;
      if (value === undefined) throw new Error("workload exhausted");
      return value;
    },
    close: () => {},
  };
}

describe("runWorkload", () => {
  it("runs the allowlisted methods in a fixed order", async () => {
    const results = await runWorkload(
      fakeTransport(
        "direct",
        READ_ONLY_METHODS.map((method) => observation(method)),
      ),
    );
    expect(results.map((result) => result.method)).toEqual([
      ...READ_ONLY_METHODS,
    ]);
  });

  it("stops when the workload is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const results = await runWorkload(
      fakeTransport("direct", [observation("eth_chainId")]),
      { signal: controller.signal },
    );
    expect(results).toEqual([]);
  });
});

describe("summarizeRoute", () => {
  it("computes success rate, latency, and harness routing", () => {
    const transport = fakeTransport("anon-rpc", [], "ready");
    const summary = summarizeRoute({
      transport,
      observations: [
        observation("eth_chainId", {
          route: "anon-rpc",
          workerId: "passthrough",
          workerKind: "reference",
          harnessReady: true,
          receivedThroughHarness: true,
          durationMs: 100,
        }),
        observation("eth_blockNumber", {
          route: "anon-rpc",
          workerId: "passthrough",
          workerKind: "reference",
          harnessReady: true,
          receivedThroughHarness: true,
          durationMs: 300,
        }),
        observation("eth_call", {
          route: "anon-rpc",
          harnessReady: true,
          receivedThroughHarness: true,
          success: false,
          errorCategory: "json-rpc",
          durationMs: 200,
        }),
      ],
      initialized: true,
    });

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.successRatePct).toBeCloseTo(66.7, 1);
    expect(summary.averageLatencyMs).toBe(200);
    expect(summary.harnessRouted).toBe(3);
    expect(summary.workerId).toBe("passthrough");
    expect(summary.workerKind).toBe("reference");
  });

  it("handles an empty workload without inventing numbers", () => {
    const summary = summarizeRoute({
      transport: fakeTransport("direct", []),
      observations: [],
      initialized: true,
    });
    expect(summary.total).toBe(0);
    expect(summary.successRatePct).toBe(0);
    expect(summary.averageLatencyMs).toBeNull();
  });
});

describe("buildComparison", () => {
  const direct = summarizeRoute({
    transport: fakeTransport("direct", []),
    observations: READ_ONLY_METHODS.map((method) =>
      observation(method, { durationMs: 40 }),
    ),
    initialized: true,
  });

  it("states that latency is not a privacy measurement", () => {
    const comparison = buildComparison({ direct, anonRpc: null });
    expect(comparison.schemaVersion).toBe("1.0");
    expect(
      comparison.notes.some((note) => /not a measure of privacy/i.test(note)),
    ).toBe(true);
    expect(comparison.anonRpc).toBeNull();
    expect(comparison.coverage.routedMethods).toEqual([]);
    expect(comparison.coverage.coveragePct).toBe(0);
  });

  it("marks a reference worker as non-anonymizing", () => {
    const anonRpc = summarizeRoute({
      transport: fakeTransport("anon-rpc", []),
      observations: READ_ONLY_METHODS.map((method) =>
        observation(method, {
          route: "anon-rpc",
          workerId: "passthrough",
          workerKind: "reference",
          harnessReady: true,
          receivedThroughHarness: true,
          durationMs: 900,
        }),
      ),
      initialized: true,
    });

    const comparison = buildComparison({ direct, anonRpc });
    expect(
      comparison.notes.some((note) =>
        /reference passthrough worker/i.test(note),
      ),
    ).toBe(true);
    expect(comparison.notes.some((note) => /not anonymized/i.test(note))).toBe(
      true,
    );
    expect(comparison.coverage.routedMethods).toEqual([...READ_ONLY_METHODS]);
    expect(comparison.coverage.coveragePct).toBe(100);
    expect(comparison.coverage.excludedMethods).toContain(
      "eth_sendTransaction",
    );
  });

  it("describes network workers without claiming verified anonymity", () => {
    const anonRpc = summarizeRoute({
      transport: fakeTransport("anon-rpc", []),
      observations: READ_ONLY_METHODS.map((method) =>
        observation(method, {
          route: "anon-rpc",
          workerId: "tor-js",
          workerKind: "network",
          harnessReady: true,
          receivedThroughHarness: true,
        }),
      ),
      initialized: true,
    });
    const comparison = buildComparison({ direct, anonRpc });
    expect(
      comparison.notes.some((note) =>
        /not the network's anonymity properties/i.test(note),
      ),
    ).toBe(true);
  });

  it("records a failed initialization and zero routed coverage", () => {
    const anonRpc = summarizeRoute({
      transport: fakeTransport("anon-rpc", [], "failed"),
      observations: [
        observation("eth_chainId", {
          route: "anon-rpc",
          success: false,
          errorCategory: "not-ready",
        }),
      ],
      initialized: false,
      initializationError: "Worker did not become ready within 30000ms.",
    });

    const comparison = buildComparison({ direct, anonRpc });
    expect(comparison.anonRpc?.initialized).toBe(false);
    expect(comparison.coverage.routedMethods).toEqual([]);
    expect(
      comparison.notes.some((note) =>
        /no direct fallback occurred/i.test(note),
      ),
    ).toBe(true);
  });
});
