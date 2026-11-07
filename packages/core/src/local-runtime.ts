import type {
  AgentInspectionResponse,
  AuthorizedProject,
  DependencyEdge,
  DependencyNode,
  InspectionSummary,
  PackageManager,
} from "./index.js";

export const LOCAL_RUNTIME_PROTOCOL_VERSION = "1" as const;
export const LOCAL_RUNTIME_SERVICE = "blocklab-local-agent" as const;

const MAX_STRING_LENGTH = 4_096;
const MAX_ARRAY_LENGTH = 512;
const MAX_OBJECT_KEYS = 128;
const MAX_TOTAL_OBJECT_KEYS = 8_192;
const MAX_JSON_DEPTH = 12;

export interface LocalRuntimeHealth {
  readonly service: typeof LOCAL_RUNTIME_SERVICE;
  readonly runtimeId: string;
  readonly status: "ready";
  readonly protocolVersions: readonly string[];
}

export interface PairRequest {
  readonly pairingCode: string;
  readonly protocolVersions: readonly string[];
}

export interface BootstrapRequest {
  readonly bootstrapToken: string;
  readonly protocolVersions: readonly string[];
}

export interface PairResponse {
  readonly runtimeId: string;
  readonly protocolVersion: typeof LOCAL_RUNTIME_PROTOCOL_VERSION;
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
}

export interface AuthorizedProjectsResponse {
  readonly projects: readonly AuthorizedProject[];
}

export interface RuntimeErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly requestId: string;
  };
}

export interface RpcEndpointRegistration {
  readonly endpointId: string;
  readonly name: string;
  readonly url: string;
  readonly registrationKind: "loopback" | "remote";
  readonly approval: "registered" | "approved-loopback";
}

export const REPORT_PROTOCOL_VERSION = "1" as const;
export const REPORT_MAX_PAGE_SIZE = 64;
export const REPORT_MAX_RESPONSE_BYTES = 1_048_576;
export const REPORT_MAX_OBSERVATIONS = 512;

export type ReportScenarioId =
  | "rpc-blackout"
  | "rpc-latency"
  | "rpc-intermittent-failure"
  | "rpc-rate-limit"
  | "rpc-connection-failure"
  | "rpc-malformed-response";

export type ReportTerminalState =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type ReportEvaluationStatus = "passed" | "failed" | "inconclusive";

export type ReportIntegrityStatus =
  | "verified"
  | "missing-digest"
  | "digest-mismatch"
  | "unsupported-version"
  | "malformed"
  | "oversized";

export interface ReportMetrics {
  readonly totalRequests: number;
  readonly requestsByPhase: Readonly<
    Record<"baseline" | "fault" | "recovery", number>
  >;
  readonly successfulForwardedRequests: number;
  readonly upstreamErrors: number;
  readonly injectedBlackoutFailures: number;
  readonly invalidRequests: number;
  readonly recoverySuccessCount: number;
  readonly injectedRequestCount: number;
  readonly averageLatencyMs?: number;
  readonly medianLatencyMs?: number;
  readonly recoveryLatencyMs?: number;
  readonly baselineAverageLatencyMs?: number;
  readonly faultAverageLatencyMs?: number;
  readonly recoveryAverageLatencyMs?: number;
  readonly observedAdditionalLatencyMs?: number;
}

export interface ReportEvaluationPhase {
  readonly status: ReportEvaluationStatus;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

export interface ReportEvaluation {
  readonly status: ReportEvaluationStatus;
  readonly baseline: ReportEvaluationPhase;
  readonly fault: ReportEvaluationPhase;
  readonly recovery: ReportEvaluationPhase;
  readonly reasons: readonly string[];
  readonly explanation: string;
  readonly metrics: ReportMetrics;
  readonly warnings: readonly string[];
}

export interface ReportConfiguration {
  readonly [key: string]: number | string | undefined;
}

export interface ReportObservation {
  readonly phase: "baseline" | "fault" | "recovery";
  readonly timestamp: string;
  readonly method: string;
  readonly outcome: string;
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly errorCategory?: string;
  readonly correlationId: string;
  readonly requestTimestamp?: string;
  readonly injectedDelayMs?: number;
}

export interface ReportSummary {
  readonly executionId: string;
  readonly recordId: string;
  readonly scenarioId: ReportScenarioId;
  readonly scenarioVersion: string;
  readonly terminalState: ReportTerminalState;
  readonly evaluation: ReportEvaluation;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly evidenceDigest?: string;
  readonly integrityStatus: ReportIntegrityStatus;
}

export interface ReportDetail extends ReportSummary {
  readonly configuration: ReportConfiguration;
  readonly observations: readonly ReportObservation[];
  readonly diagnostics: {
    readonly warnings: readonly string[];
    readonly limitations: readonly string[];
  };
}

export interface ReportListResponse {
  readonly protocolVersion: typeof REPORT_PROTOCOL_VERSION;
  readonly projectId: string;
  readonly totalCount: number;
  readonly reports: readonly ReportSummary[];
  readonly nextCursor?: string;
}

export type ReportOperation =
  | "projects:read"
  | "projects:inspect"
  | "reports:list"
  | "reports:read";

export interface ReportCapabilities {
  readonly protocolVersion: typeof REPORT_PROTOCOL_VERSION;
  readonly operations: readonly ReportOperation[];
  readonly maximumPageSize: number;
  readonly maximumReportResponseBytes: number;
}

export class ProtocolValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

export class UnsupportedProtocolVersionError extends ProtocolValidationError {
  public constructor() {
    super("No supported Local Runtime protocol version was requested.");
    this.name = "UnsupportedProtocolVersionError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new ProtocolValidationError("Request must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ProtocolValidationError("Request contains an unknown field.");
    }
  }
}

