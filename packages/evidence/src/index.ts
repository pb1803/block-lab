import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExperimentResult } from "@blocklab/core";
import {
  REPORT_MAX_OBSERVATIONS,
  REPORT_MAX_PAGE_SIZE,
  REPORT_MAX_RESPONSE_BYTES,
  REPORT_PROTOCOL_VERSION,
  type ReportConfiguration,
  type ReportDetail,
  type ReportEvaluation,
  type ReportEvaluationPhase,
  type ReportIntegrityStatus,
  type ReportListResponse,
  type ReportMetrics,
  type ReportObservation,
  type ReportSummary,
} from "@blocklab/core";

export const EVIDENCE_SCHEMA_VERSION = "1.0" as const;
export const RPC_BLACKOUT_SCENARIO_VERSION = "1.0.0" as const;
export const RPC_LATENCY_SCENARIO_VERSION = "1.0.0" as const;
export const RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION = "1.0.0" as const;
export const RPC_RATE_LIMIT_SCENARIO_VERSION = "1.0.0" as const;
export const RPC_CONNECTION_FAILURE_SCENARIO_VERSION = "1.0.0" as const;
export const RPC_MALFORMED_RESPONSE_SCENARIO_VERSION = "1.0.0" as const;

export type EvidencePhase = "baseline" | "fault" | "recovery";
export type EvaluationStatus = "passed" | "failed" | "inconclusive";
export type TerminalState = "completed" | "failed" | "cancelled" | "timed_out";

export type EvidenceOutcome =
  | "forwarded_success"
  | "forwarded_error"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "injected_blackout"
  | "injected_failure"
  | "rate_limited"
  | "injected_connection_failure"
  | "injected_malformed_response"
  | "invalid_request"
  | "proxy_error";

const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = [
  "forwarded_success",
  "forwarded_error",
  "upstream_timeout",
  "upstream_unavailable",
  "injected_blackout",
  "injected_failure",
  "rate_limited",
  "injected_connection_failure",
  "injected_malformed_response",
  "invalid_request",
  "proxy_error",
];

export interface BlackoutSchedule {
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface LatencySchedule {
  readonly delayMs: number;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface IntermittentFailureSchedule {
  readonly startOffsetMs: number;
  readonly failureDurationMs: number;
  readonly recoveryIntervalMs: number;
  readonly windowCount: number;
  readonly experimentDurationMs?: number;
  readonly httpStatus?: number;
}

export interface RateLimitSchedule {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly cooldownMs?: number;
  readonly retryAfterSeconds?: number;
  readonly experimentDurationMs?: number;
}

export interface ConnectionFailureSchedule {
  readonly faultMode: "connection-reset" | "premature-close";
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface MalformedResponseSchedule {
  readonly faultMode:
    | "invalid-json"
    | "missing-version"
    | "missing-result-and-error"
    | "missing-id"
    | "mismatched-id"
    | "invalid-structure";
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface EvidenceObservation {
  readonly phase: EvidencePhase;
  readonly timestamp: string;
  readonly method: string;
  readonly outcome: EvidenceOutcome;
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly errorCategory?: string;
  readonly correlationId: string;
  readonly requestTimestamp?: string;
  readonly injectedDelayMs?: number;
}

export interface EvidenceMetrics {
  readonly totalRequests: number;
  readonly requestsByPhase: Readonly<Record<EvidencePhase, number>>;
  readonly successfulForwardedRequests: number;
  readonly upstreamErrors: number;
  readonly injectedBlackoutFailures: number;
  readonly invalidRequests: number;
  readonly averageLatencyMs?: number;
  readonly medianLatencyMs?: number;
  readonly recoverySuccessCount: number;
  readonly recoveryLatencyMs?: number;
  readonly baselineAverageLatencyMs?: number;
  readonly faultAverageLatencyMs?: number;
  readonly recoveryAverageLatencyMs?: number;
  readonly injectedRequestCount: number;
  readonly observedAdditionalLatencyMs?: number;
}

export interface PhaseEvaluation {
  readonly status: EvaluationStatus;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

export interface ExperimentEvaluation {
  readonly status: EvaluationStatus;
  readonly baseline: PhaseEvaluation;
  readonly fault: PhaseEvaluation;
  readonly recovery: PhaseEvaluation;
  readonly reasons: readonly string[];
  readonly explanation: string;
  readonly metrics: EvidenceMetrics;
  readonly warnings: readonly string[];
}

export interface RpcBlackoutEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-blackout";
  readonly scenarioVersion: typeof RPC_BLACKOUT_SCENARIO_VERSION;
  readonly configuration: BlackoutSchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export interface RpcLatencyEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-latency";
  readonly scenarioVersion: typeof RPC_LATENCY_SCENARIO_VERSION;
  readonly configuration: LatencySchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export interface RpcIntermittentFailureEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-intermittent-failure";
  readonly scenarioVersion: typeof RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION;
  readonly configuration: IntermittentFailureSchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export interface RpcRateLimitEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-rate-limit";
  readonly scenarioVersion: typeof RPC_RATE_LIMIT_SCENARIO_VERSION;
  readonly configuration: RateLimitSchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export interface RpcConnectionFailureEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-connection-failure";
  readonly scenarioVersion: typeof RPC_CONNECTION_FAILURE_SCENARIO_VERSION;
  readonly configuration: ConnectionFailureSchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export interface RpcMalformedResponseEvidence {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly recordId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-malformed-response";
  readonly scenarioVersion: typeof RPC_MALFORMED_RESPONSE_SCENARIO_VERSION;
  readonly configuration: MalformedResponseSchedule;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly terminalState: TerminalState;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceDigest: string;
  readonly evaluation: ExperimentEvaluation;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

export type EvidenceSchedule =
  | BlackoutSchedule
  | LatencySchedule
  | IntermittentFailureSchedule
  | RateLimitSchedule
  | ConnectionFailureSchedule
  | MalformedResponseSchedule;

export type EvidenceRecord =
  | RpcBlackoutEvidence
  | RpcLatencyEvidence
  | RpcIntermittentFailureEvidence
  | RpcRateLimitEvidence
  | RpcConnectionFailureEvidence
  | RpcMalformedResponseEvidence;

export interface ProxyEvidenceLike {
  readonly executionId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly outcome: EvidenceOutcome;
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly errorCategory?: string;
  readonly requestTimestamp?: string;
  readonly injectedDelayMs?: number;
}

export interface EvidenceExecutionLike {
  readonly executionId: string;
  readonly state: TerminalState;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface ReplayConfiguration {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly scenarioId:
    | "rpc-blackout"
    | "rpc-latency"
    | "rpc-intermittent-failure"
    | "rpc-rate-limit"
    | "rpc-connection-failure"
    | "rpc-malformed-response";
  readonly scenarioVersion:
    | typeof RPC_BLACKOUT_SCENARIO_VERSION
    | typeof RPC_LATENCY_SCENARIO_VERSION
    | typeof RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION
    | typeof RPC_RATE_LIMIT_SCENARIO_VERSION
    | typeof RPC_CONNECTION_FAILURE_SCENARIO_VERSION
    | typeof RPC_MALFORMED_RESPONSE_SCENARIO_VERSION;
  readonly configuration: EvidenceSchedule;
}

export interface ReplayRequest {
  readonly replayId: string;
  readonly executionId: string;
  readonly scenarioId: ReplayConfiguration["scenarioId"];
  readonly scenarioVersion: ReplayConfiguration["scenarioVersion"];
  readonly configuration: EvidenceSchedule;
}

export interface ComparisonMetric {
  readonly name: string;
  readonly left?: number | string;
  readonly right?: number | string;
  readonly comparable: boolean;
  readonly note?: string;
}

export interface EvidenceComparison {
  readonly comparable: boolean;
  readonly differences: readonly string[];
  readonly metrics: readonly ComparisonMetric[];
  readonly evaluation: ComparisonMetric;
  readonly warnings: readonly string[];
}

export class EvidenceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export const MAX_EVIDENCE_FILE_BYTES = REPORT_MAX_RESPONSE_BYTES;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_OBSERVATION_METHOD_LENGTH = 256;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_DIAGNOSTIC_LENGTH = 1_024;
const MAX_TEXT_ARRAY_LENGTH = 64;
const MAX_TOTAL_OBJECT_KEYS = 8_192;
const MAX_JSON_DEPTH = 12;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface EvidenceIntegrity {
  readonly status: ReportIntegrityStatus;
  readonly error?: string;
}

export type EvidenceIntegrityResult =
  | {
      readonly integrity: { readonly status: "verified" };
      readonly evidence: EvidenceRecord;
    }
  | {
      readonly integrity: EvidenceIntegrity & {
        readonly status: Exclude<ReportIntegrityStatus, "verified">;
      };
      readonly evidence?: never;
    };

function digestInput(evidence: EvidenceRecord): Record<string, unknown> {
  return {
    schemaVersion: evidence.schemaVersion,
    executionId: evidence.executionId,
    scenarioId: evidence.scenarioId,
    scenarioVersion: evidence.scenarioVersion,
    configuration: evidence.configuration,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    terminalState: evidence.terminalState,
    observations: evidence.observations,
    evaluation: evidence.evaluation,
  };
}

export function calculateEvidenceDigest(evidence: EvidenceRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(digestInput(evidence)))
    .digest("hex");
}

export function verifyEvidenceDigest(evidence: EvidenceRecord): boolean {
  return (
    typeof evidence.evidenceDigest === "string" &&
    /^[0-9a-f]{64}$/.test(evidence.evidenceDigest) &&
    calculateEvidenceDigest(evidence) === evidence.evidenceDigest
  );
}

export function inspectEvidenceIntegrity(value: unknown): EvidenceIntegrity {
  if (!isObject(value)) {
    return { status: "malformed", error: "Evidence record must be an object." };
  }
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    return {
      status: "unsupported-version",
      error: "Evidence schema version is unsupported.",
    };
  }
  if (value.evidenceDigest === undefined) {
    return { status: "missing-digest", error: "Evidence digest is missing." };
  }
  try {
    validateEvidence(value);
  } catch (error) {
    return {
      status: "malformed",
      error: error instanceof Error ? error.message : "Evidence is malformed.",
    };
  }
  if (!verifyEvidenceDigest(value)) {
    return {
      status: "digest-mismatch",
      error: "Evidence digest does not match its content.",
    };
  }
  return { status: "verified" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSafeIdentifier(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new EvidenceValidationError(`${field} is invalid.`);
  }
}

function assertEvidenceBounds(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (
    current: unknown,
    depth: number,
    keys: { count: number },
  ): void => {
    if (depth > MAX_JSON_DEPTH)
      throw new EvidenceValidationError("Evidence nesting exceeds the limit.");
    if (typeof current === "string") {
      if (current.length > MAX_DIAGNOSTIC_LENGTH)
        throw new EvidenceValidationError("Evidence string exceeds the limit.");
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (seen.has(current))
      throw new EvidenceValidationError("Evidence contains a cycle.");
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > REPORT_MAX_OBSERVATIONS)
        throw new EvidenceValidationError("Evidence array exceeds the limit.");
      for (const item of current) visit(item, depth + 1, keys);
    } else {
      const entries = Object.entries(current);
      keys.count += entries.length;
      if (entries.length > 128 || keys.count > MAX_TOTAL_OBJECT_KEYS) {
        throw new EvidenceValidationError("Evidence object exceeds the limit.");
      }
      for (const [key, item] of entries) {
        if (key.length > 128)
          throw new EvidenceValidationError(
            "Evidence field name exceeds the limit.",
          );
        visit(item, depth + 1, keys);
      }
    }
    seen.delete(current);
  };
  visit(value, 0, { count: 0 });
  try {
    if (
      Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_EVIDENCE_FILE_BYTES
    ) {
      throw new EvidenceValidationError(
        "Evidence exceeds the maximum supported size.",
      );
    }
  } catch (error) {
    if (error instanceof EvidenceValidationError) throw error;
    throw new EvidenceValidationError("Evidence cannot be serialized.");
  }
}

function assertTimestamp(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new EvidenceValidationError(`${name} must be a valid ISO timestamp.`);
  }
}

function assertSchedule(
  schedule: unknown,
): asserts schedule is BlackoutSchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError("Blackout configuration is required.");
  }
  const startOffsetMs = schedule.startOffsetMs;
  const durationMs = schedule.durationMs;
  const experimentDurationMs = schedule.experimentDurationMs;
  if (
    typeof startOffsetMs !== "number" ||
    !Number.isInteger(startOffsetMs) ||
    startOffsetMs < 0 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new EvidenceValidationError(
      "Blackout offsets must be non-negative and duration must be positive integers.",
    );
  }
  if (
    experimentDurationMs !== undefined &&
    (typeof experimentDurationMs !== "number" ||
      !Number.isInteger(experimentDurationMs) ||
      experimentDurationMs <= 0 ||
      startOffsetMs + durationMs > experimentDurationMs)
  ) {
    throw new EvidenceValidationError(
      "Blackout must fit within the experiment duration.",
    );
  }
}

function assertLatencySchedule(
  schedule: unknown,
): asserts schedule is LatencySchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError("Latency configuration is required.");
  }
  const delayMs = schedule.delayMs;
  const startOffsetMs = schedule.startOffsetMs;
  const durationMs = schedule.durationMs;
  const experimentDurationMs = schedule.experimentDurationMs;
  if (
    typeof delayMs !== "number" ||
    !Number.isInteger(delayMs) ||
    delayMs <= 0 ||
    typeof startOffsetMs !== "number" ||
    !Number.isInteger(startOffsetMs) ||
    startOffsetMs < 0 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new EvidenceValidationError(
      "Latency delay and duration must be positive integers; start offset must be non-negative.",
    );
  }
  if (
    experimentDurationMs !== undefined &&
    (typeof experimentDurationMs !== "number" ||
      !Number.isInteger(experimentDurationMs) ||
      experimentDurationMs <= 0 ||
      startOffsetMs + durationMs > experimentDurationMs)
  ) {
    throw new EvidenceValidationError(
      "Latency fault window must fit within the experiment duration.",
    );
  }
}

