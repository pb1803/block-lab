import {
  ARKIV_METADATA_SCHEMA_VERSION,
  EXPERIMENT_METADATA_FIELDS,
  type ExperimentMetadata,
  isExperimentStatus,
  MAX_LIFETIME_DAYS,
  TERMINAL_STATUSES,
} from "./schema.js";

/** One thing that stopped a candidate record from being published. */
export type ValidationIssue = {
  readonly field: string;
  readonly code:
    | "unknown-field"
    | "wrong-type"
    | "invalid-value"
    | "missing-field"
    | "out-of-range"
    | "forbidden-content"
    | "inconsistent";
  readonly message: string;
};

export type ValidationResult =
  | { readonly ok: true; readonly metadata: ExperimentMetadata }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export const EVIDENCE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const EXPERIMENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EXPERIMENT_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SCENARIO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/;
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Shapes that never belong in a public Arkiv record: endpoint URLs, credential
 * labels, private keys, opaque tokens, embedded quotes and path separators.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /wss?:\/\//i,
  /\brpc[.:]/i,
  /\bbearer[\s=:]/i,
  /\bapi[_ -]?key[\s=:]/i,
  /\baccess[_ -]?key[\s=:]/i,
  /\bprivate[_ -]?key[\s=:]/i,
  /\bsecret[\s=:]/i,
  /^0x[0-9a-fA-F]{64}$/,
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  /["'\\;]/,
];

/** True when a string carries something the publish allowlist forbids. */
export function hasForbiddenContent(value: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value));
}

const REQUIRED_FIELDS = [
  "schemaVersion",
  "experimentId",
  "experimentType",
  "scenarioName",
  "targetChainId",
  "status",
  "startedAtMs",
  "requestCount",
  "succeededCount",
  "failedCount",
  "rpcFailureCount",
  "evidenceDigest",
  "expiryDays",
] as const;

const INTEGER_FIELDS = [
  "targetChainId",
  "startedAtMs",
  "completedAtMs",
  "requestCount",
  "succeededCount",
  "failedCount",
  "rpcFailureCount",
  "expiryDays",
] as const;

const LATENCY_FIELDS = ["averageMs", "p50Ms", "p95Ms", "maxMs"] as const;

/** Millisecond timestamp range that a `u64` Arkiv attribute can carry. */
const MAX_TIMESTAMP_MS = Number.MAX_SAFE_INTEGER;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates a candidate record against the strict allowlist.
 *
 * Unknown keys are rejected rather than dropped; every free string is checked
 * for credential-shaped content; a terminal result must carry a completion
 * time, and an unfinished run is labelled `idle`/`running` instead of being
 * published as a finished experiment.
 *
 * On success the returned record is a frozen copy. The input is never mutated.
 */