function string(
  value: unknown,
  field: string,
  maxLength = MAX_STRING_LENGTH,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  maximum = MAX_ARRAY_LENGTH,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value.map((item) => string(item, field));
}

function assertJsonBounds(
  value: unknown,
  depth = 0,
  entries = { count: 0 },
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new ProtocolValidationError("JSON nesting exceeds the limit.");
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new ProtocolValidationError("JSON string exceeds the limit.");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProtocolValidationError("JSON number is invalid.");
    }
    return;
  }
  if (value === null || typeof value === "boolean" || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new ProtocolValidationError("JSON array exceeds the limit.");
    }
    for (const item of value) assertJsonBounds(item, depth + 1, entries);
    return;
  }
  const object = record(value);
  const keys = Object.keys(object);
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new ProtocolValidationError("JSON object exceeds the limit.");
  }
  entries.count += keys.length;
  if (entries.count > MAX_TOTAL_OBJECT_KEYS) {
    throw new ProtocolValidationError("JSON payload exceeds the limit.");
  }
  for (const [key, item] of Object.entries(object)) {
    if (key.length > 128) {
      throw new ProtocolValidationError("JSON field name exceeds the limit.");
    }
    assertJsonBounds(item, depth + 1, entries);
  }
}

function isPackageManager(value: unknown): value is PackageManager {
  return ["npm", "pnpm", "yarn", "bun"].includes(String(value));
}

function parseAuthorizedProject(value: unknown): AuthorizedProject {
  const project = record(value);
  strictKeys(project, [
    "projectId",
    "name",
    "rootIdentifier",
    "sourceType",
    "authorization",
  ]);
  if (project.sourceType !== "local" || project.authorization !== "explicit") {
    throw new ProtocolValidationError("Authorized project is invalid.");
  }
  return {
    projectId: string(project.projectId, "projectId", 128),
    name: string(project.name, "name", 256),
    rootIdentifier: string(project.rootIdentifier, "rootIdentifier", 128),
    sourceType: "local",
    authorization: "explicit",
  };
}