function assertIntermittentFailureSchedule(
  schedule: unknown,
): asserts schedule is IntermittentFailureSchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError(
      "Intermittent failure configuration is required.",
    );
  }
  const { startOffsetMs, failureDurationMs, recoveryIntervalMs, windowCount } =
    schedule;
  if (
    typeof startOffsetMs !== "number" ||
    !Number.isInteger(startOffsetMs) ||
    startOffsetMs < 0 ||
    typeof failureDurationMs !== "number" ||
    !Number.isInteger(failureDurationMs) ||
    failureDurationMs <= 0 ||
    typeof recoveryIntervalMs !== "number" ||
    !Number.isInteger(recoveryIntervalMs) ||
    recoveryIntervalMs <= 0 ||
    typeof windowCount !== "number" ||
    !Number.isInteger(windowCount) ||
    windowCount <= 0
  ) {
    throw new EvidenceValidationError(
      "Intermittent failure schedule must have valid integer window parameters.",
    );
  }
  const totalSpan =
    startOffsetMs +
    windowCount * failureDurationMs +
    (windowCount - 1) * recoveryIntervalMs;
  assertOptionalExperimentDuration(schedule, totalSpan);
  if (
    schedule.httpStatus !== undefined &&
    (typeof schedule.httpStatus !== "number" ||
      !Number.isInteger(schedule.httpStatus) ||
      schedule.httpStatus < 400 ||
      schedule.httpStatus > 599)
  ) {
    throw new EvidenceValidationError(
      "Intermittent failure HTTP status must be between 400 and 599.",
    );
  }
}

function assertOptionalExperimentDuration(
  schedule: Record<string, unknown>,
  requiredDurationMs?: number,
): void {
  const duration = schedule.experimentDurationMs;
  if (
    duration !== undefined &&
    (typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration <= 0 ||
      (requiredDurationMs !== undefined && requiredDurationMs > duration))
  ) {
    throw new EvidenceValidationError(
      "Fault schedule must fit within a positive experiment duration.",
    );
  }
}

function assertRateLimitSchedule(
  schedule: unknown,
): asserts schedule is RateLimitSchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError("Rate limit configuration is required.");
  }
  const { maxRequests, windowMs } = schedule;
  if (
    typeof maxRequests !== "number" ||
    !Number.isInteger(maxRequests) ||
    maxRequests <= 0 ||
    typeof windowMs !== "number" ||
    !Number.isInteger(windowMs) ||
    windowMs <= 0
  ) {
    throw new EvidenceValidationError(
      "Rate limit configuration must define valid integer maxRequests and windowMs.",
    );
  }
  if (
    schedule.cooldownMs !== undefined &&
    (typeof schedule.cooldownMs !== "number" ||
      !Number.isInteger(schedule.cooldownMs) ||
      schedule.cooldownMs < 0)
  ) {
    throw new EvidenceValidationError(
      "Rate limit cooldown must be a non-negative integer.",
    );
  }
  if (
    schedule.retryAfterSeconds !== undefined &&
    (typeof schedule.retryAfterSeconds !== "number" ||
      !Number.isInteger(schedule.retryAfterSeconds) ||
      schedule.retryAfterSeconds <= 0)
  ) {
    throw new EvidenceValidationError(
      "Rate limit Retry-After must be a positive integer.",
    );
  }
  assertOptionalExperimentDuration(schedule);
}

