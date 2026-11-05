import type { ExperimentMetadata } from "./schema.js";
import { metadataToJson } from "./validate.js";

/** Bytes of the canonical JSON record, written as the entity's `payload`. */
export function metadataToPayloadBytes(
  metadata: ExperimentMetadata,
): Uint8Array {
  return new TextEncoder().encode(metadataToJson(metadata));
}

/** The canonical JSON record, for display or hashing. */
export function metadataToPayloadJson(metadata: ExperimentMetadata): string {
  return metadataToJson(metadata);
}

/**
 * SHA-256 of the canonical JSON record, lowercase hex. This is the digest of
 * the published payload itself, distinct from the evidence digest the record
 * carries (which covers the local evidence bundle).
 *
 * Node 18+ and browsers both expose `crypto.subtle`; this function keeps the
 * package otherwise environment-neutral.
 */
export async function payloadSha256Hex(
  metadata: ExperimentMetadata,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    metadataToPayloadBytes(metadata) as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
