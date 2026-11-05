import { describe, expect, it } from "vitest";
import { parseStudioSnapshot } from "./model.js";
import {
  failedWorkerComparison,
  okComparison,
  partialComparison,
  referenceWorkload,
  snapshot,
  viemAnon,
  viemDirect,
} from "./test-fixtures.js";

function ready(value: unknown) {
  const state = parseStudioSnapshot(value);
  if (state.status !== "ready") {
    throw new Error(`expected a ready model, received ${state.status}`);
  }
  return state.model;
}

describe("Studio comparison model", () => {
  it("renders a valid snapshot with both routes measured", () => {
    const model = ready(
      snapshot(okComparison, { direct: viemDirect, anonRpc: viemAnon }),
    );

    expect(model.direct.ready).toBe(true);
    expect(model.anonRpc?.ready).toBe(true);
    expect(model.anonRpc?.workerId).toBe("tor-js");
    expect(model.methods).toHaveLength(4);
    expect(model.coverage.coveragePct).toBe(100);
    expect(model.viem?.direct.chainId).toBe(1);
    expect(model.viem?.anonRpc.blockNumber).toBe("26350477");
    expect(model.warnings).toEqual([]);
  });

  it("treats a missing payload as an empty state", () => {
    expect(parseStudioSnapshot(undefined).status).toBe("empty");
    expect(parseStudioSnapshot(null).status).toBe("empty");
  });

  it("rejects malformed payloads without substituting values", () => {
    expect(parseStudioSnapshot("nope").status).toBe("invalid");
    expect(parseStudioSnapshot({ schemaVersion: "0.9" }).status).toBe(
      "invalid",
    );
    expect(parseStudioSnapshot({ schemaVersion: "1.0" }).status).toBe(
      "invalid",
    );
    const missingDirect = parseStudioSnapshot({
      schemaVersion: "1.0",
      comparison: { anonRpc: null },
    });
    expect(missingDirect.status).toBe("invalid");
  });

  it("marks skipped methods instead of counting them as successful", () => {
    const model = ready(snapshot(partialComparison));

    expect(model.coverage.attempted).toBe(2);
    expect(model.coverage.succeeded).toBe(1);
    expect(model.coverage.failed).toBe(1);
    expect(model.coverage.skipped).toBe(2);
    expect(model.coverage.coveragePct).toBe(0);
    expect(model.coverage.denominator).toContain(
      "Skipped methods are not counted as successful",
    );

    const skipped = model.methods.find((row) => row.method === "eth_call");
    expect(skipped?.direct.attempted).toBe(false);
    expect(skipped?.direct.success).toBeNull();
  });

  it("distinguishes a passthrough reference worker from a network worker", () => {
    const reference = ready(
      snapshot({ ...okComparison, anonRpc: referenceWorkload }),
    );
    const network = ready(snapshot(okComparison));

    expect(reference.anonRpc?.workerDescription).toContain("not anonymizing");
    expect(network.anonRpc?.workerDescription).toContain(
      "declared anonymizing",
    );
    expect(reference.limitations.join(" ")).toContain("does not anonymize");
  });

  it("surfaces worker initialization failure without inventing routed requests", () => {
    const model = ready(snapshot(failedWorkerComparison));

    expect(model.anonRpc?.ready).toBe(false);
    expect(model.anonRpc?.state).toBe("failed");
    expect(model.anonRpc?.initializationError).toBe("short bytes32 return");
    expect(model.coverage.routedCount).toBe(0);
    expect(model.coverage.coveragePct).toBe(0);
    expect(model.summary).toContain("no fallback");
    expect(
      model.methods.every((row) => row.anonRpc.routedThroughHarness === false),
    ).toBe(true);
  });

  it("reports an unmeasured Anon-RPC route as absent", () => {
    const model = ready(snapshot(partialComparison));
    expect(model.anonRpc).toBeNull();
    expect(model.summary).toContain("Anon-RPC not measured");
    expect(model.methods.every((row) => row.anonRpc.attempted === false)).toBe(
      true,
    );
  });

  it("flags missing latency instead of rendering a zero", () => {
    const noLatency = {
      ...okComparison,
      direct: {
        ...okComparison.direct,
        attempts: [
          {
            method: "eth_chainId",
            success: true,
            receivedThroughHarness: false,
          },
        ],
      },
    };
    const model = ready(snapshot(noLatency));

    expect(model.methods[0]?.direct.latencyMs).toBeNull();
    expect(model.warnings.join(" ")).toContain("latency was unavailable");
  });

  it("recomputes coverage and warns when the payload disagrees", () => {
    const wrongCoverage = {
      ...okComparison,
      coverage: {
        ...okComparison.coverage,
        routedMethods: ["eth_chainId"],
        coveragePct: 100,
      },
    };
    const model = ready(snapshot(wrongCoverage));

    expect(model.coverage.coveragePct).toBe(25);
    expect(model.warnings.join(" ")).toContain("recomputed");
  });

  it("redacts credentials and query strings from error text", () => {
    const leaky = {
      ...okComparison,
      anonRpc: {
        ...okComparison.anonRpc,
        initialized: false,
        state: "failed",
        initializationError:
          "failed at https://user:pass@rpc.example/abc?token=supersecret while dialing",
      },
    };
    const model = ready(
      snapshot(leaky, {
        direct: viemDirect,
        anonRpc: {
          route: "anon-rpc",
          ok: false,
          errorCategory: "worker",
          errorMessage:
            "worker crashed calling https://rpc.example/secret?apikey=abc",
        },
      }),
    );

    const rendered = JSON.stringify(model);
    expect(rendered).not.toContain("supersecret");
    expect(rendered).not.toContain("apikey");
    expect(rendered).not.toContain("user:pass");
    expect(rendered).not.toContain("/abc?");
    expect(model.anonRpc?.initializationError).toContain("https://rpc.example");
  });

  it("shows Viem results as separate and unavailable when not run", () => {
    const withoutViem = ready(snapshot(okComparison));
    expect(withoutViem.viem).toBeNull();

    const withPartial = ready(snapshot(okComparison, { direct: viemDirect }));
    expect(withPartial.viem?.direct.ok).toBe(true);
    expect(withPartial.viem?.anonRpc.ran).toBe(false);
    expect(withPartial.viem?.anonRpc.chainId).toBeNull();
  });

  it("warns when a Viem probe is filed under the wrong route", () => {
    const mismatched = ready(
      snapshot(okComparison, {
        direct: { ...viemDirect, route: "anon-rpc" },
        anonRpc: null,
      }),
    );
    expect(mismatched.warnings.join(" ")).toContain("unexpected route");
  });

  it("drops invalid attempts instead of trusting them", () => {
    const malformed = {
      ...okComparison,
      direct: {
        ...okComparison.direct,
        attempts: [
          {
            method: "eth_chainId",
            success: true,
            durationMs: 10,
            receivedThroughHarness: false,
          },
          { method: "", success: true },
          { success: true },
          "not-an-object",
        ],
      },
    };
    const model = ready(snapshot(malformed));
    expect(model.direct.attempted).toBe(1);
    expect(model.warnings.join(" ")).toContain("invalid");
  });
});