function assertConnectionFailureSchedule(
  schedule: unknown,
): asserts schedule is ConnectionFailureSchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError(
      "Connection failure configuration is required.",
    );
  }
  const { faultMode, startOffsetMs, durationMs } = schedule;
  if (
    (faultMode !== "connection-reset" && faultMode !== "premature-close") ||
    typeof startOffsetMs !== "number" ||
    !Number.isInteger(startOffsetMs) ||
    startOffsetMs < 0 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new EvidenceValidationError(
      "Connection failure configuration must include a valid fault mode and positive duration.",
    );
  }
  assertOptionalExperimentDuration(schedule, startOffsetMs + durationMs);
}

function assertMalformedResponseSchedule(
  schedule: unknown,
): asserts schedule is MalformedResponseSchedule {
  if (!isObject(schedule)) {
    throw new EvidenceValidationError(
      "Malformed response configuration is required.",
    );
  }
  const { faultMode, startOffsetMs, durationMs } = schedule;
  if (
    ![
      "invalid-json",
      "missing-version",
      "missing-result-and-error",
      "missing-id",
      "mismatched-id",
      "invalid-structure",
    ].includes(String(faultMode)) ||
    typeof startOffsetMs !== "number" ||
    !Number.isInteger(startOffsetMs) ||
    startOffsetMs < 0 ||
    typeof durationMs !== "number" ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0
  ) {
    throw new EvidenceValidationError(
      "Malformed response configuration must include a valid mode and positive window.",
    );
  }
  assertOptionalExperimentDuration(schedule, startOffsetMs + durationMs);
}

function assertObservation(
  value: unknown,
  index: number,
): asserts value is EvidenceObservation {
  if (!isObject(value)) {
    throw new EvidenceValidationError(
      `Observation ${index} must be an object.`,
    );
  }
  assertTimestamp(value.timestamp, `Observation ${index} timestamp`);
  if (value.requestTimestamp !== undefined)
    assertTimestamp(
      value.requestTimestamp,
      `Observation ${index} request timestamp`,
    );
  if (
    typeof value.phase !== "string" ||
    !["baseline", "fault", "recovery"].includes(value.phase) ||
    typeof value.method !== "string" ||
    typeof value.outcome !== "string" ||
    !EVIDENCE_OUTCOMES.includes(value.outcome as EvidenceOutcome) ||
    typeof value.injected !== "boolean" ||
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0 ||
    typeof value.correlationId !== "string" ||
    value.correlationId.length === 0 ||
    value.method.length === 0 ||
    value.method.length > MAX_OBSERVATION_METHOD_LENGTH ||
    value.correlationId.length > MAX_CORRELATION_ID_LENGTH
  ) {
    throw new EvidenceValidationError(`Observation ${index} is invalid.`);
  }
  if (
    value.injectedDelayMs !== undefined &&
    (typeof value.injectedDelayMs !== "number" ||
      !Number.isFinite(value.injectedDelayMs) ||
      value.injectedDelayMs < 0)
  ) {
    throw new EvidenceValidationError(
      `Observation ${index} injected delay is invalid.`,
    );
  }
}

export function validateEvidence(
  value: unknown,
): asserts value is EvidenceRecord {
  if (!isObject(value)) {
    throw new EvidenceValidationError("Evidence record must be an object.");
  }
  assertEvidenceBounds(value);
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new EvidenceValidationError(
      `Unsupported evidence schema version: ${String(value.schemaVersion)}.`,
    );
  }
  if (
    !(
      (value.scenarioId === "rpc-blackout" &&
        value.scenarioVersion === RPC_BLACKOUT_SCENARIO_VERSION) ||
      (value.scenarioId === "rpc-latency" &&
        value.scenarioVersion === RPC_LATENCY_SCENARIO_VERSION) ||
      (value.scenarioId === "rpc-intermittent-failure" &&
        value.scenarioVersion === RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION) ||
      (value.scenarioId === "rpc-rate-limit" &&
        value.scenarioVersion === RPC_RATE_LIMIT_SCENARIO_VERSION) ||
      (value.scenarioId === "rpc-connection-failure" &&
        value.scenarioVersion === RPC_CONNECTION_FAILURE_SCENARIO_VERSION) ||
      (value.scenarioId === "rpc-malformed-response" &&
        value.scenarioVersion === RPC_MALFORMED_RESPONSE_SCENARIO_VERSION)
    )
  ) {
    throw new EvidenceValidationError(
      "Unsupported or incomplete scenario identity.",
    );
  }
  assertSafeIdentifier(value.recordId, "recordId");
  assertSafeIdentifier(value.executionId, "executionId");
  switch (value.scenarioId) {
    case "rpc-blackout":
      assertSchedule(value.configuration);
      break;
    case "rpc-latency":
      assertLatencySchedule(value.configuration);
      break;
    case "rpc-intermittent-failure":
      assertIntermittentFailureSchedule(value.configuration);
      break;
    case "rpc-rate-limit":
      assertRateLimitSchedule(value.configuration);
      break;
    case "rpc-connection-failure":
      assertConnectionFailureSchedule(value.configuration);
      break;
    case "rpc-malformed-response":
      assertMalformedResponseSchedule(value.configuration);
      break;
    default:
      throw new EvidenceValidationError(
        `Unsupported scenario id: ${String(value.scenarioId)}.`,
      );
  }
  assertTimestamp(value.startedAt, "startedAt");
  assertTimestamp(value.finishedAt, "finishedAt");
  if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    throw new EvidenceValidationError("finishedAt cannot precede startedAt.");
  }
  if (
    !["completed", "failed", "cancelled", "timed_out"].includes(
      String(value.terminalState),
    ) ||
    !Array.isArray(value.observations) ||
    value.observations.length > REPORT_MAX_OBSERVATIONS ||
    typeof value.evidenceDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.evidenceDigest)
  ) {
    throw new EvidenceValidationError(
      "Evidence terminal state or observations are invalid.",
    );
  }
  const ids = new Set<string>();
  value.observations.forEach((observation, index) => {
    assertObservation(observation, index);
    if (ids.has(observation.correlationId)) {
      throw new EvidenceValidationError(
        `Duplicate observation correlation ID: ${observation.correlationId}.`,
      );
    }
    ids.add(observation.correlationId);
  });
  if (!isObject(value.evaluation)) {
    throw new EvidenceValidationError("Evaluation is required.");
  }
  if (
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.limitations) ||
    value.warnings.length > MAX_TEXT_ARRAY_LENGTH ||
    value.limitations.length > MAX_TEXT_ARRAY_LENGTH
  ) {
    throw new EvidenceValidationError("Evidence diagnostics are invalid.");
  }
  for (const diagnostic of [...value.warnings, ...value.limitations]) {
    if (
      typeof diagnostic !== "string" ||
      diagnostic.length > MAX_DIAGNOSTIC_LENGTH
    ) {
      throw new EvidenceValidationError("Evidence diagnostic is invalid.");
    }
  }
}

