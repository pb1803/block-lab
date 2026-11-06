/**
 * Shared fixtures for the Studio Arkiv tests. Validation runs through the same
 * package the app uses, so a fixture is by construction a legal record.
 */
import {
  type ExperimentMetadata,
  metadataToPayloadBytes,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import type { RawEntityRow } from "./record.js";

export function sampleMetadata(): ExperimentMetadata {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: "poc-write-001",
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout (write probe)",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: 1_793_924_125_113,
    completedAtMs: 1_793_924_155_113,
    requestCount: 40,
    succeededCount: 34,
    failedCount: 6,
    rpcFailureCount: 6,
    latency: { averageMs: 128, p50Ms: 96, p95Ms: 310, maxMs: 512 },
    evidenceDigest: "3f".repeat(32),
    evidenceRef: "evidence/poc-write/result.json",
    expiryDays: 7,
  });
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.metadata;
}

export function payloadHex(
  metadata: ExperimentMetadata = sampleMetadata(),
): `0x${string}` {
  return `0x${Buffer.from(metadataToPayloadBytes(metadata)).toString("hex")}`;
}

export const ENTITY_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const SIGNER = "0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759";

/** A valid entity row carrying the canonical payload. */
export function makeRow(overrides: Partial<RawEntityRow> = {}): RawEntityRow {
  return {
    $key: ENTITY_KEY,
    $owner: SIGNER,
    $creator: SIGNER,
    $createdAt: 269_199n,
    $updatedAt: 269_199n,
    $expiresAt: 571_599n,
    $creationFlags: { readonly: false, permissionlessExtension: false },
    payload: { type: "bytes", value: payloadHex() },
    ...overrides,
  };
}