function parseDependencyNode(value: unknown): DependencyNode {
  const node = record(value);
  strictKeys(node, [
    "nodeId",
    "type",
    "name",
    "label",
    "evidenceSource",
    "evidence",
    "confidence",
    "metadata",
  ]);
  const types = [
    "application",
    "framework",
    "package-manager",
    "rpc",
    "chain",
    "contract",
    "wallet",
    "indexer",
    "unknown",
  ];
  const confidences = ["detected", "inferred", "user-declared"];
  if (
    !types.includes(String(node.type)) ||
    !confidences.includes(String(node.confidence))
  ) {
    throw new ProtocolValidationError("Inspection dependency is invalid.");
  }
  let metadata: Record<string, string> | undefined;
  if (node.metadata !== undefined) {
    const rawMetadata = record(node.metadata);
    if (Object.keys(rawMetadata).length > MAX_OBJECT_KEYS) {
      throw new ProtocolValidationError("Inspection metadata is invalid.");
    }
    metadata = {};
    for (const [key, value] of Object.entries(rawMetadata)) {
      metadata[string(key, "metadata key", 128)] = string(
        value,
        "metadata value",
      );
    }
  }
  return {
    nodeId: string(node.nodeId, "nodeId", 128),
    type: node.type as DependencyNode["type"],
    name: string(node.name, "dependency name", 256),
    label: string(node.label, "dependency label", 256),
    evidenceSource: string(node.evidenceSource, "evidence source", 256),
    evidence: string(node.evidence, "dependency evidence"),
    confidence: node.confidence as DependencyNode["confidence"],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseDependencyEdge(value: unknown): DependencyEdge {
  const edge = record(value);
  strictKeys(edge, [
    "edgeId",
    "fromNodeId",
    "toNodeId",
    "relationship",
    "evidenceSource",
    "confidence",
  ]);
  const confidences = ["detected", "inferred", "user-declared"];
  if (!confidences.includes(String(edge.confidence))) {
    throw new ProtocolValidationError("Inspection relationship is invalid.");
  }
  return {
    edgeId: string(edge.edgeId, "edgeId", 128),
    fromNodeId: string(edge.fromNodeId, "fromNodeId", 128),
    toNodeId: string(edge.toNodeId, "toNodeId", 128),
    relationship: string(edge.relationship, "relationship", 256),
    evidenceSource: string(edge.evidenceSource, "evidence source", 256),
    confidence: edge.confidence as DependencyEdge["confidence"],
  };
}

function parseInspectionSummary(value: unknown): InspectionSummary {
  const summary = record(value);
  strictKeys(summary, [
    "schemaVersion",
    "rootPath",
    "manifest",
    "packageManagers",
    "packageManagerConflict",
    "detectedStack",
    "dependencies",
    "edges",
    "chainIds",
    "networkNames",
    "rpcReferences",
    "limitations",
  ]);
  const packageManagers = stringArray(
    summary.packageManagers,
    "packageManagers",
    8,
  );
  const chainIds = summary.chainIds;
  if (
    summary.schemaVersion !== "1.0" ||
    !["present", "missing", "malformed"].includes(String(summary.manifest)) ||
    typeof summary.packageManagerConflict !== "boolean" ||
    !packageManagers.every(isPackageManager) ||
    !Array.isArray(summary.dependencies) ||
    !Array.isArray(summary.edges) ||
    !Array.isArray(chainIds) ||
    chainIds.length > MAX_ARRAY_LENGTH ||
    !chainIds.every(
      (chainId) =>
        typeof chainId === "number" &&
        Number.isSafeInteger(chainId) &&
        chainId >= 0,
    )
  ) {
    throw new ProtocolValidationError("Project inspection is invalid.");
  }
  return {
    schemaVersion: "1.0",
    rootPath: string(summary.rootPath, "rootPath", 128),
    manifest: summary.manifest as InspectionSummary["manifest"],
    packageManagers,
    packageManagerConflict: summary.packageManagerConflict,
    detectedStack: stringArray(summary.detectedStack, "detectedStack"),
    dependencies: summary.dependencies.map(parseDependencyNode),
    edges: summary.edges.map(parseDependencyEdge),
    chainIds,
    networkNames: stringArray(summary.networkNames, "networkNames"),
    rpcReferences: stringArray(summary.rpcReferences, "rpcReferences"),
    limitations: stringArray(summary.limitations, "limitations"),
  };
}

export function parseEmptyRequest(value: unknown): Record<string, never> {
  const input = record(value);
  strictKeys(input, []);
  return {};
}

export function parsePairRequest(value: unknown): PairRequest {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["pairingCode", "protocolVersions"]);
  const protocolVersions = stringArray(
    input.protocolVersions,
    "protocolVersions",
    8,
  );
  if (!protocolVersions.includes(LOCAL_RUNTIME_PROTOCOL_VERSION)) {
    throw new UnsupportedProtocolVersionError();
  }
  return {
    pairingCode: string(input.pairingCode, "pairingCode", 64),
    protocolVersions,
  };
}

export function parseBootstrapRequest(value: unknown): BootstrapRequest {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["bootstrapToken", "protocolVersions"]);
  const protocolVersions = stringArray(
    input.protocolVersions,
    "protocolVersions",
    8,
  );
  if (!protocolVersions.includes(LOCAL_RUNTIME_PROTOCOL_VERSION)) {
    throw new UnsupportedProtocolVersionError();
  }
  const bootstrapToken = string(input.bootstrapToken, "bootstrapToken", 128);
  if (!/^[A-Za-z0-9_-]{43}$/.test(bootstrapToken)) {
    throw new ProtocolValidationError("Bootstrap token is invalid.");
  }
  return { bootstrapToken, protocolVersions };
}

export function parseLocalRuntimeHealth(value: unknown): LocalRuntimeHealth {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["service", "runtimeId", "status", "protocolVersions"]);
  if (
    input.service !== LOCAL_RUNTIME_SERVICE ||
    input.status !== "ready" ||
    !stringArray(input.protocolVersions, "protocolVersions", 8).includes(
      LOCAL_RUNTIME_PROTOCOL_VERSION,
    )
  ) {
    throw new ProtocolValidationError("Local Runtime health is invalid.");
  }
  return {
    service: LOCAL_RUNTIME_SERVICE,
    runtimeId: string(input.runtimeId, "runtimeId", 128),
    status: "ready",
    protocolVersions: input.protocolVersions as string[],
  };
}

export function parsePairResponse(value: unknown): PairResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, [
    "runtimeId",
    "protocolVersion",
    "accessToken",
    "expiresAt",
    "scopes",
  ]);
  if (input.protocolVersion !== LOCAL_RUNTIME_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      "Local Runtime protocol version is unsupported.",
    );
  }
  const expiresAt = string(input.expiresAt, "expiresAt", 64);
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new ProtocolValidationError("Session expiry is invalid.");
  }
  const accessToken = string(input.accessToken, "accessToken", 128);
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
    throw new ProtocolValidationError("Session token is invalid.");
  }
  return {
    runtimeId: string(input.runtimeId, "runtimeId", 128),
    protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
    accessToken,
    expiresAt,
    scopes: stringArray(input.scopes, "scopes", 32),
  };
}