function redactDiagnostic(value: string): string {
  const withoutHeaders = value
    .replace(
      /\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi,
      "Authorization: [REDACTED_SECRET]",
    )
    .replace(
      /\bAuthorization\s*:\s*[^\s,;]+/gi,
      "Authorization: [REDACTED_SECRET]",
    )
    .replace(/\bX-API-Key\s*:\s*[^\s,;]+/gi, "X-API-Key: [REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\x2f=-]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(
      /\b(?:AWS|AZURE|GCP|GOOGLE|GITHUB|NPM|DATABASE|DB)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*[^\s,;]+/g,
      "[REDACTED_SECRET]",
    )
    .replace(
      /(["']?)(?:api[_-]?key|access[_-]?key|secret|token|password|private[_-]?key)\1\s*[:=]\s*["']?[^"',}\s]+["']?/gi,
      "[REDACTED_SECRET]",
    );
  const withoutCredentials = withoutHeaders.replace(
    /\bhttps?:\/\/[^\s"'<>]+/gi,
    (candidate) => {
      try {
        return new URL(candidate).origin;
      } catch {
        return "[REDACTED_URL]";
      }
    },
  );
  return withoutCredentials
    .replace(/(?:\\\\|\/\/)[^\\/\s]+(?:\\[^\\/\s]+)+/g, "[REDACTED_PATH]")
    .replace(/\b[A-Za-z]:\\[^"'<>]+/g, "[REDACTED_PATH]")
    .replace(/(?:^|\s)~\/[^ "'<>]*/g, " [REDACTED_PATH]")
    .replace(/(?:^|\s)\/(?:[^ "'<>]+\/)+[^ "'<>]*/g, " [REDACTED_PATH]")
    .slice(0, 1_024);
}

function reportConfiguration(evidence: EvidenceRecord): ReportConfiguration {
  const allowed = new Set(
    evidence.scenarioId === "rpc-blackout"
      ? ["startOffsetMs", "durationMs", "experimentDurationMs"]
      : evidence.scenarioId === "rpc-latency"
        ? ["delayMs", "startOffsetMs", "durationMs", "experimentDurationMs"]
        : evidence.scenarioId === "rpc-intermittent-failure"
          ? [
              "startOffsetMs",
              "failureDurationMs",
              "recoveryIntervalMs",
              "windowCount",
              "experimentDurationMs",
              "httpStatus",
            ]
          : evidence.scenarioId === "rpc-rate-limit"
            ? [
                "maxRequests",
                "windowMs",
                "cooldownMs",
                "retryAfterSeconds",
                "experimentDurationMs",
              ]
            : [
                "faultMode",
                "startOffsetMs",
                "durationMs",
                "experimentDurationMs",
              ],
  );
  const configuration: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(evidence.configuration)) {
    if (
      !allowed.has(key) ||
      (typeof value !== "number" && typeof value !== "string")
    ) {
      throw new EvidenceValidationError("Evidence configuration is unsafe.");
    }
    configuration[key] = value;
  }
  return configuration;
}

function reportMetrics(metrics: EvidenceMetrics): ReportMetrics {
  return {
    totalRequests: metrics.totalRequests,
    requestsByPhase: metrics.requestsByPhase,
    successfulForwardedRequests: metrics.successfulForwardedRequests,
    upstreamErrors: metrics.upstreamErrors,
    injectedBlackoutFailures: metrics.injectedBlackoutFailures,
    invalidRequests: metrics.invalidRequests,
    recoverySuccessCount: metrics.recoverySuccessCount,
    injectedRequestCount: metrics.injectedRequestCount,
    ...(metrics.averageLatencyMs === undefined
      ? {}
      : { averageLatencyMs: metrics.averageLatencyMs }),
    ...(metrics.medianLatencyMs === undefined
      ? {}
      : { medianLatencyMs: metrics.medianLatencyMs }),
    ...(metrics.recoveryLatencyMs === undefined
      ? {}
      : { recoveryLatencyMs: metrics.recoveryLatencyMs }),
    ...(metrics.baselineAverageLatencyMs === undefined
      ? {}
      : { baselineAverageLatencyMs: metrics.baselineAverageLatencyMs }),
    ...(metrics.faultAverageLatencyMs === undefined
      ? {}
      : { faultAverageLatencyMs: metrics.faultAverageLatencyMs }),
    ...(metrics.recoveryAverageLatencyMs === undefined
      ? {}
      : { recoveryAverageLatencyMs: metrics.recoveryAverageLatencyMs }),
    ...(metrics.observedAdditionalLatencyMs === undefined
      ? {}
      : { observedAdditionalLatencyMs: metrics.observedAdditionalLatencyMs }),
  };
}

function reportEvaluationPhase(phase: PhaseEvaluation): ReportEvaluationPhase {
  return {
    status: phase.status,
    reasons: phase.reasons.map(redactDiagnostic).slice(0, 64),
    explanation: redactDiagnostic(phase.explanation),
  };
}

function reportEvaluation(evaluation: ExperimentEvaluation): ReportEvaluation {
  return {
    status: evaluation.status,
    baseline: reportEvaluationPhase(evaluation.baseline),
    fault: reportEvaluationPhase(evaluation.fault),
    recovery: reportEvaluationPhase(evaluation.recovery),
    reasons: evaluation.reasons.map(redactDiagnostic).slice(0, 64),
    explanation: redactDiagnostic(evaluation.explanation),
    metrics: reportMetrics(evaluation.metrics),
    warnings: evaluation.warnings.map(redactDiagnostic).slice(0, 64),
  };
}

function reportObservations(
  observations: readonly EvidenceObservation[],
): readonly ReportObservation[] {
  if (observations.length > REPORT_MAX_OBSERVATIONS) {
    throw new EvidenceValidationError("Report observations exceed the limit.");
  }
  return observations.map((observation) => ({
    phase: observation.phase,
    timestamp: observation.timestamp,
    method: observation.method,
    outcome: observation.outcome,
    injected: observation.injected,
    latencyMs: observation.latencyMs,
    ...(observation.errorCategory === undefined
      ? {}
      : { errorCategory: redactDiagnostic(observation.errorCategory) }),
    correlationId: observation.correlationId,
    ...(observation.requestTimestamp === undefined
      ? {}
      : { requestTimestamp: observation.requestTimestamp }),
    ...(observation.injectedDelayMs === undefined
      ? {}
      : { injectedDelayMs: observation.injectedDelayMs }),
  }));
}

export function toReportSummary(evidence: EvidenceRecord): ReportSummary {
  validateEvidence(evidence);
  const integrity = inspectEvidenceIntegrity(evidence);
  return {
    executionId: evidence.executionId,
    recordId: evidence.recordId,
    scenarioId: evidence.scenarioId,
    scenarioVersion: evidence.scenarioVersion,
    terminalState: evidence.terminalState,
    evaluation: reportEvaluation(evidence.evaluation),
    startedAt: evidence.startedAt,
    completedAt: evidence.finishedAt,
    evidenceDigest: evidence.evidenceDigest,
    integrityStatus: integrity.status,
  };
}

export function toReportDetail(evidence: EvidenceRecord): ReportDetail {
  const summary = toReportSummary(evidence);
  const detail: ReportDetail = {
    ...summary,
    configuration: reportConfiguration(evidence),
    observations: reportObservations(evidence.observations),
    diagnostics: {
      warnings: evidence.warnings.map(redactDiagnostic).slice(0, 64),
      limitations: evidence.limitations.map(redactDiagnostic).slice(0, 64),
    },
  };
  if (
    Buffer.byteLength(JSON.stringify(detail), "utf8") >
    REPORT_MAX_RESPONSE_BYTES
  ) {
    throw new EvidenceValidationError(
      "Report exceeds the maximum response size.",
    );
  }
  return detail;
}

export function toReportListResponse(
  projectId: string,
  evidence: readonly EvidenceRecord[],
  nextCursor?: string,
  totalCount = evidence.length,
): ReportListResponse {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId)) {
    throw new EvidenceValidationError("Project identifier is invalid.");
  }
  if (evidence.length > REPORT_MAX_PAGE_SIZE) {
    throw new EvidenceValidationError("Report page exceeds the maximum size.");
  }
  const response: ReportListResponse = {
    protocolVersion: REPORT_PROTOCOL_VERSION,
    projectId,
    totalCount,
    reports: evidence.map(toReportSummary),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    throw new EvidenceValidationError("Report list cannot be serialized.");
  }
  if (Buffer.byteLength(serialized, "utf8") > REPORT_MAX_RESPONSE_BYTES) {
    throw new EvidenceValidationError(
      "Report list exceeds the maximum response size.",
    );
  }
  return response;
}

function scheduleEnd(startedAt: string, schedule: BlackoutSchedule): number {
  return Date.parse(startedAt) + schedule.startOffsetMs + schedule.durationMs;
}

export function classifyObservation(
  timestamp: string,
  startedAt: string,
  schedule: BlackoutSchedule,
): EvidencePhase {
  const elapsed = Date.parse(timestamp) - Date.parse(startedAt);
  if (elapsed < schedule.startOffsetMs) return "baseline";
  if (elapsed < schedule.startOffsetMs + schedule.durationMs) return "fault";
  return "recovery";
}

export function normalizeProxyEvidence(
  records: readonly ProxyEvidenceLike[],
  startedAt: string,
  schedule: BlackoutSchedule,
): readonly EvidenceObservation[] {
  assertTimestamp(startedAt, "startedAt");
  assertSchedule(schedule);
  return records
    .map((record) => ({
      phase: classifyObservation(
        record.requestTimestamp ?? record.timestamp,
        startedAt,
        schedule,
      ),
      timestamp: record.timestamp,
      ...(record.requestTimestamp === undefined
        ? {}
        : { requestTimestamp: record.requestTimestamp }),
      method: record.method,
      outcome: record.outcome,
      injected: record.injected,
      latencyMs: record.latencyMs,
      ...(record.errorCategory === undefined
        ? {}
        : { errorCategory: record.errorCategory }),
      correlationId: record.correlationId,
      ...(record.injectedDelayMs === undefined
        ? {}
        : { injectedDelayMs: record.injectedDelayMs }),
    }))
    .sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.correlationId.localeCompare(right.correlationId),
    );
}

export function normalizeLatencyProxyEvidence(
  records: readonly ProxyEvidenceLike[],
  startedAt: string,
  schedule: LatencySchedule,
): readonly EvidenceObservation[] {
  assertTimestamp(startedAt, "startedAt");
  assertLatencySchedule(schedule);
  return records
    .map((record) => ({
      phase: classifyObservation(
        record.requestTimestamp ?? record.timestamp,
        startedAt,
        schedule,
      ),
      timestamp: record.timestamp,
      ...(record.requestTimestamp === undefined
        ? {}
        : { requestTimestamp: record.requestTimestamp }),
      method: record.method,
      outcome: record.outcome,
      injected: record.injected,
      latencyMs: record.latencyMs,
      ...(record.errorCategory === undefined
        ? {}
        : { errorCategory: record.errorCategory }),
      correlationId: record.correlationId,
      ...(record.injectedDelayMs === undefined
        ? {}
        : { injectedDelayMs: record.injectedDelayMs }),
    }))
    .sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.correlationId.localeCompare(right.correlationId),
    );
}

function normalizeScenarioProxyEvidence(
  records: readonly ProxyEvidenceLike[],
  classify: (record: ProxyEvidenceLike) => EvidencePhase,
): readonly EvidenceObservation[] {
  return [...records]
    .sort(
      (left, right) =>
        Date.parse(left.requestTimestamp ?? left.timestamp) -
          Date.parse(right.requestTimestamp ?? right.timestamp) ||
        left.correlationId.localeCompare(right.correlationId),
    )
    .map((record) => ({
      phase: classify(record),
      timestamp: record.timestamp,
      ...(record.requestTimestamp === undefined
        ? {}
        : { requestTimestamp: record.requestTimestamp }),
      method: record.method,
      outcome: record.outcome,
      injected: record.injected,
      latencyMs: record.latencyMs,
      ...(record.errorCategory === undefined
        ? {}
        : { errorCategory: record.errorCategory }),
      correlationId: record.correlationId,
      ...(record.injectedDelayMs === undefined
        ? {}
        : { injectedDelayMs: record.injectedDelayMs }),
    }))
    .sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.correlationId.localeCompare(right.correlationId),
    );
}

function classifyScheduledRequest(
  record: ProxyEvidenceLike,
  startedAt: string,
  startOffsetMs: number,
  durationMs: number,
): EvidencePhase {
  const elapsed =
    Date.parse(record.requestTimestamp ?? record.timestamp) -
    Date.parse(startedAt);
  return elapsed < startOffsetMs
    ? "baseline"
    : elapsed < startOffsetMs + durationMs
      ? "fault"
      : "recovery";
}

function evaluateInjectedFault(
  observations: readonly EvidenceObservation[],
  startedAt: string,
  schedule: BlackoutSchedule,
  expectedOutcome: EvidenceOutcome,
  scenarioName: string,
): ExperimentEvaluation {
  const metrics = calculateMetrics(observations, startedAt, schedule);
  const baselineObservations = phaseObservations(observations, "baseline");
  const faultObservations = phaseObservations(observations, "fault");
  const recoveryObservations = phaseObservations(observations, "recovery");
  const baselineHealthy =
    baselineObservations.length > 0 &&
    baselineObservations.every(
      (observation) => observation.outcome === "forwarded_success",
    );
  const injectedFaultObserved = faultObservations.some(
    (observation) =>
      observation.outcome === expectedOutcome && observation.injected,
  );
  const recoveryObserved = recoveryObservations.some(
    (observation) => observation.outcome === "forwarded_success",
  );
  const baseline = phase(
    baselineObservations.length === 0
      ? "inconclusive"
      : baselineHealthy
        ? "passed"
        : "failed",
    baselineObservations.length === 0
      ? ["baseline_missing"]
      : baselineHealthy
        ? ["baseline_established"]
        : ["baseline_unhealthy"],
    baselineObservations.length === 0
      ? "No baseline request was observed."
      : baselineHealthy
        ? "Baseline requests were forwarded successfully."
        : "One or more baseline requests did not forward successfully.",
  );
  const fault = phase(
    injectedFaultObserved ? "passed" : "inconclusive",
    injectedFaultObserved
      ? ["injected_fault_observed"]
      : faultObservations.length === 0
        ? ["fault_observation_missing"]
        : ["configured_fault_not_observed"],
    injectedFaultObserved
      ? `The proxy recorded the configured ${scenarioName} fault.`
      : "No request was proven to receive the configured injected fault.",
  );
  const recovery = phase(
    recoveryObserved
      ? "passed"
      : recoveryObservations.length === 0
        ? "inconclusive"
        : "failed",
    recoveryObserved
      ? ["recovery_observed"]
      : recoveryObservations.length === 0
        ? ["recovery_observation_missing"]
        : ["recovery_failed"],
    recoveryObserved
      ? "A request was forwarded successfully after the fault."
      : recoveryObservations.length === 0
        ? "No post-fault request was observed."
        : "Recovery requests were observed but none succeeded.",
  );
  const phases = [baseline, fault, recovery];
  const status = phases.some((item) => item.status === "failed")
    ? "failed"
    : phases.every((item) => item.status === "passed")
      ? "passed"
      : "inconclusive";
  const reasons = phases.flatMap((item) => item.reasons);
  return {
    status,
    baseline,
    fault,
    recovery,
    reasons,
    explanation: `${scenarioName} evaluation is ${status}: ${phases
      .map((item) => item.explanation)
      .join(" ")}`,
    metrics,
    warnings:
      status === "inconclusive"
        ? ["Available observations do not establish every required phase."]
        : [],
  };
}

type AttackScenarioId =
  | "rpc-intermittent-failure"
  | "rpc-rate-limit"
  | "rpc-connection-failure"
  | "rpc-malformed-response";

type EvidenceRecordBase = Pick<
  RpcBlackoutEvidence,
  | "schemaVersion"
  | "recordId"
  | "executionId"
  | "startedAt"
  | "finishedAt"
  | "terminalState"
  | "observations"
  | "evidenceDigest"
  | "evaluation"
  | "warnings"
  | "limitations"
>;

function buildAttackEvidenceBase(
  execution: EvidenceExecutionLike,
  scenarioId: AttackScenarioId,
  scenarioVersion: string,
  configuration: EvidenceSchedule,
  observations: readonly EvidenceObservation[],
  evaluation: ExperimentEvaluation,
  options: {
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  },
  defaultLimitations: readonly string[],
): EvidenceRecordBase {
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  const finishedAt = execution.finishedAt ?? startedAt;
  const completedEvaluation =
    execution.state === "completed"
      ? evaluation
      : {
          ...evaluation,
          status: "inconclusive" as const,
          reasons: [...evaluation.reasons, "execution_not_completed"],
          explanation: `${evaluation.explanation} Execution ended as ${execution.state} before a complete experiment could be established.`,
          warnings: [
            ...evaluation.warnings,
            "Execution did not complete normally.",
          ],
        };
  const digestInput = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    executionId: execution.executionId,
    scenarioId,
    scenarioVersion,
    configuration,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evaluation: completedEvaluation,
  };
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    recordId: options.recordId ?? randomUUID(),
    executionId: execution.executionId,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evidenceDigest: createHash("sha256")
      .update(JSON.stringify(digestInput))
      .digest("hex"),
    evaluation: completedEvaluation,
    warnings: options.warnings ?? [],
    limitations: options.limitations ?? defaultLimitations,
  };
}

function phaseObservations(
  observations: readonly EvidenceObservation[],
  phase: EvidencePhase,
): readonly EvidenceObservation[] {
  return observations.filter((observation) => observation.phase === phase);
}

function average(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : Number(
        (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(
          3,
        ),
      );
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return Number(
    (sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0)
    ).toFixed(3),
  );
}

export function calculateMetrics(
  observations: readonly EvidenceObservation[],
  startedAt: string,
  schedule: BlackoutSchedule,
): EvidenceMetrics {
  const latencies = observations.map((observation) => observation.latencyMs);
  const successfulForwardedRequests = observations.filter(
    (observation) => observation.outcome === "forwarded_success",
  ).length;
  const upstreamErrors = observations.filter((observation) =>
    ["forwarded_error", "upstream_timeout", "upstream_unavailable"].includes(
      observation.outcome,
    ),
  ).length;
  const injectedBlackoutFailures = observations.filter(
    (observation) =>
      observation.outcome === "injected_blackout" && observation.injected,
  ).length;
  const invalidRequests = observations.filter(
    (observation) => observation.outcome === "invalid_request",
  ).length;
  const recovery = phaseObservations(observations, "recovery");
  const recoverySuccess = recovery.filter(
    (observation) => observation.outcome === "forwarded_success",
  );
  const end = scheduleEnd(startedAt, schedule);
  const firstRecovery = recoverySuccess[0];
  const averageLatencyMs = average(latencies);
  const medianLatencyMs = median(latencies);
  const baselineAverageLatencyMs = average(
    phaseObservations(observations, "baseline").map(
      (observation) => observation.latencyMs,
    ),
  );
  const faultAverageLatencyMs = average(
    phaseObservations(observations, "fault").map(
      (observation) => observation.latencyMs,
    ),
  );
  const recoveryAverageLatencyMs = average(
    phaseObservations(observations, "recovery").map(
      (observation) => observation.latencyMs,
    ),
  );
  const injected = observations.filter((observation) => observation.injected);
  const observedInjectedAverage = average(
    injected.map((observation) => observation.latencyMs),
  );
  const observedAdditionalLatencyMs =
    observedInjectedAverage === undefined ||
    baselineAverageLatencyMs === undefined
      ? undefined
      : Number((observedInjectedAverage - baselineAverageLatencyMs).toFixed(3));
  return {
    totalRequests: observations.length,
    requestsByPhase: {
      baseline: phaseObservations(observations, "baseline").length,
      fault: phaseObservations(observations, "fault").length,
      recovery: recovery.length,
    },
    successfulForwardedRequests,
    upstreamErrors,
    injectedBlackoutFailures,
    invalidRequests,
    ...(averageLatencyMs === undefined ? {} : { averageLatencyMs }),
    ...(medianLatencyMs === undefined ? {} : { medianLatencyMs }),
    recoverySuccessCount: recoverySuccess.length,
    injectedRequestCount: injected.length,
    ...(baselineAverageLatencyMs === undefined
      ? {}
      : { baselineAverageLatencyMs }),
    ...(faultAverageLatencyMs === undefined ? {} : { faultAverageLatencyMs }),
    ...(recoveryAverageLatencyMs === undefined
      ? {}
      : { recoveryAverageLatencyMs }),
    ...(observedAdditionalLatencyMs === undefined
      ? {}
      : { observedAdditionalLatencyMs }),
    ...(firstRecovery === undefined
      ? {}
      : {
          recoveryLatencyMs: Math.max(
            0,
            Date.parse(firstRecovery.timestamp) - end,
          ),
        }),
  };
}

function phase(
  status: EvaluationStatus,
  reasons: readonly string[],
  explanation: string,
): PhaseEvaluation {
  return { status, reasons, explanation };
}

export function evaluateRpcBlackout(
  observations: readonly EvidenceObservation[],
  startedAt: string,
  schedule: BlackoutSchedule,
): ExperimentEvaluation {
  const metrics = calculateMetrics(observations, startedAt, schedule);
  const baseline = phase(
    metrics.requestsByPhase.baseline === 0
      ? "inconclusive"
      : phaseObservations(observations, "baseline").some(
            (observation) => observation.outcome !== "forwarded_success",
          )
        ? "failed"
        : "passed",
    metrics.requestsByPhase.baseline === 0
      ? ["baseline_missing"]
      : phaseObservations(observations, "baseline").some(
            (observation) => observation.outcome !== "forwarded_success",
          )
        ? ["baseline_unhealthy"]
        : ["baseline_established"],
    metrics.requestsByPhase.baseline === 0
      ? "No baseline request was observed."
      : "Baseline request observations established the pre-fault path.",
  );
  const fault = phase(
    metrics.injectedBlackoutFailures > 0 ? "passed" : "inconclusive",
    metrics.injectedBlackoutFailures > 0
      ? ["blackout_observed"]
      : metrics.requestsByPhase.fault === 0
        ? ["fault_observation_missing"]
        : ["no_injected_blackout_observed"],
    metrics.injectedBlackoutFailures > 0
      ? "At least one request was blocked by the configured blackout."
      : "No request was proven to fail because of the configured blackout.",
  );
  const recovery = phase(
    metrics.recoverySuccessCount > 0
      ? "passed"
      : metrics.requestsByPhase.recovery === 0
        ? "inconclusive"
        : "failed",
    metrics.recoverySuccessCount > 0
      ? ["recovery_observed"]
      : metrics.requestsByPhase.recovery === 0
        ? ["recovery_observation_missing"]
        : ["recovery_failed"],
    metrics.recoverySuccessCount > 0
      ? "A post-blackout request was successfully forwarded."
      : metrics.requestsByPhase.recovery === 0
        ? "No post-blackout request was observed."
        : "Recovery requests were observed but none succeeded.",
  );
  const phases = [baseline, fault, recovery];
  const status = phases.some((item) => item.status === "failed")
    ? "failed"
    : phases.every((item) => item.status === "passed")
      ? "passed"
      : "inconclusive";
  const reasons = phases.flatMap((item) => item.reasons);
  return {
    status,
    baseline,
    fault,
    recovery,
    reasons,
    explanation: `RPC blackout evaluation is ${status}: ${[
      baseline.explanation,
      fault.explanation,
      recovery.explanation,
    ].join(" ")}`,
    metrics,
    warnings:
      status === "inconclusive"
        ? ["Available observations do not establish every required phase."]
        : [],
  };
}

export function evaluateRpcLatency(
  observations: readonly EvidenceObservation[],
  startedAt: string,
  schedule: LatencySchedule,
): ExperimentEvaluation {
  const metrics = calculateMetrics(observations, startedAt, schedule);
  const baseline = phase(
    metrics.requestsByPhase.baseline === 0 ? "inconclusive" : "passed",
    metrics.requestsByPhase.baseline === 0
      ? ["baseline_missing"]
      : ["baseline_established"],
    metrics.requestsByPhase.baseline === 0
      ? "No baseline request was observed."
      : "Baseline request observations established the pre-fault latency.",
  );
  const fault = phase(
    metrics.injectedRequestCount > 0 &&
      metrics.observedAdditionalLatencyMs !== undefined &&
      metrics.observedAdditionalLatencyMs >= Math.max(0, schedule.delayMs - 5)
      ? "passed"
      : "inconclusive",
    metrics.injectedRequestCount === 0
      ? ["fault_observation_missing"]
      : metrics.observedAdditionalLatencyMs === undefined
        ? ["baseline_latency_missing"]
        : metrics.observedAdditionalLatencyMs < schedule.delayMs
          ? ["configured_delay_not_observed"]
          : ["latency_injection_observed"],
    metrics.injectedRequestCount === 0
      ? "No request was proven to enter the latency interval."
      : metrics.observedAdditionalLatencyMs === undefined
        ? "Observed latency could not be compared with a baseline."
        : `Injected requests observed ${metrics.observedAdditionalLatencyMs}ms of additional latency.`,
  );
  const recovery = phase(
    metrics.requestsByPhase.recovery === 0
      ? "inconclusive"
      : metrics.recoveryAverageLatencyMs === undefined
        ? "inconclusive"
        : "passed",
    metrics.requestsByPhase.recovery === 0
      ? ["recovery_observation_missing"]
      : ["recovery_observed"],
    metrics.requestsByPhase.recovery === 0
      ? "No post-fault request was observed."
      : "Post-fault requests were observed after the latency interval.",
  );
  const phases = [baseline, fault, recovery];
  const status = phases.some((item) => item.status === "failed")
    ? "failed"
    : phases.every((item) => item.status === "passed")
      ? "passed"
      : "inconclusive";
  const reasons = phases.flatMap((item) => item.reasons);
  return {
    status,
    baseline,
    fault,
    recovery,
    reasons,
    explanation: `RPC latency evaluation is ${status}: ${[
      baseline.explanation,
      fault.explanation,
      recovery.explanation,
    ].join(" ")}`,
    metrics,
    warnings:
      status === "inconclusive"
        ? ["Available observations do not establish every required phase."]
        : [],
  };
}

export function createRpcBlackoutEvidence(
  execution: EvidenceExecutionLike,
  schedule: BlackoutSchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcBlackoutEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_BLACKOUT_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-blackout scenario version: ${options.scenarioVersion}.`,
    );
  }
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  const finishedAt = execution.finishedAt ?? startedAt;
  const observations = normalizeProxyEvidence(records, startedAt, schedule);
  const evaluation = evaluateRpcBlackout(observations, startedAt, schedule);
  const completedEvaluation =
    execution.state === "completed" || evaluation.status === "failed"
      ? evaluation
      : {
          ...evaluation,
          status: "inconclusive" as const,
          reasons: [...evaluation.reasons, "execution_not_completed"],
          explanation: `${evaluation.explanation} Execution ended as ${execution.state} before a complete experiment could be established.`,
          warnings: [
            ...evaluation.warnings,
            "Execution did not complete normally.",
          ],
        };
  const digestInput = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    executionId: execution.executionId,
    scenarioId: "rpc-blackout",
    scenarioVersion: RPC_BLACKOUT_SCENARIO_VERSION,
    configuration: schedule,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evaluation: completedEvaluation,
  };
  const evidenceDigest = createHash("sha256")
    .update(JSON.stringify(digestInput))
    .digest("hex");
  const evidence: RpcBlackoutEvidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    recordId: options.recordId ?? randomUUID(),
    executionId: execution.executionId,
    scenarioId: "rpc-blackout",
    scenarioVersion: RPC_BLACKOUT_SCENARIO_VERSION,
    configuration: schedule,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evidenceDigest,
    evaluation: completedEvaluation,
    warnings: options.warnings ?? [],
    limitations: options.limitations ?? [
      "Evaluation proves proxy/request behavior, not automatic application failover.",
    ],
  };
  validateEvidence(evidence);
  return evidence;
}

export function createRpcLatencyEvidence(
  execution: EvidenceExecutionLike,
  schedule: LatencySchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcLatencyEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_LATENCY_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-latency scenario version: ${options.scenarioVersion}.`,
    );
  }
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  const finishedAt = execution.finishedAt ?? startedAt;
  const observations = normalizeLatencyProxyEvidence(
    records,
    startedAt,
    schedule,
  );
  const evaluation = evaluateRpcLatency(observations, startedAt, schedule);
  const completedEvaluation =
    execution.state === "completed" || evaluation.status === "failed"
      ? evaluation
      : {
          ...evaluation,
          status: "inconclusive" as const,
          reasons: [...evaluation.reasons, "execution_not_completed"],
          explanation: `${evaluation.explanation} Execution ended as ${execution.state} before a complete experiment could be established.`,
          warnings: [
            ...evaluation.warnings,
            "Execution did not complete normally.",
          ],
        };
  const digestInput = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    executionId: execution.executionId,
    scenarioId: "rpc-latency",
    scenarioVersion: RPC_LATENCY_SCENARIO_VERSION,
    configuration: schedule,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evaluation: completedEvaluation,
  };
  const evidence: RpcLatencyEvidence = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    recordId: options.recordId ?? randomUUID(),
    executionId: execution.executionId,
    scenarioId: "rpc-latency",
    scenarioVersion: RPC_LATENCY_SCENARIO_VERSION,
    configuration: schedule,
    startedAt,
    finishedAt,
    terminalState: execution.state,
    observations,
    evidenceDigest: createHash("sha256")
      .update(JSON.stringify(digestInput))
      .digest("hex"),
    evaluation: completedEvaluation,
    warnings: options.warnings ?? [],
    limitations: options.limitations ?? [
      "Evaluation proves proxy/request latency behavior, not automatic application resilience.",
      "Observed latency includes local proxy and upstream timing; it is not a network-only measurement.",
    ],
  };
  validateEvidence(evidence);
  return evidence;
}

