/**
 * Compact experiment metadata written to Arkiv.
 *
 * This module is deliberately dependency-free: no Arkiv SDK, no viem, no DOM, no
 * Node APIs. The CLI, the runner and the browser POC can all import it, and the
 * only thing it can produce is the allowlisted record below. Anything a caller
 * supplies that is not in the allowlist is rejected rather than stripped, so a
 * caller cannot believe it published a field that was silently dropped.
 */

/** Version of the metadata contract, independent of the Arkiv SDK version. */
export const ARKIV_METADATA_SCHEMA_VERSION = "1.0";

/** Named Arkiv schema; also the `arkiv.schema` tag every write carries. */
export const ARKIV_ENTITY_TAG = "blocklab.experiment";

/**
 * Longest requested lifetime, in days. The chain caps an entity at
 * `MAX_LIFETIME` = 7_884_000 blocks (~182.5 days at 2 s blocks), so 180 days
 * stays inside the verified bound instead of relying on a revert.
 */
export const MAX_LIFETIME_DAYS = 180;

/** Default requested lifetime for a POC record. */
export const DEFAULT_LIFETIME_DAYS = 30;

/**
 * Lifecycle values, aligned with `ExperimentStatus` in `@blocklab/core`.
 * `idle` and `running` exist so an unfinished experiment is not mislabelled as
 * a completed one.
 */
export const EXPERIMENT_STATUSES = [
  "idle",
  "running",
  "passed",
  "failed",
  "partial",
  "inconclusive",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Statuses that may only be published together with a completion timestamp. */
export const TERMINAL_STATUSES: readonly ExperimentStatus[] = [
  "passed",
  "failed",
  "partial",
  "inconclusive",
];

export function isExperimentStatus(value: unknown): value is ExperimentStatus {
  return (
    typeof value === "string" &&
    (EXPERIMENT_STATUSES as readonly string[]).includes(value)
  );
}

/** Aggregate latency, in milliseconds. */
export type ExperimentLatency = {
  readonly averageMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
};

/**
 * The allowlisted record. Every field is required unless marked optional, and
 * every field is validated before it can be published.
 */
export type ExperimentMetadata = {
  readonly schemaVersion: typeof ARKIV_METADATA_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly experimentType: string;
  readonly scenarioName: string;
  readonly targetChainId: number;
  readonly status: ExperimentStatus;
  readonly startedAtMs: number;
  readonly completedAtMs?: number;
  readonly requestCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly rpcFailureCount: number;
  readonly latency?: ExperimentLatency;
  /** SHA-256 of the local evidence bundle, lowercase hex, no prefix. */
  readonly evidenceDigest: string;
  /** Local-only evidence location, relative to the evidence root. */
  readonly evidenceRef?: string;
  readonly expiryDays: number;
};

/** The exact key set a published record may carry. */
export const EXPERIMENT_METADATA_FIELDS = [
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
] as const;

export type ExperimentMetadataField =
  (typeof EXPERIMENT_METADATA_FIELDS)[number];