export function parseAuthorizedProjectsResponse(
  value: unknown,
): AuthorizedProjectsResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["projects"]);
  if (!Array.isArray(input.projects) || input.projects.length > 128) {
    throw new ProtocolValidationError("Project list is invalid.");
  }
  return { projects: input.projects.map(parseAuthorizedProject) };
}

export function parseInspectionResponse(
  value: unknown,
): AgentInspectionResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["project", "inspection", "inspectedAt"]);
  const inspectedAt = string(input.inspectedAt, "inspectedAt", 64);
  if (!Number.isFinite(Date.parse(inspectedAt))) {
    throw new ProtocolValidationError("Inspection timestamp is invalid.");
  }
  return {
    project: parseAuthorizedProject(input.project),
    inspection: parseInspectionSummary(input.inspection),
    inspectedAt,
  };
}

const REPORT_SCENARIOS: readonly ReportScenarioId[] = [
  "rpc-blackout",
  "rpc-latency",
  "rpc-intermittent-failure",
  "rpc-rate-limit",
  "rpc-connection-failure",
  "rpc-malformed-response",
];
const REPORT_TERMINAL_STATES: readonly ReportTerminalState[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];
const REPORT_EVALUATION_STATUSES: readonly ReportEvaluationStatus[] = [
  "passed",
  "failed",
  "inconclusive",
];
const REPORT_PHASES = ["baseline", "fault", "recovery"] as const;
const REPORT_OPERATIONS: readonly ReportOperation[] = [
  "projects:read",
  "projects:inspect",
  "reports:list",
  "reports:read",
];

export function parseReportIdentifier(value: unknown, field: string): string {
  const identifier = string(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identifier)) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return identifier;
}

function reportTimestamp(value: unknown, field: string): string {
  const timestamp = string(value, field, 64);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return timestamp;
}

function reportInteger(
  value: unknown,
  field: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value;
}

function reportNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value;
}

function reportSignedNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value;
}

function reportText(value: unknown, field: string, maximum = 1_024): string {
  return string(value, field, maximum);
}

function assertReportPayloadSize(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ProtocolValidationError("Report payload cannot be serialized.");
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > REPORT_MAX_RESPONSE_BYTES
  ) {
    throw new ProtocolValidationError("Report payload exceeds the limit.");
  }
}