export function createRpcIntermittentFailureEvidence(
  execution: EvidenceExecutionLike,
  schedule: IntermittentFailureSchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcIntermittentFailureEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-intermittent-failure scenario version: ${options.scenarioVersion}.`,
    );
  }
  assertIntermittentFailureSchedule(schedule);
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  assertTimestamp(startedAt, "startedAt");
  const cycleDuration =
    schedule.failureDurationMs + schedule.recoveryIntervalMs;
  const observations = normalizeScenarioProxyEvidence(records, (record) => {
    const elapsed =
      Date.parse(record.requestTimestamp ?? record.timestamp) -
      Date.parse(startedAt);
    if (elapsed < schedule.startOffsetMs) return "baseline";
    const withinSchedule = elapsed - schedule.startOffsetMs;
    const index = Math.floor(withinSchedule / cycleDuration);
    if (index >= schedule.windowCount) return "recovery";
    return withinSchedule % cycleDuration < schedule.failureDurationMs
      ? "fault"
      : "recovery";
  });
  const lastFailureEnd =
    schedule.startOffsetMs +
    schedule.windowCount * schedule.failureDurationMs +
    (schedule.windowCount - 1) * schedule.recoveryIntervalMs;
  const evaluation = evaluateInjectedFault(
    observations,
    startedAt,
    {
      startOffsetMs: schedule.startOffsetMs,
      durationMs: lastFailureEnd - schedule.startOffsetMs,
    },
    "injected_failure",
    "RPC intermittent failure",
  );
  const base = buildAttackEvidenceBase(
    execution,
    "rpc-intermittent-failure",
    RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION,
    schedule,
    observations,
    evaluation,
    options,
    [
      "Evaluation proves proxy/request fault timing, not application resilience.",
    ],
  );
  const evidence: RpcIntermittentFailureEvidence = {
    ...base,
    scenarioId: "rpc-intermittent-failure",
    scenarioVersion: RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION,
    configuration: schedule,
  };
  validateEvidence(evidence);
  return evidence;
}

export function createRpcRateLimitEvidence(
  execution: EvidenceExecutionLike,
  schedule: RateLimitSchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcRateLimitEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_RATE_LIMIT_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-rate-limit scenario version: ${options.scenarioVersion}.`,
    );
  }
  assertRateLimitSchedule(schedule);
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  assertTimestamp(startedAt, "startedAt");
  let throttled = false;
  const observations = normalizeScenarioProxyEvidence(records, (record) => {
    if (record.outcome === "rate_limited" && record.injected) {
      throttled = true;
      return "fault";
    }
    return throttled ? "recovery" : "baseline";
  });
  const evaluation = evaluateInjectedFault(
    observations,
    startedAt,
    { startOffsetMs: 0, durationMs: schedule.windowMs },
    "rate_limited",
    "RPC rate limit",
  );
  const base = buildAttackEvidenceBase(
    execution,
    "rpc-rate-limit",
    RPC_RATE_LIMIT_SCENARIO_VERSION,
    schedule,
    observations,
    evaluation,
    options,
    [
      "Evaluation proves rate-limit behavior observed by the proxy, not application-level resilience.",
    ],
  );
  const evidence: RpcRateLimitEvidence = {
    ...base,
    scenarioId: "rpc-rate-limit",
    scenarioVersion: RPC_RATE_LIMIT_SCENARIO_VERSION,
    configuration: schedule,
  };
  validateEvidence(evidence);
  return evidence;
}