export function validateExperimentMetadata(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: "$", code: "wrong-type", message: "expected an object" },
      ],
    };
  }

  const candidate = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const raw: Record<string, unknown> = { ...candidate };

  for (const key of Object.keys(candidate)) {
    if (!(EXPERIMENT_METADATA_FIELDS as readonly string[]).includes(key)) {
      issues.push({
        field: key,
        code: "unknown-field",
        message: `field "${key}" is not in the Arkiv metadata allowlist`,
      });
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (candidate[field] === undefined) {
      issues.push({
        field,
        code: "missing-field",
        message: `required field "${field}" is missing`,
      });
    }
  }

  const drop = (field: string, issue: ValidationIssue) => {
    issues.push(issue);
    delete raw[field];
  };

  if (raw.schemaVersion !== ARKIV_METADATA_SCHEMA_VERSION) {
    drop("schemaVersion", {
      field: "schemaVersion",
      code: "invalid-value",
      message: `schemaVersion must be "${ARKIV_METADATA_SCHEMA_VERSION}"`,
    });
  }

  const readString = (field: string): string | undefined => {
    const value = raw[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      drop(field, {
        field,
        code: "wrong-type",
        message: `${field} must be a string`,
      });
      return undefined;
    }
    return value;
  };

  const checkPattern = (field: string, pattern: RegExp, expected: string) => {
    const value = readString(field);
    if (value === undefined) return;
    if (!pattern.test(value) || hasForbiddenContent(value)) {
      drop(field, {
        field,
        code: "invalid-value",
        message: `${field} must be ${expected}`,
      });
    }
  };

  checkPattern(
    "experimentId",
    EXPERIMENT_ID_PATTERN,
    "a lowercase slug (a-z0-9-)",
  );
  checkPattern(
    "experimentType",
    EXPERIMENT_TYPE_PATTERN,
    "a lowercase type slug",
  );
  checkPattern(
    "scenarioName",
    SCENARIO_NAME_PATTERN,
    "a short plain-text label",
  );

  const status = raw.status;
  if (status !== undefined) {
    if (!isExperimentStatus(status)) {
      drop("status", {
        field: "status",
        code: "invalid-value",
        message:
          "status must be one of idle|running|passed|failed|partial|inconclusive",
      });
    } else if (
      TERMINAL_STATUSES.includes(status) &&
      raw.completedAtMs === undefined
    ) {
      issues.push({
        field: "completedAtMs",
        code: "missing-field",
        message: `a "${status}" record must carry completedAtMs`,
      });
      delete raw.status;
    }
  }

  for (const field of INTEGER_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!isNonNegativeInteger(value) || value > MAX_TIMESTAMP_MS) {
      drop(field, {
        field,
        code: "wrong-type",
        message: `${field} must be a non-negative safe integer`,
      });
    }
  }

  if (
    typeof raw.startedAtMs === "number" &&
    typeof raw.completedAtMs === "number" &&
    raw.completedAtMs < raw.startedAtMs
  ) {
    drop("completedAtMs", {
      field: "completedAtMs",
      code: "inconsistent",
      message: "completedAtMs is before startedAtMs",
    });
  }

  if (
    typeof raw.requestCount === "number" &&
    typeof raw.succeededCount === "number" &&
    typeof raw.failedCount === "number" &&
    raw.succeededCount + raw.failedCount > raw.requestCount
  ) {
    drop("requestCount", {
      field: "requestCount",
      code: "inconsistent",
      message: "succeededCount + failedCount exceeds requestCount",
    });
  }

  if (
    typeof raw.rpcFailureCount === "number" &&
    typeof raw.failedCount === "number" &&
    raw.rpcFailureCount > raw.failedCount
  ) {
    drop("rpcFailureCount", {
      field: "rpcFailureCount",
      code: "inconsistent",
      message: "rpcFailureCount exceeds failedCount",
    });
  }

  if (typeof raw.expiryDays === "number") {
    if (raw.expiryDays < 1 || raw.expiryDays > MAX_LIFETIME_DAYS) {
      drop("expiryDays", {
        field: "expiryDays",
        code: "out-of-range",
        message: `expiryDays must be between 1 and ${MAX_LIFETIME_DAYS}`,
      });
    }
  }

  const digest = readString("evidenceDigest");
  if (digest !== undefined && !EVIDENCE_DIGEST_PATTERN.test(digest)) {
    drop("evidenceDigest", {
      field: "evidenceDigest",
      code: "invalid-value",
      message: "evidenceDigest must be 64 lowercase hex characters",
    });
  }

  const ref = readString("evidenceRef");
  if (
    ref !== undefined &&
    (ref.length > 200 ||
      ref.startsWith("/") ||
      ref.includes("\\") ||
      ref.includes("..") ||
      !EVIDENCE_REF_PATTERN.test(ref))
  ) {
    drop("evidenceRef", {
      field: "evidenceRef",
      code: "invalid-value",
      message: "evidenceRef must be a relative, non-credential path",
    });
  }

  if (raw.latency !== undefined) {
    const latency = raw.latency;
    const lat =
      typeof latency === "object" && latency !== null && !Array.isArray(latency)
        ? (latency as Record<string, unknown>)
        : undefined;
    if (lat === undefined) {
      drop("latency", {
        field: "latency",
        code: "wrong-type",
        message: "latency must be an object with millisecond fields",
      });
    } else if (
      Object.keys(lat).some(
        (key) => !(LATENCY_FIELDS as readonly string[]).includes(key),
      )
    ) {
      drop("latency", {
        field: "latency",
        code: "unknown-field",
        message: "latency carries a field outside the allowlist",
      });
    } else {
      const bad = LATENCY_FIELDS.find((key) => {
        const value = lat[key];
        return !(
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0
        );
      });
      if (bad !== undefined) {
        drop(`latency.${bad}`, {
          field: `latency.${bad}`,
          code: "wrong-type",
          message: `latency.${bad} must be a non-negative finite number`,
        });
        delete raw.latency;
      } else {
        const average = lat.averageMs as number;
        const p50 = lat.p50Ms as number;
        const p95 = lat.p95Ms as number;
        const max = lat.maxMs as number;
        if (average > max || p50 > p95 || p95 > max) {
          drop("latency", {
            field: "latency",
            code: "inconsistent",
            message:
              "latency percentiles must be ordered average <= p50 <= p95 <= max",
          });
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const built: ExperimentMetadata = {
    schemaVersion: ARKIV_METADATA_SCHEMA_VERSION,
    experimentId: raw.experimentId as string,
    experimentType: raw.experimentType as string,
    scenarioName: raw.scenarioName as string,
    targetChainId: raw.targetChainId as number,
    status: raw.status as ExperimentMetadata["status"],
    startedAtMs: raw.startedAtMs as number,
    ...(raw.completedAtMs === undefined
      ? {}
      : { completedAtMs: raw.completedAtMs as number }),
    requestCount: raw.requestCount as number,
    succeededCount: raw.succeededCount as number,
    failedCount: raw.failedCount as number,
    rpcFailureCount: raw.rpcFailureCount as number,
    ...(raw.latency === undefined
      ? {}
      : { latency: raw.latency as NonNullable<ExperimentMetadata["latency"]> }),
    evidenceDigest: raw.evidenceDigest as string,
    ...(raw.evidenceRef === undefined
      ? {}
      : { evidenceRef: raw.evidenceRef as string }),
    expiryDays: raw.expiryDays as number,
  };

  return { ok: true, metadata: Object.freeze(built) };
}

/**
 * Deterministic JSON of the record, in the allowlist's fixed key order, so the
 * same record always produces the same bytes.
 */
export function metadataToJson(metadata: ExperimentMetadata): string {
  return JSON.stringify(metadata, null, 2);
}
