import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExperimentResult } from "@blocklab/core";

export const EVIDENCE_SCHEMA_VERSION = "1.0" as const;
export const RPC_BLACKOUT_SCENARIO_VERSION = "1.0.0" as const;

export type EvidencePhase = "baseline" | "fault" | "recovery";
export type EvaluationStatus = "passed" | "failed" | "inconclusive";
export type TerminalState = "completed" | "failed" | "cancelled" | "timed_out";

export type EvidenceOutcome =
  | "forwarded_success"
  | "forwarded_error"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "injected_blackout"
  | "invalid_request"
  | "proxy_error";

const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = [
  "forwarded_success",
  "forwarded_error",
  "upstream_timeout",
  "upstream_unavailable",
  "injected_blackout",
  "invalid_request",
  "proxy_error",
];

export interface BlackoutSchedule {
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
}

export interface EvidenceExecutionLike {
  readonly executionId: string;
  readonly state: TerminalState;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface ReplayConfiguration {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  readonly scenarioId: "rpc-blackout";
  readonly scenarioVersion: typeof RPC_BLACKOUT_SCENARIO_VERSION;
  readonly configuration: BlackoutSchedule;
}

export interface ReplayRequest {
  readonly replayId: string;
  readonly executionId: string;
  readonly scenarioId: "rpc-blackout";
  readonly scenarioVersion: typeof RPC_BLACKOUT_SCENARIO_VERSION;
  readonly configuration: BlackoutSchedule;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    value.correlationId.length === 0
  ) {
    throw new EvidenceValidationError(`Observation ${index} is invalid.`);
  }
}

export function validateEvidence(
  value: unknown,
): asserts value is RpcBlackoutEvidence {
  if (!isObject(value)) {
    throw new EvidenceValidationError("Evidence record must be an object.");
  }
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new EvidenceValidationError(
      `Unsupported evidence schema version: ${String(value.schemaVersion)}.`,
    );
  }
  if (
    typeof value.recordId !== "string" ||
    typeof value.executionId !== "string" ||
    value.scenarioId !== "rpc-blackout" ||
    value.scenarioVersion !== RPC_BLACKOUT_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError(
      "Unsupported or incomplete scenario identity.",
    );
  }
  assertSchedule(value.configuration);
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
      phase: classifyObservation(record.timestamp, startedAt, schedule),
      timestamp: record.timestamp,
      method: record.method,
      outcome: record.outcome,
      injected: record.injected,
      latencyMs: record.latencyMs,
      ...(record.errorCategory === undefined
        ? {}
        : { errorCategory: record.errorCategory }),
      correlationId: record.correlationId,
    }))
    .sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.correlationId.localeCompare(right.correlationId),
    );
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

export function toReplayConfiguration(
  evidence: RpcBlackoutEvidence,
): ReplayConfiguration {
  validateEvidence(evidence);
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    scenarioId: "rpc-blackout",
    scenarioVersion: RPC_BLACKOUT_SCENARIO_VERSION,
    configuration: evidence.configuration,
  };
}

export function replayConfiguration(value: unknown): ReplayRequest {
  if (!isObject(value) || value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new EvidenceValidationError(
      "Unsupported replay evidence schema version.",
    );
  }
  if (
    value.scenarioId !== "rpc-blackout" ||
    value.scenarioVersion !== RPC_BLACKOUT_SCENARIO_VERSION
  ) {
    throw new EvidenceValidationError("Unsupported replay scenario version.");
  }
  assertSchedule(value.configuration);
  return {
    replayId: randomUUID(),
    executionId: randomUUID(),
    scenarioId: "rpc-blackout",
    scenarioVersion: RPC_BLACKOUT_SCENARIO_VERSION,
    configuration: value.configuration,
  };
}

function configEqual(left: BlackoutSchedule, right: BlackoutSchedule): boolean {
  return (
    left.startOffsetMs === right.startOffsetMs &&
    left.durationMs === right.durationMs &&
    left.experimentDurationMs === right.experimentDurationMs
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
  left: RpcBlackoutEvidence,
  right: RpcBlackoutEvidence,
): EvidenceComparison {
  validateEvidence(left);
  validateEvidence(right);
  if (left.schemaVersion !== right.schemaVersion) {
    throw new EvidenceValidationError(
      "Evidence records use incompatible schema versions.",
    );
  }
  const sameConfiguration = configEqual(
    left.configuration,
    right.configuration,
  );
  const differences: string[] = [];
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
  evidence: RpcBlackoutEvidence,
): Promise<void> {
  validateEvidence(evidence);
  await mkdir(dirname(path), { recursive: true });
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
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readEvidence(path: string): Promise<RpcBlackoutEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new EvidenceValidationError(
      `Could not read evidence file: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
  validateEvidence(parsed);
  return parsed;
}

export async function listEvidence(
  directory: string,
): Promise<readonly RpcBlackoutEvidence[]> {
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
  const records: RpcBlackoutEvidence[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    records.push(await readEvidence(join(directory, name)));
  }
  return records;
}

export function toJsonReport(evidence: RpcBlackoutEvidence): string;
export function toJsonReport(result: ExperimentResult): string;
export function toJsonReport(
  value: RpcBlackoutEvidence | ExperimentResult,
): string {
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
