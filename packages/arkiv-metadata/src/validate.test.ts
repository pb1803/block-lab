import { describe, expect, it } from "vitest";
import {
  hasForbiddenContent,
  type ValidationIssue,
  validateExperimentMetadata,
} from "../src/index.js";

const DIGEST = "a".repeat(64);

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    experimentId: "run-2026-11-05-001",
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: 1_790_000_000_000,
    completedAtMs: 1_790_000_012_000,
    requestCount: 40,
    succeededCount: 32,
    failedCount: 8,
    rpcFailureCount: 8,
    latency: { averageMs: 120, p50Ms: 100, p95Ms: 260, maxMs: 400 },
    evidenceDigest: DIGEST,
    evidenceRef: "evidence/run-2026-11-05-001/result.json",
    expiryDays: 30,
    ...overrides,
  };
}

function issuesOf(input: unknown): ValidationIssue[] {
  const result = validateExperimentMetadata(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : [...result.issues];
}

function fieldsOf(input: unknown): string[] {
  return issuesOf(input).map((issue) => issue.field);
}

describe("validateExperimentMetadata", () => {
  it("accepts a complete record and freezes the copy", () => {
    const input = validRecord();
    const result = validateExperimentMetadata(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.experimentId).toBe("run-2026-11-05-001");
    expect(result.metadata).not.toBe(input);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(input.completedAtMs).toBe(1_790_000_012_000);
  });

  it("rejects a non-object payload", () => {
    expect(validateExperimentMetadata(null).ok).toBe(false);
    expect(validateExperimentMetadata("run").ok).toBe(false);
    expect(validateExperimentMetadata([]).ok).toBe(false);
  });

  it("rejects unknown fields instead of dropping them", () => {
    const issues = issuesOf(validRecord({ rpcUrl: "https://example.invalid" }));
    expect(issues.some((issue) => issue.code === "unknown-field")).toBe(true);
    expect(fieldsOf(validRecord({ rpcUrl: "x" }))).toContain("rpcUrl");
  });

  it("rejects every required field going missing", () => {
    const record = validRecord();
    for (const field of [
      "experimentId",
      "targetChainId",
      "status",
      "evidenceDigest",
      "expiryDays",
    ] as const) {
      const copy: Record<string, unknown> = { ...record };
      delete copy[field];
      expect(fieldsOf(copy)).toContain(field);
    }
  });

  it("refuses a terminal status without a completion time", () => {
    const record = validRecord({ status: "failed" });
    delete (record as Record<string, unknown>).completedAtMs;
    expect(fieldsOf(record)).toContain("completedAtMs");
  });

  it("accepts an unfinished run labelled running", () => {
    const record = validRecord({ status: "running" });
    delete (record as Record<string, unknown>).completedAtMs;
    const result = validateExperimentMetadata(record);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metadata.status).toBe("running");
  });

  it("rejects a completion time before the start", () => {
    expect(
      fieldsOf(validRecord({ completedAtMs: 1_789_999_000_000 })),
    ).toContain("completedAtMs");
  });

  it("rejects counts that contradict each other", () => {
    expect(
      fieldsOf(validRecord({ succeededCount: 40, failedCount: 8 })),
    ).toContain("requestCount");
    expect(fieldsOf(validRecord({ rpcFailureCount: 9 }))).toContain(
      "rpcFailureCount",
    );
  });

  it("rejects a negative or fractional count", () => {
    expect(fieldsOf(validRecord({ requestCount: -1 }))).toContain(
      "requestCount",
    );
    expect(fieldsOf(validRecord({ requestCount: 4.5 }))).toContain(
      "requestCount",
    );
  });

  it("rejects unordered latency", () => {
    expect(
      fieldsOf(
        validRecord({
          latency: { averageMs: 300, p50Ms: 100, p95Ms: 200, maxMs: 250 },
        }),
      ),
    ).toContain("latency");
  });

  it("rejects latency fields outside the allowlist", () => {
    expect(
      fieldsOf(
        validRecord({
          latency: {
            averageMs: 10,
            p50Ms: 10,
            p95Ms: 10,
            maxMs: 10,
            trace: "secret",
          },
        }),
      ),
    ).toContain("latency");
  });

  it("rejects a malformed evidence digest and accepts a real one", () => {
    expect(fieldsOf(validRecord({ evidenceDigest: "0x1234" }))).toContain(
      "evidenceDigest",
    );
    expect(
      validateExperimentMetadata(
        validRecord({ evidenceDigest: "0123456789abcdef".repeat(4) }),
      ).ok,
    ).toBe(true);
  });

  it("rejects an absolute, traversing or credential-bearing evidence reference", () => {
    for (const ref of [
      "/home/user/evidence.json",
      "../secrets/evidence.json",
      "C:/evidence/run.json",
      "evidence/https://rpc.example/run.json",
      "evidence\\run.json",
    ]) {
      expect(fieldsOf(validRecord({ evidenceRef: ref }))).toContain(
        "evidenceRef",
      );
    }
  });

  it("rejects a lifetime outside the supported range", () => {
    expect(fieldsOf(validRecord({ expiryDays: 0 }))).toContain("expiryDays");
    expect(fieldsOf(validRecord({ expiryDays: 181 }))).toContain("expiryDays");
    expect(
      validateExperimentMetadata(validRecord({ expiryDays: 180 })).ok,
    ).toBe(true);
  });

  it("rejects identifiers that are not plain slugs", () => {
    for (const id of [
      "Run 001",
      "run_001",
      "run/001",
      "https://run",
      "../run",
    ]) {
      expect(fieldsOf(validRecord({ experimentId: id }))).toContain(
        "experimentId",
      );
    }
  });

  it("rejects a scenario label carrying a URL or quote", () => {
    expect(
      fieldsOf(
        validRecord({ scenarioName: "RPC blackout https://rpc.example" }),
      ),
    ).toContain("scenarioName");
    expect(fieldsOf(validRecord({ scenarioName: 'RPC "blackout"' }))).toContain(
      "scenarioName",
    );
  });

  it("rejects an unsupported status", () => {
    expect(fieldsOf(validRecord({ status: "published" }))).toContain("status");
  });
});

describe("hasForbiddenContent", () => {
  it.each([
    "https://ethereum-rpc.publicnode.com",
    "wss://rpc.example",
    "Bearer abc123",
    "apiKey=abc",
    "access_key: abc",
    "privateKey=abc",
    "secret: xyz",
    `0x${"a".repeat(64)}`,
    "123e4567-e89b-12d3-a456-426614174000",
    "two\"quotes'",
    "back\\slash",
  ])("flags %s", (value) => {
    expect(hasForbiddenContent(value)).toBe(true);
  });

  it.each(["RPC blackout", "run-2026-11-05-001", "rpc-blackout"])(
    "allows %s",
    (value) => {
      expect(hasForbiddenContent(value)).toBe(false);
    },
  );
});
