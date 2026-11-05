import {
  ARKIV_ENTITY_TAG,
  metadataToPayloadJson,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { bytesToHex, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import {
  experimentSchema,
  experimentValues,
} from "../src/entity/experiment-schema.js";
import { archivedRecordFromRow, decodePayloadHex } from "../src/gateway.js";

const DIGEST = "3f".repeat(32);
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const KEY = `0x${"ab".repeat(32)}` as Hex;

function metadata(overrides: Record<string, unknown> = {}) {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: "run-001",
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: 1_790_000_000_000,
    completedAtMs: 1_790_000_010_000,
    requestCount: 10,
    succeededCount: 8,
    failedCount: 2,
    rpcFailureCount: 2,
    latency: { averageMs: 120, p50Ms: 100, p95Ms: 200, maxMs: 400 },
    evidenceDigest: DIGEST,
    evidenceRef: "evidence/run-001/result.json",
    expiryDays: 30,
    ...overrides,
  });
  if (!result.ok)
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.metadata;
}

describe("experiment schema", () => {
  it("is the shared named schema with indexed discovery columns", () => {
    expect(experimentSchema.name).toBe(ARKIV_ENTITY_TAG);
    expect(experimentSchema.tag?.value).toBe("blocklab.experiment");
    const columns = experimentSchema.columns as unknown as Record<
      string,
      { readonly isIndexed: boolean }
    >;
    expect(Object.keys(columns)).toEqual([
      "experimentId",
      "experimentType",
      "scenarioName",
      "status",
      "targetChainId",
      "startedAtMs",
      "completedAtMs",
      "payload",
    ]);
    for (const name of [
      "experimentId",
      "experimentType",
      "scenarioName",
      "status",
      "targetChainId",
      "startedAtMs",
    ]) {
      expect(columns[name]?.isIndexed).toBe(true);
    }
    expect(columns.payload?.isIndexed).toBe(false);
  });

  it("maps a validated record to typed schema values and the canonical payload", () => {
    const record = metadata();
    const values = experimentValues(record);

    expect(values.experimentId).toEqual({ type: "str", value: "run-001" });
    expect(values.status).toEqual({ type: "str", value: "passed" });
    expect(values.targetChainId.type).toBe("u64");
    expect(values.targetChainId.value).toBe(31337n);
    expect(values.startedAtMs.type).toBe("u64");

    const payloadHex = values.payload.value;
    const decoded = new TextDecoder().decode(
      stringToBytes(metadataToPayloadJson(record)),
    );
    expect(payloadHex).toBe(bytesToHex(stringToBytes(decoded)));
  });

  it("omits completedAtMs for a run that has not finished", () => {
    const record = metadata({ status: "running", completedAtMs: undefined });
    const values = experimentValues(record);
    expect("completedAtMs" in values).toBe(false);
  });
});

describe("payload decoding", () => {
  it("decodes a JSON payload", () => {
    expect(decodePayloadHex(bytesToHex(stringToBytes('{"a":1}')))).toBe(
      '{"a":1}',
    );
  });

  it("rejects bytes that are not UTF-8", () => {
    expect(() => decodePayloadHex("0xff")).toThrow(/not valid UTF-8/);
  });

  it("rejects UTF-8 that is not JSON", () => {
    expect(() =>
      decodePayloadHex(bytesToHex(stringToBytes("not json"))),
    ).toThrow(/not valid JSON/);
  });
});

describe("archivedRecordFromRow", () => {
  it("maps owner, creator, block fields and the read-only flag", () => {
    const payloadJson = metadataToPayloadJson(metadata());
    const record = archivedRecordFromRow({
      $key: KEY,
      $owner: OWNER,
      $creator: OWNER,
      $createdAt: 400n,
      $updatedAt: 405n,
      $expiresAt: 900n,
      $creationFlags: { readonly: true, permissionlessExtension: false },
      payload: { type: "bytes", value: bytesToHex(stringToBytes(payloadJson)) },
    });

    expect(record.entityKey).toBe(KEY);
    expect(record.owner).toBe(OWNER);
    expect(record.creator).toBe(OWNER);
    expect(record.createdAtBlock).toBe(400n);
    expect(record.updatedAtBlock).toBe(405n);
    expect(record.expiresAtBlock).toBe(900n);
    expect(record.readonlyFlag).toBe(true);
    expect(JSON.parse(record.payloadJson).experimentId).toBe("run-001");
  });

  it("treats absent creation flags as not read-only", () => {
    const record = archivedRecordFromRow({
      $key: KEY,
      $owner: OWNER,
      $creator: OWNER,
      $createdAt: 1n,
      $updatedAt: 1n,
      $expiresAt: 2n,
      $creationFlags: undefined,
      payload: { type: "bytes", value: bytesToHex(stringToBytes("{}")) },
    });
    expect(record.readonlyFlag).toBe(false);
  });
});
