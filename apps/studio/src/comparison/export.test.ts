import { describe, expect, it } from "vitest";
import {
  buildComparisonExport,
  comparisonExportFilename,
  STUDIO_EXPORT_KIND,
  STUDIO_EXPORT_SCHEMA_VERSION,
  type StudioComparisonExport,
} from "./export.js";
import {
  failedWorkerComparison,
  okComparison,
  partialComparison,
  referenceWorkload,
  snapshot,
  viemAnon,
  viemDirect,
} from "./test-fixtures.js";

const EXPORTED_AT = "2026-01-02T03:04:05.000Z";

function exported(): StudioComparisonExport {
  const result = buildComparisonExport(
    snapshot(okComparison, { direct: viemDirect, anonRpc: viemAnon }),
    { exportedAt: EXPORTED_AT },
  );
  if (!result.ok) throw new Error(`expected an export, got: ${result.reason}`);
  return result.artifact.value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

describe("Studio comparison export", () => {
  it("exports a valid comparison with schema, kind, and run identity", () => {
    const value = exported();

    expect(value.schemaVersion).toBe(STUDIO_EXPORT_SCHEMA_VERSION);
    expect(value.kind).toBe(STUDIO_EXPORT_KIND);
    expect(value.exportedAt).toBe(EXPORTED_AT);
    expect(value.run.comparisonSchemaVersion).toBe("1.0");
    expect(value.run.generatedAt).toBe(okComparison.generatedAt);
    expect(value.run.runId).toMatch(/^rpc-[0-9a-f]{16}$/);
    expect(value.run.completeness).toBe("complete");
    expect(value.run.completenessReasons).toEqual([
      "Both routes were ready and every eligible method succeeded.",
    ]);
  });

  it("keeps direct results, anon results, per-attempt status, and coverage", () => {
    const value = exported();

    expect(value.direct.route).toBe("direct");
    expect(value.direct.attempts.map((attempt) => attempt.method)).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_getBalance",
      "eth_call",
    ]);
    expect(value.direct.attempts[0]).toEqual({
      method: "eth_chainId",
      success: true,
      latencyMs: 12,
      harnessRouted: false,
      errorCategory: null,
    });
    expect(value.anonRpc?.totals).toMatchObject({
      attempted: 4,
      succeeded: 4,
      failed: 0,
      successRatePct: 100,
      harnessRouted: 4,
    });
    expect(value.anonRpc?.attempts[0]?.harnessRouted).toBe(true);
    expect(value.coverage).toMatchObject({
      routedCount: 4,
      coveragePct: 100,
      skippedMethods: 0,
    });
    expect(value.methods.eligible).toHaveLength(4);
    expect(value.methods.excluded).toContain("eth_sendTransaction");
    expect(value.coverage.denominator).toContain(
      "Skipped methods are not counted as successful",
    );
  });

  it("includes Viem summaries separately from the raw attempts", () => {
    const value = exported();

    expect(value.viem?.direct).toMatchObject({
      ran: true,
      ok: true,
      chainId: 1,
      blockNumber: "26350471",
    });
    expect(value.viem?.anonRpc.blockNumber).toBe("26350477");
  });

  it("rejects a missing snapshot", () => {
    const result = buildComparisonExport(undefined);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("no comparison");
    expect(result.issues).toEqual([]);
  });

  it("rejects an invalid snapshot and reports why", () => {
    const result = buildComparisonExport({ schemaVersion: "0.9" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("not valid");
    expect(result.issues.join(" ")).toContain("Unsupported comparison schema");
  });

  it("labels a direct-only run as incomplete instead of complete", () => {
    const result = buildComparisonExport(snapshot(partialComparison), {
      exportedAt: EXPORTED_AT,
    });
    if (!result.ok) throw new Error(result.reason);
    const value = result.artifact.value;

    expect(value.run.completeness).toBe("incomplete");
    expect(value.run.completenessReasons.join(" ")).toContain(
      "Anon-RPC was not measured",
    );
    expect(value.run.completenessReasons.join(" ")).toContain(
      "not attempted on both routes",
    );
    expect(value.anonRpc).toBeNull();
    expect(value.coverage.coveragePct).toBe(0);
  });

  it("labels a failed worker run as failed and records no fallback", () => {
    const result = buildComparisonExport(snapshot(failedWorkerComparison), {
      exportedAt: EXPORTED_AT,
    });
    if (!result.ok) throw new Error(result.reason);
    const value = result.artifact.value;

    expect(value.run.completeness).toBe("failed");
    expect(value.run.completenessReasons.join(" ")).toContain(
      "short bytes32 return",
    );
    expect(value.run.completenessReasons.join(" ")).toContain(
      "no direct fallback",
    );
    expect(value.run.worker.ready).toBe(false);
    expect(value.anonRpc?.ready).toBe(false);
    expect(
      value.anonRpc?.attempts.every((attempt) => attempt.success === false),
    ).toBe(true);
    expect(value.coverage.skippedMethods).toBe(0);
  });

  it("distinguishes a passthrough reference worker from a network worker", () => {
    const reference = buildComparisonExport(
      snapshot({ ...okComparison, anonRpc: referenceWorkload }),
      { exportedAt: EXPORTED_AT },
    );
    if (!reference.ok) throw new Error(reference.reason);
    const network = exported();

    expect(reference.artifact.value.run.worker.kind).toBe("reference");
    expect(reference.artifact.value.run.worker.classification).toContain(
      "not anonymizing",
    );
    expect(network.run.worker.kind).toBe("network");
    expect(network.run.worker.classification).toContain(
      "anonymity not measured",
    );
    expect(network.direct.workerId).toBeNull();
    expect(network.direct.workerClassification).toContain("not applicable");
  });

  it("redacts credentials, tokens, and full URLs from exported text", () => {
    const leaky = {
      ...snapshot(okComparison, {
        direct: viemDirect,
        anonRpc: {
          route: "anon-rpc",
          ok: false,
          errorCategory: "worker",
          errorMessage:
            "worker failed at https://user:pass@rpc.example/secret?apikey=abc123",
        },
      }),
      runtime: {
        userAgent: "headless test",
        url: "http://127.0.0.1:5173/?selftest=1&token=supersecret",
      },
      comparison: {
        ...okComparison,
        anonRpc: {
          ...okComparison.anonRpc,
          initialized: false,
          state: "failed",
          initializationError:
            "dial failed: https://user:pass@rpc.example/v1/key?apikey=abc123",
        },
      },
    };
    const result = buildComparisonExport(leaky, { exportedAt: EXPORTED_AT });
    if (!result.ok) throw new Error(result.reason);
    const json = result.artifact.json;

    expect(json).not.toContain("supersecret");
    expect(json).not.toContain("apikey");
    expect(json).not.toContain("user:pass");
    expect(json).not.toContain("/secret");
    expect(json).not.toContain("selftest");
    expect(result.artifact.value.runtime?.origin).toBe("http://127.0.0.1:5173");
    expect(result.artifact.value.anonRpc?.initializationError).toContain(
      "https://rpc.example",
    );
  });

  it("never exports raw parameters, headers, storage, or accounts", () => {
    const leakyComparison = {
      ...okComparison,
      accounts: ["0x1111111111111111111111111111111111111111"],
      headers: { authorization: "Bearer should-not-appear" },
      direct: {
        ...okComparison.direct,
        params: { from: "0xdeadbeefdeadbeef" },
        headers: { cookie: "session=should-not-appear" },
        storage: { localStorage: "should-not-appear" },
        attempts: okComparison.direct.attempts.map((attempt) => ({
          ...attempt,
          params: ["0xdeadbeefdeadbeef"],
          result: "0xshould-not-appear",
        })),
      },
    };
    const result = buildComparisonExport(
      {
        ...snapshot(leakyComparison, {
          direct: {
            ...viemDirect,
            walletAddress: "0x2222222222222222222222222222222222222222",
          },
          anonRpc: viemAnon,
        }),
        apiKey: "should-not-appear",
        privateKey: "0xshould-not-appear",
        cookies: "session=should-not-appear",
      },
      { exportedAt: EXPORTED_AT },
    );
    if (!result.ok) throw new Error(result.reason);
    const json = result.artifact.json;

    expect(json).not.toContain("should-not-appear");
    expect(json).not.toContain("deadbeef");
    expect(json).not.toContain("1111111111111111111111111111111111111111");
    expect(json).not.toContain("2222222222222222222222222222222222222222");
    expect(json).not.toMatch(/"params"/);
    expect(json).not.toMatch(/"headers"/);
    expect(json).not.toMatch(/"accounts"/);
    expect(json).not.toMatch(/"cookies"/);
    expect(json).not.toMatch(/"privateKey"/);
    expect(result.artifact.value.redaction.excluded.length).toBeGreaterThan(0);
  });

  it("does not modify the snapshot it exports", () => {
    const input = deepFreeze(
      JSON.parse(
        JSON.stringify(
          snapshot(okComparison, { direct: viemDirect, anonRpc: viemAnon }),
        ),
      ),
    ) as unknown;
    const before = JSON.stringify(input);

    const result = buildComparisonExport(input, { exportedAt: EXPORTED_AT });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("is deterministic apart from explicit export metadata", () => {
    const first = buildComparisonExport(snapshot(okComparison), {
      exportedAt: EXPORTED_AT,
    });
    const second = buildComparisonExport(snapshot(okComparison), {
      exportedAt: EXPORTED_AT,
    });
    if (!first.ok || !second.ok) throw new Error("expected two exports");

    expect(first.artifact.json).toBe(second.artifact.json);
    expect(first.artifact.filename).toBe(second.artifact.filename);
    expect(first.artifact.runId).toBe(second.artifact.runId);

    const later = buildComparisonExport(snapshot(okComparison), {
      exportedAt: "2026-01-03T00:00:00.000Z",
    });
    if (!later.ok) throw new Error(later.reason);
    expect(later.artifact.runId).toBe(first.artifact.runId);
    expect(later.artifact.json).not.toBe(first.artifact.json);
  });

  it("generates a safe, deterministic filename from the run", () => {
    const result = buildComparisonExport(snapshot(okComparison), {
      exportedAt: EXPORTED_AT,
    });
    if (!result.ok) throw new Error(result.reason);

    expect(result.artifact.filename).toBe(
      `blocklab-rpc-comparison-20260101T000000Z-${result.artifact.runId}.json`,
    );
    expect(result.artifact.filename).toMatch(
      /^blocklab-rpc-comparison-\d{8}T\d{6}Z-rpc-[0-9a-f]{16}\.json$/,
    );
    expect(
      comparisonExportFilename(okComparison.generatedAt, "../../etc/passwd"),
    ).toBe(`blocklab-rpc-comparison-20260101T000000Z-etcpasswd.json`);
  });

  it("refuses to export a payload with no recorded attempts", () => {
    const empty = {
      ...okComparison,
      direct: { ...okComparison.direct, attempts: [] },
      anonRpc: null,
    };
    const result = buildComparisonExport(snapshot(empty), {
      exportedAt: EXPORTED_AT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("No request attempts");
  });

  it("refuses attempts outside the read-only allowlist", () => {
    const malformed = {
      ...okComparison,
      direct: {
        ...okComparison.direct,
        attempts: [
          ...okComparison.direct.attempts,
          { method: "eth_sendTransaction", success: true },
          "not-an-attempt",
        ],
      },
    };
    const result = buildComparisonExport(snapshot(malformed), {
      exportedAt: EXPORTED_AT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("outside the read-only allowlist");
    expect(result.issues.join(" ")).toContain("eth_sendTransaction");
  });

  it("can require a complete result when a host only accepts completed runs", () => {
    const result = buildComparisonExport(snapshot(partialComparison), {
      exportedAt: EXPORTED_AT,
      requireComplete: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("requires a complete result");
  });
});