function parseReportConfiguration(
  value: unknown,
  scenarioId: ReportScenarioId,
): ReportConfiguration {
  const configuration = record(value);
  const keysByScenario: Record<ReportScenarioId, readonly string[]> = {
    "rpc-blackout": ["startOffsetMs", "durationMs", "experimentDurationMs"],
    "rpc-latency": [
      "delayMs",
      "startOffsetMs",
      "durationMs",
      "experimentDurationMs",
    ],
    "rpc-intermittent-failure": [
      "startOffsetMs",
      "failureDurationMs",
      "recoveryIntervalMs",
      "windowCount",
      "experimentDurationMs",
      "httpStatus",
    ],
    "rpc-rate-limit": [
      "maxRequests",
      "windowMs",
      "cooldownMs",
      "retryAfterSeconds",
      "experimentDurationMs",
    ],
    "rpc-connection-failure": [
      "faultMode",
      "startOffsetMs",
      "durationMs",
      "experimentDurationMs",
    ],
    "rpc-malformed-response": [
      "faultMode",
      "startOffsetMs",
      "durationMs",
      "experimentDurationMs",
    ],
  };
  strictKeys(configuration, keysByScenario[scenarioId]);
  const requiredByScenario: Record<ReportScenarioId, readonly string[]> = {
    "rpc-blackout": ["startOffsetMs", "durationMs"],
    "rpc-latency": ["delayMs", "startOffsetMs", "durationMs"],
    "rpc-intermittent-failure": [
      "startOffsetMs",
      "failureDurationMs",
      "recoveryIntervalMs",
      "windowCount",
    ],
    "rpc-rate-limit": ["maxRequests", "windowMs"],
    "rpc-connection-failure": ["faultMode", "startOffsetMs", "durationMs"],
    "rpc-malformed-response": ["faultMode", "startOffsetMs", "durationMs"],
  };
  if (
    requiredByScenario[scenarioId].some(
      (key) => configuration[key] === undefined,
    )
  ) {
    throw new ProtocolValidationError("Report configuration is incomplete.");
  }
  const result: Record<string, number | string> = {};
  for (const [key, rawValue] of Object.entries(configuration)) {
    if (key === "faultMode") {
      const mode = reportText(rawValue, "faultMode", 64);
      if (
        scenarioId === "rpc-connection-failure" &&
        !["connection-reset", "premature-close"].includes(mode)
      ) {
        throw new ProtocolValidationError("faultMode is invalid.");
      }
      if (
        scenarioId === "rpc-malformed-response" &&
        ![
          "invalid-json",
          "missing-version",
          "missing-result-and-error",
          "missing-id",
          "mismatched-id",
          "invalid-structure",
        ].includes(mode)
      ) {
        throw new ProtocolValidationError("faultMode is invalid.");
      }
      result[key] = mode;
    } else {
      const minimum =
        key === "durationMs" ||
        key === "delayMs" ||
        key === "failureDurationMs" ||
        key === "recoveryIntervalMs" ||
        key === "windowCount" ||
        key === "maxRequests" ||
        key === "windowMs"
          ? 1
          : 0;
      const boundedMinimum =
        key === "httpStatus" ? 400 : key === "retryAfterSeconds" ? 1 : minimum;
      const boundedMaximum =
        key === "httpStatus" ? 599 : Number.MAX_SAFE_INTEGER;
      result[key] = reportInteger(
        rawValue,
        key,
        boundedMinimum,
        boundedMaximum,
      );
    }
  }
  const duration = result.experimentDurationMs;
  if (duration !== undefined && typeof duration !== "number") {
    throw new ProtocolValidationError("experimentDurationMs is invalid.");
  }
  const numberValue = (key: string): number => {
    const value = result[key];
    if (typeof value !== "number") {
      throw new ProtocolValidationError(`${key} is invalid.`);
    }
    return value;
  };
  const experimentDuration =
    duration === undefined ? undefined : numberValue("experimentDurationMs");
  const requiredDuration =
    scenarioId === "rpc-intermittent-failure"
      ? numberValue("startOffsetMs") +
        numberValue("windowCount") * numberValue("failureDurationMs") +
        (numberValue("windowCount") - 1) * numberValue("recoveryIntervalMs")
      : scenarioId === "rpc-connection-failure" ||
          scenarioId === "rpc-malformed-response" ||
          scenarioId === "rpc-blackout" ||
          scenarioId === "rpc-latency"
        ? numberValue("startOffsetMs") + numberValue("durationMs")
        : undefined;
  if (
    experimentDuration !== undefined &&
    (experimentDuration <= 0 ||
      (requiredDuration !== undefined && requiredDuration > experimentDuration))
  ) {
    throw new ProtocolValidationError(
      "Report fault schedule must fit within experimentDurationMs.",
    );
  }
  if (
    scenarioId === "rpc-rate-limit" &&
    result.cooldownMs !== undefined &&
    numberValue("cooldownMs") < 0
  ) {
    throw new ProtocolValidationError("cooldownMs is invalid.");
  }
  return result;
}

function parseReportMetrics(value: unknown): ReportMetrics {
  const metrics = record(value);
  const metricKeys = [
    "totalRequests",
    "requestsByPhase",
    "successfulForwardedRequests",
    "upstreamErrors",
    "injectedBlackoutFailures",
    "invalidRequests",
    "averageLatencyMs",
    "medianLatencyMs",
    "recoverySuccessCount",
    "recoveryLatencyMs",
    "baselineAverageLatencyMs",
    "faultAverageLatencyMs",
    "recoveryAverageLatencyMs",
    "injectedRequestCount",
    "observedAdditionalLatencyMs",
  ] as const;
  strictKeys(metrics, metricKeys);
  const requestsByPhase = record(metrics.requestsByPhase);
  strictKeys(requestsByPhase, REPORT_PHASES);
  return {
    totalRequests: reportInteger(metrics.totalRequests, "totalRequests"),
    requestsByPhase: {
      baseline: reportInteger(requestsByPhase.baseline, "baseline"),
      fault: reportInteger(requestsByPhase.fault, "fault"),
      recovery: reportInteger(requestsByPhase.recovery, "recovery"),
    },
    successfulForwardedRequests: reportInteger(
      metrics.successfulForwardedRequests,
      "successfulForwardedRequests",
    ),
    upstreamErrors: reportInteger(metrics.upstreamErrors, "upstreamErrors"),
    injectedBlackoutFailures: reportInteger(
      metrics.injectedBlackoutFailures,
      "injectedBlackoutFailures",
    ),
    invalidRequests: reportInteger(metrics.invalidRequests, "invalidRequests"),
    recoverySuccessCount: reportInteger(
      metrics.recoverySuccessCount,
      "recoverySuccessCount",
    ),
    injectedRequestCount: reportInteger(
      metrics.injectedRequestCount,
      "injectedRequestCount",
    ),
    ...(metrics.averageLatencyMs === undefined
      ? {}
      : {
          averageLatencyMs: reportNumber(
            metrics.averageLatencyMs,
            "averageLatencyMs",
          ),
        }),
    ...(metrics.medianLatencyMs === undefined
      ? {}
      : {
          medianLatencyMs: reportNumber(
            metrics.medianLatencyMs,
            "medianLatencyMs",
          ),
        }),
    ...(metrics.recoveryLatencyMs === undefined
      ? {}
      : {
          recoveryLatencyMs: reportNumber(
            metrics.recoveryLatencyMs,
            "recoveryLatencyMs",
          ),
        }),
    ...(metrics.baselineAverageLatencyMs === undefined
      ? {}
      : {
          baselineAverageLatencyMs: reportNumber(
            metrics.baselineAverageLatencyMs,
            "baselineAverageLatencyMs",
          ),
        }),
    ...(metrics.faultAverageLatencyMs === undefined
      ? {}
      : {
          faultAverageLatencyMs: reportNumber(
            metrics.faultAverageLatencyMs,
            "faultAverageLatencyMs",
          ),
        }),
    ...(metrics.recoveryAverageLatencyMs === undefined
      ? {}
      : {
          recoveryAverageLatencyMs: reportNumber(
            metrics.recoveryAverageLatencyMs,
            "recoveryAverageLatencyMs",
          ),
        }),
    ...(metrics.observedAdditionalLatencyMs === undefined
      ? {}
      : {
          observedAdditionalLatencyMs: reportSignedNumber(
            metrics.observedAdditionalLatencyMs,
            "observedAdditionalLatencyMs",
          ),
        }),
  };
}

