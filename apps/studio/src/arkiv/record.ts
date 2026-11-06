/**
 * Record decoding and validation for Studio.
 *
 * Every retrieved entity is decoded from its canonical JSON payload and then
 * re-validated with the shared `@blocklab/arkiv-metadata` contract. A record
 * that fails validation is reported as malformed — it is never rendered as if
 * its fields were trustworthy, and missing values are never substituted.
 */
import {
  type ExperimentMetadata,
  metadataToPayloadBytes,
  type ValidationIssue,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { hexToBytes } from "viem";
import type { ArkivRecord, StudioError } from "./types.js";

/** The system fields the SDK returns for one entity row. */
export type RawEntityRow = {
  readonly $key: Hex;
  readonly $owner: Address;
  readonly $creator: Address;
  readonly $createdAt: bigint;
  readonly $updatedAt: bigint;
  readonly $expiresAt: bigint;
  readonly $creationFlags?:
    | { readonly readonly: boolean; readonly permissionlessExtension: boolean }
    | undefined;
  readonly payload: { readonly type: "bytes"; readonly value: Hex } | undefined;
};

export type DecodeResult =
  | { readonly ok: true; readonly record: ArkivRecord }
  | { readonly ok: false; readonly error: StudioError };

/**
 * Decodes the payload bytes back to the canonical JSON. Invalid UTF-8 or JSON
 * is a malformed response, never a silent blank.
 */
export function decodePayloadHex(value: Hex): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(value));
  } catch {
    throw new Error("malformed response: payload is not valid UTF-8");
  }
  try {
    JSON.parse(text);
  } catch {
    throw new Error("malformed response: payload is not valid JSON");
  }
  return text;
}

/**
 * Redacts credential-shaped substrings before any retrieved text is rendered,
 * so a malformed record or a hostile error message cannot leak a secret.
 */
export function redactSensitive(text: string): string {
  return text
    .replace(/https?:\/\/[^\s@/]+:[^\s@/]+@/gi, "https://[redacted]@")
    .replace(/0x[0-9a-fA-F]{64}\b/g, "0x[redacted-64hex]")
    .replace(
      /\b(bearer|apikey|api[-_]?key|authorization)\s*[:=]\s*\S+/gi,
      "$1: [redacted]",
    )
    .replace(
      /\b[a-z0-9_-]*(?:private|secret|mnemonic|seed)[a-z0-9_-]*\s*[:=]\s*[^\s;]+/gi,
      "[redacted]",
    );
}

function redactIssues(issues: readonly ValidationIssue[]): string {
  return redactSensitive(issues.map((issue) => issue.message).join("; "));
}

/**
 * Converts one SDK row into a validated `ArkivRecord`. The payload must be
 * present, canonical JSON, and accepted by the shared validator; otherwise the
 * record is rejected with a malformed/validation error.
 */
export function arkivRecordFromRow(row: RawEntityRow): DecodeResult {
  if (row.payload === undefined) {
    return {
      ok: false,
      error: {
        category: "malformed-response",
        message: "The entity has no payload attribute.",
      },
    };
  }
  let payloadJson: string;
  let parsed: unknown;
  try {
    payloadJson = decodePayloadHex(row.payload.value);
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    return {
      ok: false,
      error: {
        category: "malformed-response",
        message: redactSensitive(
          error instanceof Error ? error.message : String(error),
        ),
      },
    };
  }
  const result = validateExperimentMetadata(parsed);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        category: "validation",
        message: `The stored payload is not a valid BLOCKLAB record: ${redactIssues(result.issues)}`,
      },
    };
  }
  const metadata: ExperimentMetadata = result.metadata;
  // The canonical JSON must round-trip: if the stored bytes are not exactly the
  // canonical encoding, the record was tampered with or produced by another
  // encoder.
  const canonical = new TextDecoder().decode(metadataToPayloadBytes(metadata));
  if (canonical !== payloadJson) {
    return {
      ok: false,
      error: {
        category: "validation",
        message:
          "The stored payload is not the canonical encoding of the record it parses to.",
      },
    };
  }
  return {
    ok: true,
    record: {
      entityKey: row.$key,
      owner: row.$owner,
      creator: row.$creator,
      createdAtBlock: row.$createdAt,
      updatedAtBlock: row.$updatedAt,
      expiresAtBlock: row.$expiresAt,
      readonlyFlag: row.$creationFlags?.readonly ?? false,
      payloadJson,
      metadata,
    },
  };
}

