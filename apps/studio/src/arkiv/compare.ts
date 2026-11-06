/**
 * Metadata-level comparison for Studio history.
 *
 * This is deliberately NOT a second RPC comparison engine: it compares the
 * shared `ExperimentMetadata` allowlist field by field (and the system metadata
 * when both sides are on-chain records). The RPC comparison engine
 * (`apps/studio/src/comparison`) stays the only per-method measurement engine.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { ArkivRecord } from "./types.js";

export type CompareSide =
  | {
      readonly kind: "arkiv";
      readonly label: string;
      readonly record: ArkivRecord;
    }
  | {
      readonly kind: "local";
      readonly label: string;
      readonly metadata: ExperimentMetadata;
    };

export type CompareRow = {
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly same: boolean;
  /** `metadata` rows are published values; `system` rows only exist on-chain. */
  readonly group: "metadata" | "system";
};

export type CompareModel = {
  readonly rows: readonly CompareRow[];
  readonly differing: number;
  readonly identical: number;
};

function metadataOf(side: CompareSide): ExperimentMetadata {
  return side.kind === "arkiv" ? side.record.metadata : side.metadata;
}

function iso(ms: number | undefined): string {
  return ms === undefined ? "—" : new Date(ms).toISOString();
}

function showValue(value: string | number | undefined): string {
  if (value === undefined) return "—";
  return String(value);
}

function latencyText(latency: ExperimentMetadata["latency"]): string {
  return latency === undefined
    ? "—"
    : `avg ${latency.averageMs} / p50 ${latency.p50Ms} / p95 ${latency.p95Ms} / max ${latency.maxMs} ms`;
}

function durationText(metadata: ExperimentMetadata): string {
  if (metadata.completedAtMs === undefined) return "— (not completed)";
  return `${metadata.completedAtMs - metadata.startedAtMs} ms`;
}

const METADATA_FIELDS: readonly {
  readonly label: string;
  readonly read: (metadata: ExperimentMetadata) => string;
}[] = [
  { label: "Schema version", read: (m) => m.schemaVersion },
  { label: "Experiment id", read: (m) => m.experimentId },
  { label: "Experiment type", read: (m) => m.experimentType },
  { label: "Scenario", read: (m) => m.scenarioName },
  { label: "Status", read: (m) => m.status },
  { label: "Target chain id", read: (m) => String(m.targetChainId) },
  { label: "Started at", read: (m) => iso(m.startedAtMs) },
  { label: "Completed at", read: (m) => iso(m.completedAtMs) },
  { label: "Duration", read: (m) => durationText(m) },
  { label: "Requests", read: (m) => String(m.requestCount) },
  { label: "Succeeded", read: (m) => String(m.succeededCount) },
  { label: "Failed", read: (m) => String(m.failedCount) },
  { label: "RPC failures", read: (m) => String(m.rpcFailureCount) },
  { label: "Latency", read: (m) => latencyText(m.latency) },
  { label: "Evidence digest", read: (m) => m.evidenceDigest },
  { label: "Evidence reference", read: (m) => showValue(m.evidenceRef) },
  { label: "Requested lifetime", read: (m) => `${m.expiryDays} days` },
];

const SYSTEM_LABELS = [
  "Owner",
  "Creator",
  "Entity key",
  "Created at block",
  "Expires at block",
] as const;

/**
 * Compares two sources field by field. Missing values are shown as "—" and are
 * never substituted; a field present on one side only is reported as different.
 */
export function compareRecords(
  left: CompareSide,
  right: CompareSide,
): CompareModel {
  const rows: CompareRow[] = [];
  for (const field of METADATA_FIELDS) {
    const a = field.read(metadataOf(left));
    const b = field.read(metadataOf(right));
    rows.push({
      label: field.label,
      left: a,
      right: b,
      same: a === b,
      group: "metadata",
    });
  }
  if (left.kind === "arkiv" && right.kind === "arkiv") {
    const systemRead: ((record: ArkivRecord) => string)[] = [
      (record: ArkivRecord) => record.owner,
      (record: ArkivRecord) => record.creator,
      (record: ArkivRecord) => record.entityKey,
      (record: ArkivRecord) => record.createdAtBlock.toString(),
      (record: ArkivRecord) => record.expiresAtBlock.toString(),
    ];
    SYSTEM_LABELS.forEach((label, index) => {
      const read = systemRead[index];
      if (read === undefined) return;
      const a = read(left.record);
      const b = read(right.record);
      rows.push({ label, left: a, right: b, same: a === b, group: "system" });
    });
  }
  const differing = rows.filter((row) => !row.same).length;
  return { rows, differing, identical: rows.length - differing };
}

/** Human labels for a side, so the UI never presents a local run as on-chain. */
export function sourceLabel(side: CompareSide): string {
  return side.kind === "arkiv"
    ? `Arkiv record (${side.label})`
    : `Local record (${side.label})`;
}