export function createRpcConnectionFailureEvidence(
  execution: EvidenceExecutionLike,
  schedule: ConnectionFailureSchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcConnectionFailureEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_CONNECTION_FAILURE_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-connection-failure scenario version: ${options.scenarioVersion}.`,
    );
  }
  assertConnectionFailureSchedule(schedule);
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  assertTimestamp(startedAt, "startedAt");
  const observations = normalizeScenarioProxyEvidence(records, (record) =>
    classifyScheduledRequest(
      record,
      startedAt,
      schedule.startOffsetMs,
      schedule.durationMs,
    ),
  );
  const evaluation = evaluateInjectedFault(
    observations,
    startedAt,
    schedule,
    "injected_connection_failure",
    "RPC connection failure",
  );
  const base = buildAttackEvidenceBase(
    execution,
    "rpc-connection-failure",
    RPC_CONNECTION_FAILURE_SCENARIO_VERSION,
    schedule,
    observations,
    evaluation,
    options,
    [
      "Evaluation proves proxy transport failure timing, not application resilience to network instability.",
    ],
  );
  const evidence: RpcConnectionFailureEvidence = {
    ...base,
    scenarioId: "rpc-connection-failure",
    scenarioVersion: RPC_CONNECTION_FAILURE_SCENARIO_VERSION,
    configuration: schedule,
  };
  validateEvidence(evidence);
  return evidence;
}

export function createRpcMalformedResponseEvidence(
  execution: EvidenceExecutionLike,
  schedule: MalformedResponseSchedule,
  records: readonly ProxyEvidenceLike[],
  options: {
    readonly scenarioVersion?: string;
    readonly recordId?: string;
    readonly warnings?: readonly string[];
    readonly limitations?: readonly string[];
  } = {},
): RpcMalformedResponseEvidence {
  if (
    options.scenarioVersion !== undefined &&
    options.scenarioVersion !== RPC_MALFORMED_RESPONSE_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      `Unsupported rpc-malformed-response scenario version: ${options.scenarioVersion}.`,
    );
  }
  assertMalformedResponseSchedule(schedule);
  const startedAt = execution.startedAt ?? new Date(0).toISOString();
  assertTimestamp(startedAt, "startedAt");
  const observations = normalizeScenarioProxyEvidence(records, (record) =>
    classifyScheduledRequest(
      record,
      startedAt,
      schedule.startOffsetMs,
      schedule.durationMs,
    ),
  );
  const evaluation = evaluateInjectedFault(
    observations,
    startedAt,
    schedule,
    "injected_malformed_response",
    "RPC malformed response",
  );
  const base = buildAttackEvidenceBase(
    execution,
    "rpc-malformed-response",
    RPC_MALFORMED_RESPONSE_SCENARIO_VERSION,
    schedule,
    observations,
    evaluation,
    options,
    [
      "Evaluation proves malformed protocol behavior at the proxy boundary, not downstream application correctness.",
    ],
  );
  const evidence: RpcMalformedResponseEvidence = {
    ...base,
    scenarioId: "rpc-malformed-response",
    scenarioVersion: RPC_MALFORMED_RESPONSE_SCENARIO_VERSION,
    configuration: schedule,
  };
  validateEvidence(evidence);
  return evidence;
}

export function toReplayConfiguration(
  evidence: EvidenceRecord,
): ReplayConfiguration {
  validateEvidence(evidence);
  const scenarioId = evidence.scenarioId as ReplayConfiguration["scenarioId"];
  switch (scenarioId) {
    case "rpc-blackout":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-blackout",
        scenarioVersion: RPC_BLACKOUT_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    case "rpc-latency":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-latency",
        scenarioVersion: RPC_LATENCY_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    case "rpc-intermittent-failure":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-intermittent-failure",
        scenarioVersion: RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    case "rpc-rate-limit":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-rate-limit",
        scenarioVersion: RPC_RATE_LIMIT_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    case "rpc-connection-failure":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-connection-failure",
        scenarioVersion: RPC_CONNECTION_FAILURE_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    case "rpc-malformed-response":
      return {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        scenarioId: "rpc-malformed-response",
        scenarioVersion: RPC_MALFORMED_RESPONSE_SCENARIO_VERSION,
        configuration: evidence.configuration,
      };
    default:
      throw new EvidenceValidationError(
        `Unsupported scenario for replay configuration: ${String(scenarioId)}.`,
      );
  }
}

export function replayConfiguration(value: unknown): ReplayRequest {
  if (!isObject(value) || value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new EvidenceValidationError(
      "Unsupported replay evidence schema version.",
    );
  }
  const scenarioVersion =
    typeof value.scenarioVersion === "string"
      ? value.scenarioVersion
      : undefined;
  switch (value.scenarioId) {
    case "rpc-blackout":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_BLACKOUT_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertSchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-blackout",
        scenarioVersion: scenarioVersion ?? RPC_BLACKOUT_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    case "rpc-latency":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_LATENCY_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertLatencySchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-latency",
        scenarioVersion: scenarioVersion ?? RPC_LATENCY_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    case "rpc-intermittent-failure":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertIntermittentFailureSchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-intermittent-failure",
        scenarioVersion:
          scenarioVersion ?? RPC_INTERMITTENT_FAILURE_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    case "rpc-rate-limit":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_RATE_LIMIT_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertRateLimitSchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-rate-limit",
        scenarioVersion: scenarioVersion ?? RPC_RATE_LIMIT_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    case "rpc-connection-failure":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_CONNECTION_FAILURE_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertConnectionFailureSchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-connection-failure",
        scenarioVersion:
          scenarioVersion ?? RPC_CONNECTION_FAILURE_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    case "rpc-malformed-response":
      if (
        scenarioVersion !== undefined &&
        scenarioVersion !== RPC_MALFORMED_RESPONSE_SCENARIO_VERSION
      ) {
        throw new EvidenceValidationError(
          "Unsupported replay scenario version.",
        );
      }
      assertMalformedResponseSchedule(value.configuration);
      return {
        replayId: randomUUID(),
        executionId: randomUUID(),
        scenarioId: "rpc-malformed-response",
        scenarioVersion:
          scenarioVersion ?? RPC_MALFORMED_RESPONSE_SCENARIO_VERSION,
        configuration: value.configuration,
      };
    default:
      throw new EvidenceValidationError("Unsupported replay scenario version.");
  }
}

function configEqual(left: EvidenceSchedule, right: EvidenceSchedule): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1],
    )
  );
}

function metric(
  name: string,
  left: number | string | undefined,
  right: number | string | undefined,
  comparable: boolean,
  note?: string,
): ComparisonMetric {
  return {
    name,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    comparable,
    ...(note === undefined ? {} : { note }),
  };
}

export function compareEvidence(
  left: EvidenceRecord,
  right: EvidenceRecord,
): EvidenceComparison {
  validateEvidence(left);
  validateEvidence(right);
  if (left.schemaVersion !== right.schemaVersion) {
    throw new EvidenceValidationError(
      "Evidence records use incompatible schema versions.",
    );
  }
  const sameConfiguration =
    left.scenarioId === right.scenarioId &&
    configEqual(left.configuration, right.configuration);
  const differences: string[] = [];
  if (left.scenarioId !== right.scenarioId) differences.push("scenario_id");
  if (left.scenarioVersion !== right.scenarioVersion)
    differences.push("scenario_version");
  if (!sameConfiguration) differences.push("blackout_configuration");
  const names: readonly (
    | "totalRequests"
    | "successfulForwardedRequests"
    | "upstreamErrors"
    | "injectedBlackoutFailures"
    | "invalidRequests"
    | "averageLatencyMs"
    | "medianLatencyMs"
    | "recoverySuccessCount"
    | "recoveryLatencyMs"
  )[] = [
    "totalRequests",
    "successfulForwardedRequests",
    "upstreamErrors",
    "injectedBlackoutFailures",
    "invalidRequests",
    "averageLatencyMs",
    "medianLatencyMs",
    "recoverySuccessCount",
    "recoveryLatencyMs",
  ];
  const metrics = names.map((name) =>
    metric(
      name,
      left.evaluation.metrics[name] as number | undefined,
      right.evaluation.metrics[name] as number | undefined,
      sameConfiguration,
      sameConfiguration ? undefined : "Configurations differ.",
    ),
  );
  return {
    comparable: sameConfiguration,
    differences,
    metrics,
    evaluation: metric(
      "evaluation.status",
      left.evaluation.status,
      right.evaluation.status,
      true,
    ),
    warnings: [
      "Metric differences do not establish causation or application-level resilience.",
      ...(left.warnings ?? []),
      ...(right.warnings ?? []),
    ],
  };
}

export async function writeEvidence(
  path: string,
  evidence: EvidenceRecord,
): Promise<void> {
  validateEvidence(evidence);
  await mkdir(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_FILE_BYTES) {
    throw new EvidenceValidationError(
      "Evidence file exceeds the maximum supported size.",
    );
  }
  try {
    await readFile(path);
    throw new EvidenceValidationError(`Evidence file already exists: ${path}.`);
  } catch (error) {
    if (error instanceof EvidenceValidationError) throw error;
    if (
      !(
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readEvidence(path: string): Promise<EvidenceRecord> {
  let parsed: unknown;
  try {
    const metadata = await stat(path);
    if (metadata.size > MAX_EVIDENCE_FILE_BYTES) {
      throw new EvidenceValidationError(
        "Evidence file exceeds the maximum supported size.",
      );
    }
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof EvidenceValidationError) throw error;
    throw new EvidenceValidationError(
      `Could not read evidence file: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  validateEvidence(parsed);
  return parsed;
}