function parseReportEvaluationPhase(value: unknown): ReportEvaluationPhase {
  const phase = record(value);
  strictKeys(phase, ["status", "reasons", "explanation"]);
  if (
    !REPORT_EVALUATION_STATUSES.includes(phase.status as ReportEvaluationStatus)
  ) {
    throw new ProtocolValidationError("Report evaluation status is invalid.");
  }
  return {
    status: phase.status as ReportEvaluationStatus,
    reasons: stringArray(phase.reasons, "evaluation reasons", 64),
    explanation: reportText(phase.explanation, "evaluation explanation"),
  };
}

function parseReportEvaluation(value: unknown): ReportEvaluation {
  const evaluation = record(value);
  strictKeys(evaluation, [
    "status",
    "baseline",
    "fault",
    "recovery",
    "reasons",
    "explanation",
    "metrics",
    "warnings",
  ]);
  if (
    !REPORT_EVALUATION_STATUSES.includes(
      evaluation.status as ReportEvaluationStatus,
    )
  ) {
    throw new ProtocolValidationError("Report evaluation status is invalid.");
  }
  return {
    status: evaluation.status as ReportEvaluationStatus,
    baseline: parseReportEvaluationPhase(evaluation.baseline),
    fault: parseReportEvaluationPhase(evaluation.fault),
    recovery: parseReportEvaluationPhase(evaluation.recovery),
    reasons: stringArray(evaluation.reasons, "evaluation reasons", 64),
    explanation: reportText(evaluation.explanation, "evaluation explanation"),
    metrics: parseReportMetrics(evaluation.metrics),
    warnings: stringArray(evaluation.warnings, "evaluation warnings", 64),
  };
}