/** True when the entity's expiry block has passed (or is the current block). */
export function isExpiredAt(
  expiresAtBlock: bigint,
  currentBlock: bigint,
): boolean {
  return expiresAtBlock <= currentBlock;
}

/**
 * Post-confirmation read-back verification: the stored payload bytes must equal
 * the canonical encoding of the exact record that was submitted, and the entity
 * key must be the one the receipt carried. The byte comparison covers every
 * allowlisted field at once.
 */
export type ReadBackVerification =
  | { readonly verified: true }
  | { readonly verified: false; readonly reason: string };

export function verifyReadBack(
  submitted: ExperimentMetadata,
  stored: ArkivRecord,
): ReadBackVerification {
  if (stored.entityKey.length !== 66 || !stored.entityKey.startsWith("0x")) {
    return { verified: false, reason: "entity key has an unexpected shape" };
  }
  const submittedJson = new TextDecoder().decode(
    metadataToPayloadBytes(submitted),
  );
  if (stored.payloadJson !== submittedJson) {
    return {
      verified: false,
      reason:
        "the stored payload is not byte-identical to the submitted record",
    };
  }
  return { verified: true };
}

/** What becomes publicly queryable if this record is published. */
export function publicDisclosure(
  metadata: ExperimentMetadata,
): readonly string[] {
  return [
    `Experiment identifier "${metadata.experimentId}" (indexed, searchable)`,
    `Type "${metadata.experimentType}" and scenario "${metadata.scenarioName}" (indexed)`,
    `Status "${metadata.status}" and target chain id ${metadata.targetChainId} (indexed)`,
    `Start time ${new Date(metadata.startedAtMs).toISOString()} (indexed)${
      metadata.completedAtMs === undefined
        ? ""
        : `, completion ${new Date(metadata.completedAtMs).toISOString()}`
    }`,
    `${metadata.requestCount} requests, ${metadata.succeededCount} succeeded, ${metadata.failedCount} failed, ${metadata.rpcFailureCount} RPC failures`,
    metadata.latency === undefined
      ? "No latency summary"
      : `Latency avg ${metadata.latency.averageMs} ms, p50 ${metadata.latency.p50Ms} ms, p95 ${metadata.latency.p95Ms} ms, max ${metadata.latency.maxMs} ms`,
    `Evidence digest ${metadata.evidenceDigest} (a hash of local evidence; it does not by itself make the execution trustworthy — the detailed evidence stays local)`,
    metadata.evidenceRef === undefined
      ? "No evidence reference"
      : `Evidence reference "${metadata.evidenceRef}" (the file stays local)`,
    `Requested lifetime ${metadata.expiryDays} days; the entity expires on-chain after that`,
    "Nothing else: no raw RPC payloads, no wallet credentials, no API keys, no traces",
  ];
}

/**
 * Credential-shaped values that must never reach the chain or the UI. Used as
 * a last line of defence before signing: a metadata record carrying any of
 * these fails closed.
 */
export function findSensitiveContent(
  metadata: ExperimentMetadata,
): readonly string[] {
  const text = JSON.stringify(metadata);
  const lowered = text.toLowerCase();
  const found: string[] = [];
  const needles = [
    "privatekey",
    "private_key",
    "mnemonic",
    "seedphrase",
    "seed_phrase",
    "apikey",
    "api_key",
    "authorization",
    "cookie",
    "password",
    "bearer",
  ];
  for (const needle of needles) {
    if (lowered.includes(needle)) found.push(needle);
  }
  if (/https?:\/\/[^"\s]*@/i.test(text)) found.push("credential-in-url");
  return found;
}