export async function readEvidenceWithIntegrity(
  path: string,
): Promise<EvidenceIntegrityResult> {
  try {
    const metadata = await stat(path);
    if (metadata.size > MAX_EVIDENCE_FILE_BYTES) {
      return {
        integrity: {
          status: "oversized",
          error: "Evidence file exceeds the maximum supported size.",
        },
      };
    }
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const integrity = inspectEvidenceIntegrity(parsed);
    if (integrity.status === "verified") {
      return {
        evidence: parsed as EvidenceRecord,
        integrity: { status: "verified" },
      };
    }
    return {
      integrity: {
        ...integrity,
        status: integrity.status as Exclude<ReportIntegrityStatus, "verified">,
      },
    };
  } catch (error) {
    return {
      integrity: {
        status: "malformed",
        error:
          error instanceof Error ? error.message : "Could not read evidence.",
      },
    };
  }
}

export async function listEvidence(
  directory: string,
): Promise<readonly EvidenceRecord[]> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    throw new EvidenceValidationError(
      `Could not list evidence files: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  const records: EvidenceRecord[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    records.push(await readEvidence(join(directory, name)));
  }
  return records;
}

export function toJsonReport(evidence: EvidenceRecord): string;
export function toJsonReport(result: ExperimentResult): string;
export function toJsonReport(value: EvidenceRecord | ExperimentResult): string {
  if ("schemaVersion" in value) {
    validateEvidence(value);
  }
  return JSON.stringify(value, null, 2);
}

export function evaluateCleanup(
  cleanupStatus: "completed" | "failed" | "not-attempted",
): "inconclusive" {
  void cleanupStatus;
  return "inconclusive";
}

export function toLegacyJsonReport(result: ExperimentResult): string {
  return toJsonReport(result);
}