function parseReportSummary(value: unknown): ReportSummary {
  const summary = record(value);
  strictKeys(summary, [
    "executionId",
    "recordId",
    "scenarioId",
    "scenarioVersion",
    "terminalState",
    "evaluation",
    "startedAt",
    "completedAt",
    "evidenceDigest",
    "integrityStatus",
  ]);
  if (!REPORT_SCENARIOS.includes(summary.scenarioId as ReportScenarioId)) {
    throw new ProtocolValidationError("Report scenario is invalid.");
  }
  const scenarioVersions: Record<ReportScenarioId, string> = {
    "rpc-blackout": "1.0.0",
    "rpc-latency": "1.0.0",
    "rpc-intermittent-failure": "1.0.0",
    "rpc-rate-limit": "1.0.0",
    "rpc-connection-failure": "1.0.0",
    "rpc-malformed-response": "1.0.0",
  };
  if (
    typeof summary.scenarioVersion !== "string" ||
    summary.scenarioVersion !==
      scenarioVersions[summary.scenarioId as ReportScenarioId]
  ) {
    throw new ProtocolValidationError("Report scenario version is invalid.");
  }
  if (
    !REPORT_TERMINAL_STATES.includes(
      summary.terminalState as ReportTerminalState,
    )
  ) {
    throw new ProtocolValidationError("Report terminal state is invalid.");
  }
  const integrityStatuses: readonly ReportIntegrityStatus[] = [
    "verified",
    "missing-digest",
    "digest-mismatch",
    "unsupported-version",
    "malformed",
    "oversized",
  ];
  if (
    !integrityStatuses.includes(
      summary.integrityStatus as ReportIntegrityStatus,
    )
  ) {
    throw new ProtocolValidationError("Report integrity status is invalid.");
  }
  if (
    summary.evidenceDigest !== undefined &&
    !/^[0-9a-f]{64}$/.test(string(summary.evidenceDigest, "evidenceDigest", 64))
  ) {
    throw new ProtocolValidationError("evidenceDigest is invalid.");
  }
  const evidenceDigest =
    summary.evidenceDigest === undefined
      ? undefined
      : string(summary.evidenceDigest, "evidenceDigest", 64);
  if (evidenceDigest !== undefined && !/^[0-9a-f]{64}$/.test(evidenceDigest)) {
    throw new ProtocolValidationError("evidenceDigest is invalid.");
  }
  const integrityStatus = summary.integrityStatus as ReportIntegrityStatus;
  if (
    (integrityStatus === "verified" || integrityStatus === "digest-mismatch") &&
    evidenceDigest === undefined
  ) {
    throw new ProtocolValidationError(
      "This integrity status requires an evidence digest.",
    );
  }
  if (integrityStatus === "missing-digest" && evidenceDigest !== undefined) {
    throw new ProtocolValidationError(
      "Missing-digest reports cannot include an evidence digest.",
    );
  }
  return {
    executionId: parseReportIdentifier(summary.executionId, "executionId"),
    recordId: parseReportIdentifier(summary.recordId, "recordId"),
    scenarioId: summary.scenarioId as ReportScenarioId,
    scenarioVersion: reportText(summary.scenarioVersion, "scenarioVersion", 32),
    terminalState: summary.terminalState as ReportTerminalState,
    evaluation: parseReportEvaluation(summary.evaluation),
    startedAt: reportTimestamp(summary.startedAt, "startedAt"),
    ...(summary.completedAt === undefined
      ? {}
      : { completedAt: reportTimestamp(summary.completedAt, "completedAt") }),
    ...(evidenceDigest === undefined ? {} : { evidenceDigest }),
    integrityStatus,
  };
}

function parseReportObservation(value: unknown): ReportObservation {
  const observation = record(value);
  strictKeys(observation, [
    "phase",
    "timestamp",
    "method",
    "outcome",
    "injected",
    "latencyMs",
    "errorCategory",
    "correlationId",
    "requestTimestamp",
    "injectedDelayMs",
  ]);
  if (
    !REPORT_PHASES.includes(observation.phase as (typeof REPORT_PHASES)[number])
  ) {
    throw new ProtocolValidationError("Report observation phase is invalid.");
  }
  if (typeof observation.injected !== "boolean") {
    throw new ProtocolValidationError(
      "Report observation injected flag is invalid.",
    );
  }
  return {
    phase: observation.phase as ReportObservation["phase"],
    timestamp: reportTimestamp(observation.timestamp, "timestamp"),
    method: reportText(observation.method, "method", 128),
    outcome: reportText(observation.outcome, "outcome", 128),
    injected: observation.injected,
    latencyMs: reportNumber(observation.latencyMs, "latencyMs"),
    ...(observation.errorCategory === undefined
      ? {}
      : {
          errorCategory: reportText(
            observation.errorCategory,
            "errorCategory",
            128,
          ),
        }),
    correlationId: parseReportIdentifier(
      observation.correlationId,
      "correlationId",
    ),
    ...(observation.requestTimestamp === undefined
      ? {}
      : {
          requestTimestamp: reportTimestamp(
            observation.requestTimestamp,
            "requestTimestamp",
          ),
        }),
    ...(observation.injectedDelayMs === undefined
      ? {}
      : {
          injectedDelayMs: reportNumber(
            observation.injectedDelayMs,
            "injectedDelayMs",
          ),
        }),
  };
}

export function parseReportSummaryResponse(value: unknown): ReportSummary {
  assertReportPayloadSize(value);
  assertJsonBounds(value);
  return parseReportSummary(value);
}

export function parseReportDetailResponse(value: unknown): ReportDetail {
  assertReportPayloadSize(value);
  assertJsonBounds(value);
  const detail = record(value);
  strictKeys(detail, [
    "executionId",
    "recordId",
    "scenarioId",
    "scenarioVersion",
    "terminalState",
    "evaluation",
    "startedAt",
    "completedAt",
    "evidenceDigest",
    "integrityStatus",
    "configuration",
    "observations",
    "diagnostics",
  ]);
  const summary = parseReportSummary({
    executionId: detail.executionId,
    recordId: detail.recordId,
    scenarioId: detail.scenarioId,
    scenarioVersion: detail.scenarioVersion,
    terminalState: detail.terminalState,
    evaluation: detail.evaluation,
    startedAt: detail.startedAt,
    ...(detail.completedAt === undefined
      ? {}
      : { completedAt: detail.completedAt }),
    ...(detail.evidenceDigest === undefined
      ? {}
      : { evidenceDigest: detail.evidenceDigest }),
    integrityStatus: detail.integrityStatus,
  });
  if (
    !Array.isArray(detail.observations) ||
    detail.observations.length > REPORT_MAX_OBSERVATIONS
  ) {
    throw new ProtocolValidationError("Report observations exceed the limit.");
  }
  const diagnostics = record(detail.diagnostics);
  strictKeys(diagnostics, ["warnings", "limitations"]);
  return {
    ...summary,
    configuration: parseReportConfiguration(
      detail.configuration,
      summary.scenarioId,
    ),
    observations: detail.observations.map(parseReportObservation),
    diagnostics: {
      warnings: stringArray(diagnostics.warnings, "report warnings", 64),
      limitations: stringArray(
        diagnostics.limitations,
        "report limitations",
        64,
      ),
    },
  };
}

