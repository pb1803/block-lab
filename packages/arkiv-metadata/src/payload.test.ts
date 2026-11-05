import { describe, expect, it } from "vitest";
import {
  metadataToPayloadBytes,
  metadataToPayloadJson,
  payloadSha256Hex,
  toDiscoveryAttributes,
  validateExperimentMetadata,
} from "../src/index.js";

const DIGEST = "b".repeat(64);

const RECORD = {
  schemaVersion: "1.0",
  experimentId: "run-2026-11-05-002",
  experimentType: "rpc-blackout",
  scenarioName: "RPC blackout",
  targetChainId: 31337,
  status: "failed",
  startedAtMs: 1_790_000_000_000,
  completedAtMs: 1_790_000_030_000,
  requestCount: 24,
  succeededCount: 12,
  failedCount: 12,
  rpcFailureCount: 11,
  latency: { averageMs: 900, p50Ms: 800, p95Ms: 1500, maxMs: 2000 },
  evidenceDigest: DIGEST,
  evidenceRef: "evidence/run-2026-11-05-002/result.json",
  expiryDays: 14,
};

function metadata() {
  const result = validateExperimentMetadata(RECORD);
  if (!result.ok) throw new Error("fixture rejected");
  return result.metadata;
}

describe("payload", () => {
  it("serialises only the allowlisted fields, in a fixed order", () => {
    const json = metadataToPayloadJson(metadata());
    expect(Object.keys(JSON.parse(json))).toEqual([
      "schemaVersion",
      "experimentId",
      "experimentType",
      "scenarioName",
      "targetChainId",
      "status",
      "startedAtMs",
      "completedAtMs",
      "requestCount",
      "succeededCount",
      "failedCount",
      "rpcFailureCount",
      "latency",
      "evidenceDigest",
      "evidenceRef",
      "expiryDays",
    ]);
  });

  it("is byte-stable for the same record", () => {
    const a = metadataToPayloadBytes(metadata());
    const b = metadataToPayloadBytes(metadata());
    expect(a).toEqual(b);
    expect(metadataToPayloadJson(metadata())).toBe(
      metadataToPayloadJson(metadata()),
    );
  });

  it("keeps the payload small enough for one entity", () => {
    const bytes = metadataToPayloadBytes(metadata());
    expect(bytes.byteLength).toBeLessThan(2_048);
  });

  it("hashes deterministically and differently per record", async () => {
    const first = await payloadSha256Hex(metadata());
    const second = await payloadSha256Hex(metadata());
    const changed = await payloadSha256Hex(
      (() => {
        const result = validateExperimentMetadata({
          ...RECORD,
          status: "passed",
          failedCount: 0,
          rpcFailureCount: 0,
          succeededCount: 24,
        });
        if (!result.ok) throw new Error("fixture rejected");
        return result.metadata;
      })(),
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(changed).not.toBe(first);
  });
});

describe("discovery attributes", () => {
  it("maps only the indexed subset", () => {
    const specs = toDiscoveryAttributes(metadata());
    expect(specs.map((spec) => `${spec.name}:${spec.type}`)).toEqual([
      "experimentId:str",
      "experimentType:str",
      "scenarioName:str",
      "status:str",
      "targetChainId:u64",
      "startedAtMs:u64",
    ]);
  });

  it("never indexes counts, latency, digest or the evidence reference", () => {
    const names = toDiscoveryAttributes(metadata()).map((spec) => spec.name);
    for (const forbidden of [
      "requestCount",
      "succeededCount",
      "failedCount",
      "rpcFailureCount",
      "latency",
      "evidenceDigest",
      "evidenceRef",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("keeps numeric values numeric", () => {
    const specs = toDiscoveryAttributes(metadata());
    const started = specs.find((spec) => spec.name === "startedAtMs");
    expect(started?.type).toBe("u64");
    expect(typeof started?.value).toBe("number");
  });
});