export function parseReportListResponse(value: unknown): ReportListResponse {
  assertReportPayloadSize(value);
  assertJsonBounds(value);
  const listing = record(value);
  strictKeys(listing, [
    "protocolVersion",
    "projectId",
    "totalCount",
    "reports",
    "nextCursor",
  ]);
  if (listing.protocolVersion !== REPORT_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      "Report protocol version is unsupported.",
    );
  }
  if (
    !Array.isArray(listing.reports) ||
    listing.reports.length > REPORT_MAX_PAGE_SIZE
  ) {
    throw new ProtocolValidationError("Report page is invalid.");
  }
  return {
    protocolVersion: REPORT_PROTOCOL_VERSION,
    projectId: parseReportIdentifier(listing.projectId, "projectId"),
    totalCount: reportInteger(listing.totalCount, "totalCount"),
    reports: listing.reports.map(parseReportSummary),
    ...(listing.nextCursor === undefined
      ? {}
      : {
          nextCursor: parseReportIdentifier(listing.nextCursor, "nextCursor"),
        }),
  };
}

export function parseReportCapabilities(value: unknown): ReportCapabilities {
  assertReportPayloadSize(value);
  assertJsonBounds(value);
  const capabilities = record(value);
  strictKeys(capabilities, [
    "protocolVersion",
    "operations",
    "maximumPageSize",
    "maximumReportResponseBytes",
  ]);
  if (capabilities.protocolVersion !== REPORT_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      "Report protocol version is unsupported.",
    );
  }
  const operations = stringArray(capabilities.operations, "operations", 16);
  if (
    !operations.every((operation) =>
      REPORT_OPERATIONS.includes(operation as ReportOperation),
    )
  ) {
    throw new ProtocolValidationError("Report operation is invalid.");
  }
  return {
    protocolVersion: REPORT_PROTOCOL_VERSION,
    operations: operations as ReportOperation[],
    maximumPageSize: reportInteger(
      capabilities.maximumPageSize,
      "maximumPageSize",
      1,
      REPORT_MAX_PAGE_SIZE,
    ),
    maximumReportResponseBytes: reportInteger(
      capabilities.maximumReportResponseBytes,
      "maximumReportResponseBytes",
      1,
      REPORT_MAX_RESPONSE_BYTES,
    ),
  };
}

export function parseRuntimeErrorEnvelope(
  value: unknown,
): RuntimeErrorEnvelope {
  assertJsonBounds(value);
  const envelope = record(value);
  strictKeys(envelope, ["error"]);
  const error = record(envelope.error);
  strictKeys(error, ["code", "message", "retryable", "requestId"]);
  if (typeof error.retryable !== "boolean") {
    throw new ProtocolValidationError("Runtime error response is invalid.");
  }
  return {
    error: {
      code: string(error.code, "error code", 128),
      message: string(error.message, "error message", 512),
      retryable: error.retryable,
      requestId: string(error.requestId, "requestId", 128),
    },
  };
}

function isLoopbackAddress(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1) === "::1";
  }
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) {
    return host
      .split(".")
      .slice(1)
      .every((part) => {
        const octet = Number(part);
        return octet >= 0 && octet <= 255;
      });
  }
  return false;
}

export function parseRpcEndpointRegistration(
  value: unknown,
): RpcEndpointRegistration {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["endpointId", "name", "url"]);
  const endpointId = string(input.endpointId, "endpointId", 128);
  const name = string(input.name, "name", 256);
  const rawUrl = string(input.url, "url", 2_048);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ProtocolValidationError("RPC endpoint URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw new ProtocolValidationError("RPC endpoint URL is invalid.");
  }
  const loopback =
    isLoopbackAddress(parsedUrl.hostname) &&
    (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:");
  return {
    endpointId,
    name,
    url: parsedUrl.toString(),
    registrationKind: loopback ? "loopback" : "remote",
    approval: "registered",
  };
}

export function isApprovedLoopbackEndpoint(
  endpoint: RpcEndpointRegistration,
): boolean {
  const parsed = new URL(endpoint.url);
  return (
    endpoint.approval === "approved-loopback" &&
    endpoint.registrationKind === "loopback" &&
    isLoopbackAddress(parsed.hostname)
  );
}
