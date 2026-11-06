import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Experiment, ScenarioDefinition } from "@blocklab/core";

export type RunnerPhase =
  | "preflight"
  | "baseline"
  | "inject"
  | "observe"
  | "recover"
  | "cleanup"
  | "evaluate"
  | "report";

export type ExecutionState =
  | "created"
  | "preparing"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export type LifecycleEventType =
  | "execution.created"
  | "preflight.started"
  | "preflight.completed"
  | "execution.started"
  | "cancellation.requested"
  | "timeout.triggered"
  | "cleanup.started"
  | "cleanup.handler.completed"
  | "cleanup.handler.failed"
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled"
  | "execution.timed_out";

export interface RunnerEvent {
  readonly runId: string;
  readonly phase: RunnerPhase;
  readonly timestamp: string;
  readonly message: string;
}

export interface LifecycleEvent {
  readonly eventId: string;
  readonly executionId: string;
  readonly type: LifecycleEventType;
  readonly timestamp: string;
  readonly state: ExecutionState;
  readonly message?: string;
}

export interface ExecutionConfig {
  readonly scenarioId: string;
  readonly timeoutMs: number;
  readonly target?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly maxCleanupHandlers?: number;
  readonly authorization?: StagingAuthorization;
}

export interface StagingAuthorization {
  readonly authorizationId: string;
  readonly authorizedTarget: string;
  readonly confirmedBy: string;
}

export interface CleanupFailure {
  readonly resourceId: string;
  readonly error: unknown;
}

export interface ExecutionResult<T> {
  readonly executionId: string;
  readonly state: ExecutionState;
  readonly value?: T;
  readonly error?: unknown;
  readonly cleanupFailures: readonly CleanupFailure[];
  readonly events: readonly LifecycleEvent[];
}

export type ProxyOutcome =
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

export type ProxyErrorCategory =
  | "invalid_json"
  | "invalid_json_rpc"
  | "unsupported_method"
  | "body_too_large"
  | "upstream_http"
  | "upstream_timeout"
  | "upstream_connection"
  | "injected_blackout"
  | "injected_failure"
  | "rate_limit"
  | "connection_failure"
  | "malformed_response"
  | "proxy";

export interface RpcProxyEvidence {
  readonly executionId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly requestTimestamp?: string;
  readonly method: string;
  readonly requestId?: string | number | null;
  readonly correlationId: string;
  readonly outcome: ProxyOutcome;
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly injectedDelayMs?: number;
  readonly upstreamOrigin: string;
  readonly errorCategory?: ProxyErrorCategory;
  readonly faultMode?: string;
  readonly httpStatus?: number;
}

export interface BlackoutConfig {
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface LatencyConfig {
  readonly delayMs: number;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface IntermittentFailureConfig {
  readonly startOffsetMs: number;
  readonly failureDurationMs: number;
  readonly recoveryIntervalMs: number;
  readonly windowCount: number;
  readonly httpStatus?: number;
  readonly experimentDurationMs?: number;
}

export interface RateLimitConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly cooldownMs?: number;
  readonly retryAfterSeconds?: number;
  readonly experimentDurationMs?: number;
}

export type ConnectionFailureMode = "connection-reset" | "premature-close";

export interface ConnectionFailureConfig {
  readonly faultMode: ConnectionFailureMode;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export type MalformedResponseMode =
  | "invalid-json"
  | "missing-version"
  | "missing-result-and-error"
  | "missing-id"
  | "mismatched-id"
  | "invalid-structure";

export interface MalformedResponseConfig {
  readonly faultMode: MalformedResponseMode;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly experimentDurationMs?: number;
}

export interface RpcProxyConfig {
  readonly upstreamUrl: string;
  readonly port?: number;
  readonly host?: "127.0.0.1";
  readonly requestBodyLimitBytes?: number;
  readonly upstreamTimeoutMs?: number;
  readonly blackout?: BlackoutConfig;
  readonly latency?: LatencyConfig;
  readonly intermittent?: IntermittentFailureConfig;
  readonly rateLimit?: RateLimitConfig;
  readonly connectionFailure?: ConnectionFailureConfig;
  readonly malformed?: MalformedResponseConfig;
  readonly now?: () => number;
  readonly executionId?: string;
  readonly scenarioId?: string;
}

export interface RpcProxyAddress {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly url: string;
}

export interface RpcBlackoutExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export interface RpcLatencyExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export interface RpcIntermittentFailureExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export interface RpcRateLimitExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export interface RpcConnectionFailureExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export interface RpcMalformedResponseExecutionConfig {
  readonly execution: ExecutionConfig;
  readonly proxy: RpcProxyConfig;
}

export type RpcBlackoutWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

export type RpcLatencyWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

export type RpcIntermittentFailureWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

export type RpcRateLimitWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

export type RpcConnectionFailureWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

export type RpcMalformedResponseWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const READ_ONLY_RPC_METHODS: ReadonlySet<string> = new Set([
  "web3_clientVersion",
  "web3_sha3",
  "net_listening",
  "net_peerCount",
  "net_version",
  "eth_protocolVersion",
  "eth_syncing",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getUncleCountByBlockHash",
  "eth_getUncleCountByBlockNumber",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex",
  "eth_getUncleByBlockNumberAndIndex",
  "eth_getLogs",
  "eth_getProof",
  "eth_getBlockReceipts",
  "eth_blobBaseFee",
]);

export interface Runner {
  run(
    experiment: Experiment,
    scenario: ScenarioDefinition,
  ): AsyncIterable<RunnerEvent>;
}

export class RunnerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

export class InvalidTransitionError extends RunnerError {
  public readonly from: ExecutionState;
  public readonly to: ExecutionState;

  public constructor(from: ExecutionState, to: ExecutionState) {
    super(`Invalid execution transition: ${from} -> ${to}.`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class PreflightError extends RunnerError {
  public constructor(message: string) {
    super(message);
    this.name = "PreflightError";
  }
}

export class ExecutionTimeoutError extends RunnerError {
  public constructor(timeoutMs: number) {
    super(`Execution exceeded the ${timeoutMs}ms timeout.`);
    this.name = "ExecutionTimeoutError";
  }
}

export class ExecutionCancelledError extends RunnerError {
  public constructor() {
    super("Execution was cancelled.");
    this.name = "ExecutionCancelledError";
  }
}

export class CleanupError extends RunnerError {
  public readonly failures: readonly CleanupFailure[];

  public constructor(failures: readonly CleanupFailure[]) {
    super(`${failures.length} cleanup handler(s) failed.`);
    this.name = "CleanupError";
    this.failures = failures;
  }
}

const TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> =
  {
    created: ["preparing"],
    preparing: ["running", "cancelling", "failed", "cancelled", "timed_out"],
    running: ["cancelling", "completed", "failed", "cancelled", "timed_out"],
    cancelling: ["cancelled", "timed_out", "failed", "completed"],
    completed: [],
    failed: [],
    timed_out: [],
    cancelled: [],
  };

const SENSITIVE_KEY =
  /(private.?key|mnemonic|seed|password|secret|token|credential|authorization)/i;
const PRIVATE_KEY_VALUE = /^0x[0-9a-f]{64}$/i;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertSafeValue(value: unknown, path: string): void {
  if (typeof value === "string" && PRIVATE_KEY_VALUE.test(value)) {
    throw new PreflightError(
      `Sensitive execution configuration at ${path} is not allowed.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertSafeValue(entry, `${path}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new PreflightError(
          `Sensitive execution configuration at ${path}.${key} is not allowed.`,
        );
      }
      assertSafeValue(nested, `${path}.${key}`);
    }
  }
}

export function assertLoopbackTarget(target: URL): void {
  if (!isLoopbackHostname(target.hostname)) {
    throw new PreflightError(
      `Only loopback targets are allowed by default: ${target.origin}.`,
    );
  }
}

export function preflightExecution(config: ExecutionConfig): void {
  if (!config.scenarioId.trim()) {
    throw new PreflightError("A scenario ID is required.");
  }
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > 3_600_000
  ) {
    throw new PreflightError(
      "Execution timeout must be an integer between 1ms and 3600000ms.",
    );
  }
  if (
    config.maxCleanupHandlers !== undefined &&
    (!Number.isInteger(config.maxCleanupHandlers) ||
      config.maxCleanupHandlers < 1)
  ) {
    throw new PreflightError("maxCleanupHandlers must be a positive integer.");
  }
  if (config.target !== undefined) {
    let target: URL;
    try {
      target = new URL(config.target);
    } catch {
      throw new PreflightError("Execution target must be a valid URL.");
    }
    if (config.authorization === undefined) assertLoopbackTarget(target);
    else if (config.authorization.authorizedTarget !== target.origin) {
      throw new PreflightError(
        "Staging authorization does not match the execution target.",
      );
    }
  }
  if (config.parameters !== undefined)
    assertSafeValue(config.parameters, "parameters");
  if (config.authorization !== undefined) {
    if (
      !config.authorization.authorizationId ||
      !config.authorization.confirmedBy
    ) {
      throw new PreflightError("Staging authorization is incomplete.");
    }
    throw new PreflightError(
      "Authorized staging execution is not enabled in this phase.",
    );
  }
}

function assertBlackoutConfig(config: BlackoutConfig): void {
  if (
    !Number.isInteger(config.startOffsetMs) ||
    config.startOffsetMs < 0 ||
    !Number.isInteger(config.durationMs) ||
    config.durationMs <= 0
  ) {
    throw new PreflightError(
      "Blackout start offset must be non-negative and duration must be a positive integer.",
    );
  }
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0 ||
      config.startOffsetMs + config.durationMs > config.experimentDurationMs)
  ) {
    throw new PreflightError(
      "Blackout must fit within the positive experiment duration.",
    );
  }
}

function assertLatencyConfig(config: LatencyConfig): void {
  if (
    !Number.isInteger(config.delayMs) ||
    config.delayMs <= 0 ||
    !Number.isInteger(config.startOffsetMs) ||
    config.startOffsetMs < 0 ||
    !Number.isInteger(config.durationMs) ||
    config.durationMs <= 0
  ) {
    throw new PreflightError(
      "Latency delay and duration must be positive integers; start offset must be non-negative.",
    );
  }
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0 ||
      config.startOffsetMs + config.durationMs > config.experimentDurationMs)
  ) {
    throw new PreflightError(
      "Latency fault window must fit within the positive experiment duration.",
    );
  }
}

function assertIntermittentConfig(config: IntermittentFailureConfig): void {
  if (
    !Number.isInteger(config.startOffsetMs) ||
    config.startOffsetMs < 0 ||
    !Number.isInteger(config.failureDurationMs) ||
    config.failureDurationMs <= 0 ||
    !Number.isInteger(config.recoveryIntervalMs) ||
    config.recoveryIntervalMs <= 0 ||
    !Number.isInteger(config.windowCount) ||
    config.windowCount <= 0
  ) {
    throw new PreflightError(
      "Intermittent failure start offset must be non-negative; failure duration, recovery interval, and window count must be positive integers.",
    );
  }
  if (
    config.httpStatus !== undefined &&
    (!Number.isInteger(config.httpStatus) ||
      config.httpStatus < 400 ||
      config.httpStatus > 599)
  ) {
    throw new PreflightError(
      "Intermittent failure HTTP status must be a valid HTTP error code between 400 and 599.",
    );
  }
  const totalSpan =
    config.startOffsetMs +
    config.windowCount * config.failureDurationMs +
    (config.windowCount - 1) * config.recoveryIntervalMs;
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0 ||
      totalSpan > config.experimentDurationMs)
  ) {
    throw new PreflightError(
      "Intermittent failure windows must fit within the positive experiment duration.",
    );
  }
}

function assertRateLimitConfig(config: RateLimitConfig): void {
  if (
    !Number.isInteger(config.maxRequests) ||
    config.maxRequests <= 0 ||
    !Number.isInteger(config.windowMs) ||
    config.windowMs <= 0
  ) {
    throw new PreflightError(
      "Rate limit maxRequests and windowMs must be positive integers.",
    );
  }
  if (
    config.cooldownMs !== undefined &&
    (!Number.isInteger(config.cooldownMs) || config.cooldownMs < 0)
  ) {
    throw new PreflightError(
      "Rate limit cooldownMs must be a non-negative integer.",
    );
  }
  if (
    config.retryAfterSeconds !== undefined &&
    (!Number.isInteger(config.retryAfterSeconds) ||
      config.retryAfterSeconds <= 0)
  ) {
    throw new PreflightError(
      "Rate limit retryAfterSeconds must be a positive integer.",
    );
  }
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0)
  ) {
    throw new PreflightError(
      "Rate limit experiment duration must be a positive integer.",
    );
  }
}

function assertConnectionFailureConfig(config: ConnectionFailureConfig): void {
  if (
    config.faultMode !== "connection-reset" &&
    config.faultMode !== "premature-close"
  ) {
    throw new PreflightError(
      `Unsupported connection failure mode: ${String(config.faultMode)}.`,
    );
  }
  if (
    !Number.isInteger(config.startOffsetMs) ||
    config.startOffsetMs < 0 ||
    !Number.isInteger(config.durationMs) ||
    config.durationMs <= 0
  ) {
    throw new PreflightError(
      "Connection failure start offset must be non-negative and duration must be a positive integer.",
    );
  }
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0 ||
      config.startOffsetMs + config.durationMs > config.experimentDurationMs)
  ) {
    throw new PreflightError(
      "Connection failure fault window must fit within the positive experiment duration.",
    );
  }
}

const VALID_MALFORMED_MODES: readonly MalformedResponseMode[] = [
  "invalid-json",
  "missing-version",
  "missing-result-and-error",
  "missing-id",
  "mismatched-id",
  "invalid-structure",
];

function assertMalformedConfig(config: MalformedResponseConfig): void {
  if (!VALID_MALFORMED_MODES.includes(config.faultMode)) {
    throw new PreflightError(
      `Unsupported malformed response mode: ${String(config.faultMode)}.`,
    );
  }
  if (
    !Number.isInteger(config.startOffsetMs) ||
    config.startOffsetMs < 0 ||
    !Number.isInteger(config.durationMs) ||
    config.durationMs <= 0
  ) {
    throw new PreflightError(
      "Malformed response start offset must be non-negative and duration must be a positive integer.",
    );
  }
  if (
    config.experimentDurationMs !== undefined &&
    (!Number.isInteger(config.experimentDurationMs) ||
      config.experimentDurationMs <= 0 ||
      config.startOffsetMs + config.durationMs > config.experimentDurationMs)
  ) {
    throw new PreflightError(
      "Malformed response fault window must fit within the positive experiment duration.",
    );
  }
}

function upstreamOrigin(upstreamUrl: string): string {
  try {
    const url = new URL(upstreamUrl);
    if (url.username || url.password) {
      throw new PreflightError(
        "Upstream URLs with embedded credentials are not allowed.",
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PreflightError("Upstream URL must use HTTP or HTTPS.");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError("Upstream URL must be a valid HTTP(S) URL.");
  }
}

export function preflightRpcProxy(config: RpcProxyConfig): void {
  let upstream: URL;
  try {
    upstream = new URL(config.upstreamUrl);
  } catch {
    throw new PreflightError("Upstream URL must be a valid HTTP(S) URL.");
  }
  assertLoopbackTarget(upstream);
  upstreamOrigin(config.upstreamUrl);
  if (config.host !== undefined && config.host !== "127.0.0.1") {
    throw new PreflightError("RPC proxy host must be 127.0.0.1.");
  }
  if (
    config.port !== undefined &&
    (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535)
  ) {
    throw new PreflightError(
      "RPC proxy port must be an integer from 0 to 65535.",
    );
  }
  if (
    config.requestBodyLimitBytes !== undefined &&
    (!Number.isInteger(config.requestBodyLimitBytes) ||
      config.requestBodyLimitBytes < 1)
  ) {
    throw new PreflightError(
      "RPC proxy body limit must be a positive integer.",
    );
  }
  if (
    config.upstreamTimeoutMs !== undefined &&
    (!Number.isInteger(config.upstreamTimeoutMs) ||
      config.upstreamTimeoutMs < 1)
  ) {
    throw new PreflightError(
      "RPC proxy upstream timeout must be a positive integer.",
    );
  }
  if (config.blackout !== undefined) assertBlackoutConfig(config.blackout);
  if (config.latency !== undefined) assertLatencyConfig(config.latency);
  if (config.intermittent !== undefined)
    assertIntermittentConfig(config.intermittent);
  if (config.rateLimit !== undefined) assertRateLimitConfig(config.rateLimit);
  if (config.connectionFailure !== undefined)
    assertConnectionFailureConfig(config.connectionFailure);
  if (config.malformed !== undefined) assertMalformedConfig(config.malformed);
}

function safeRequestId(value: unknown): string | number | null | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return value;
  }
  return undefined;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: Readonly<Record<string, unknown>>,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(body);
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): Readonly<Record<string, unknown>> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function readRequestBody(
  request: IncomingMessage,
  limit: number,
): Promise<string | undefined> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isJsonRpcRequest(value: unknown): value is {
  readonly jsonrpc: "2.0";
  readonly id?: unknown;
  readonly method: string;
} {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

export class RpcProxy {
  private readonly config: Required<
    Pick<RpcProxyConfig, "requestBodyLimitBytes" | "upstreamTimeoutMs">
  > &
    RpcProxyConfig;
  private readonly server: Server;
  private readonly startedAt: number;
  private readonly evidenceRecords: RpcProxyEvidence[] = [];
  private readonly activeRequests = new Set<AbortController>();
  private closePromise?: Promise<void>;
  private address?: RpcProxyAddress;
  private currentRateLimitWindow = -1;
  private currentRateLimitCount = 0;

  public constructor(config: RpcProxyConfig) {
    preflightRpcProxy(config);
    this.config = {
      ...config,
      requestBodyLimitBytes:
        config.requestBodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
      upstreamTimeoutMs:
        config.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    };
    this.startedAt = (config.now ?? Date.now)();
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.on("clientError", (_error, socket) => {
      socket.destroy();
    });
  }

  public get evidence(): readonly RpcProxyEvidence[] {
    return [...this.evidenceRecords];
  }

  public get listeningAddress(): RpcProxyAddress | undefined {
    return this.address;
  }

  public get experimentStartedAt(): string {
    return new Date(this.startedAt).toISOString();
  }

  public async start(): Promise<RpcProxyAddress> {
    if (this.address !== undefined) return this.address;
    const host = this.config.host ?? "127.0.0.1";
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.config.port ?? 0, host);
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new RunnerError("RPC proxy did not expose a TCP address.");
    }
    this.address = {
      host,
      port: address.port,
      url: `http://${host}:${address.port}`,
    };
    return this.address;
  }

  public async close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = new Promise<void>((resolve, reject) => {
      for (const controller of this.activeRequests) controller.abort();
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    return this.closePromise;
  }

  private currentTime(): number {
    return (this.config.now ?? Date.now)();
  }

  private blackoutActive(): boolean {
    const blackout = this.config.blackout;
    if (blackout === undefined) return false;
    const elapsed = this.currentTime() - this.startedAt;
    return (
      elapsed >= blackout.startOffsetMs &&
      elapsed < blackout.startOffsetMs + blackout.durationMs
    );
  }

  private latencyActive(): boolean {
    const latency = this.config.latency;
    if (latency === undefined) return false;
    const elapsed = this.currentTime() - this.startedAt;
    return (
      elapsed >= latency.startOffsetMs &&
      elapsed < latency.startOffsetMs + latency.durationMs
    );
  }

  private intermittentFailureActive(): boolean {
    const intermittent = this.config.intermittent;
    if (intermittent === undefined) return false;
    const elapsed = this.currentTime() - this.startedAt;
    if (elapsed < intermittent.startOffsetMs) return false;
    const cycleTime =
      intermittent.failureDurationMs + intermittent.recoveryIntervalMs;
    const timeSinceFirst = elapsed - intermittent.startOffsetMs;
    const windowIndex = Math.floor(timeSinceFirst / cycleTime);
    if (windowIndex >= intermittent.windowCount) return false;
    const offsetInCycle = timeSinceFirst % cycleTime;
    return offsetInCycle < intermittent.failureDurationMs;
  }

  private rateLimitActive(): { throttled: boolean; retryAfter: number } {
    const rateLimit = this.config.rateLimit;
    if (rateLimit === undefined) return { throttled: false, retryAfter: 0 };
    const elapsed = this.currentTime() - this.startedAt;
    const windowIndex = Math.floor(elapsed / rateLimit.windowMs);
    if (this.currentRateLimitWindow !== windowIndex) {
      this.currentRateLimitWindow = windowIndex;
      this.currentRateLimitCount = 0;
    }
    const retryAfter =
      rateLimit.retryAfterSeconds ??
      Math.max(
        1,
        Math.ceil((rateLimit.cooldownMs ?? rateLimit.windowMs) / 1000),
      );
    if (this.currentRateLimitCount >= rateLimit.maxRequests) {
      return { throttled: true, retryAfter };
    }
    this.currentRateLimitCount += 1;
    return { throttled: false, retryAfter: 0 };
  }

  private connectionFailureActive(): boolean {
    const connectionFailure = this.config.connectionFailure;
    if (connectionFailure === undefined) return false;
    const elapsed = this.currentTime() - this.startedAt;
    return (
      elapsed >= connectionFailure.startOffsetMs &&
      elapsed < connectionFailure.startOffsetMs + connectionFailure.durationMs
    );
  }

  private malformedActive(): boolean {
    const malformed = this.config.malformed;
    if (malformed === undefined) return false;
    const elapsed = this.currentTime() - this.startedAt;
    return (
      elapsed >= malformed.startOffsetMs &&
      elapsed < malformed.startOffsetMs + malformed.durationMs
    );
  }

  private async delay(durationMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, durationMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException("Request was cancelled.", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private record(
    request: {
      method: string;
      id?: string | number | null;
      correlationId: string;
    },
    outcome: ProxyOutcome,
    started: number,
    injected: boolean,
    errorCategory?: ProxyErrorCategory,
    injectedDelayMs?: number,
    faultMode?: string,
    httpStatus?: number,
  ): void {
    const record: RpcProxyEvidence = {
      executionId: this.config.executionId ?? "unattached",
      scenarioId: this.config.scenarioId ?? "rpc-blackout",
      timestamp: new Date(this.currentTime()).toISOString(),
      requestTimestamp: new Date(started).toISOString(),
      method: request.method,
      correlationId: request.correlationId,
      outcome,
      injected,
      latencyMs: Math.max(0, this.currentTime() - started),
      upstreamOrigin: upstreamOrigin(this.config.upstreamUrl),
      ...(request.id === undefined ? {} : { requestId: request.id }),
      ...(errorCategory === undefined ? {} : { errorCategory }),
      ...(injectedDelayMs === undefined ? {} : { injectedDelayMs }),
      ...(faultMode === undefined ? {} : { faultMode }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    };
    this.evidenceRecords.push(record);
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const started = this.currentTime();
    const correlationId = randomUUID();
    if (request.method !== "POST") {
      this.record(
        { method: request.method ?? "unknown", correlationId },
        "invalid_request",
        started,
        false,
        "invalid_json_rpc",
      );
      writeJson(
        response,
        405,
        rpcError(null, -32600, "Only POST is supported."),
      );
      return;
    }
    const body = await readRequestBody(
      request,
      this.config.requestBodyLimitBytes,
    );
    if (body === undefined) {
      this.record(
        { method: "unknown", correlationId },
        "invalid_request",
        started,
        false,
        "body_too_large",
      );
      writeJson(
        response,
        413,
        rpcError(null, -32600, "Request body is too large."),
      );
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      this.record(
        { method: "unknown", correlationId },
        "invalid_request",
        started,
        false,
        "invalid_json",
      );
      writeJson(response, 400, rpcError(null, -32700, "Invalid JSON."));
      return;
    }
    if (Array.isArray(payload)) {
      this.record(
        { method: "batch", correlationId },
        "invalid_request",
        started,
        false,
        "invalid_json_rpc",
      );
      writeJson(
        response,
        400,
        rpcError(null, -32600, "Batch JSON-RPC requests are not supported."),
      );
      return;
    }
    if (!isJsonRpcRequest(payload)) {
      this.record(
        { method: "unknown", correlationId },
        "invalid_request",
        started,
        false,
        "invalid_json_rpc",
      );
      writeJson(
        response,
        400,
        rpcError(null, -32600, "Invalid JSON-RPC request."),
      );
      return;
    }
    const id = safeRequestId(payload.id);
    const requestInfo = {
      method: payload.method,
      ...(id === undefined ? {} : { id }),
      correlationId,
    };
    if (Object.hasOwn(payload, "id") && id === undefined) {
      this.record(
        requestInfo,
        "invalid_request",
        started,
        false,
        "invalid_json_rpc",
      );
      writeJson(
        response,
        400,
        rpcError(null, -32600, "Invalid JSON-RPC request."),
      );
      return;
    }
    if (!READ_ONLY_RPC_METHODS.has(payload.method)) {
      this.record(
        requestInfo,
        "invalid_request",
        started,
        false,
        "unsupported_method",
      );
      writeJson(
        response,
        400,
        rpcError(
          id ?? null,
          -32601,
          "Method is not supported by this read-only proxy.",
        ),
      );
      return;
    }
    if (this.blackoutActive()) {
      this.record(
        requestInfo,
        "injected_blackout",
        started,
        true,
        "injected_blackout",
      );
      writeJson(
        response,
        200,
        rpcError(id ?? null, -32098, "BLOCKLAB injected RPC blackout."),
      );
      return;
    }
    if (this.intermittentFailureActive()) {
      const httpStatus = this.config.intermittent?.httpStatus ?? 503;
      this.record(
        requestInfo,
        "injected_failure",
        started,
        true,
        "injected_failure",
        undefined,
        undefined,
        httpStatus,
      );
      writeJson(
        response,
        httpStatus,
        rpcError(
          id ?? null,
          -32097,
          "BLOCKLAB injected intermittent RPC failure.",
        ),
      );
      return;
    }
    const rateLimitResult = this.rateLimitActive();
    if (rateLimitResult.throttled) {
      this.record(requestInfo, "rate_limited", started, true, "rate_limit");
      response.setHeader("Retry-After", String(rateLimitResult.retryAfter));
      writeJson(
        response,
        429,
        rpcError(
          id ?? null,
          -32005,
          "BLOCKLAB injected RPC rate limit exceeded.",
        ),
      );
      return;
    }
    if (this.connectionFailureActive()) {
      const mode =
        this.config.connectionFailure?.faultMode ?? "connection-reset";
      this.record(
        requestInfo,
        "injected_connection_failure",
        started,
        true,
        "connection_failure",
        undefined,
        mode,
      );
      const socket = request.socket ?? response.socket;
      if (socket) {
        socket.on("error", () => {});
        if (mode === "premature-close") {
          response.writeHead(200, { "content-type": "application/json" });
          response.write('{"jsonrpc":"2.0",');
        }
        socket.destroy();
      }
      return;
    }
    if (this.malformedActive()) {
      const faultMode = this.config.malformed?.faultMode ?? "invalid-json";
      this.record(
        requestInfo,
        "injected_malformed_response",
        started,
        true,
        "malformed_response",
        undefined,
        faultMode,
      );
      let malformedBody: string;
      switch (faultMode) {
        case "invalid-json":
          malformedBody = '{"jsonrpc": "2.0", broken';
          break;
        case "missing-version":
          malformedBody = JSON.stringify({ id: id ?? 1, result: "0x1" });
          break;
        case "missing-result-and-error":
          malformedBody = JSON.stringify({ jsonrpc: "2.0", id: id ?? 1 });
          break;
        case "missing-id":
          malformedBody = JSON.stringify({ jsonrpc: "2.0", result: "0x1" });
          break;
        case "mismatched-id": {
          const mismatchedId =
            typeof id === "number"
              ? id + 99_999
              : `mismatched-${String(id ?? "none")}`;
          malformedBody = JSON.stringify({
            jsonrpc: "2.0",
            id: mismatchedId,
            result: "0x1",
          });
          break;
        }
        default:
          malformedBody = JSON.stringify(["not-a-jsonrpc-object"]);
          break;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(malformedBody);
      return;
    }
    const controller = new AbortController();
    this.activeRequests.add(controller);
    const latencyInjected = this.latencyActive();
    const configuredDelayMs = latencyInjected
      ? this.config.latency?.delayMs
      : undefined;
    let delayCompleted = configuredDelayMs === undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (configuredDelayMs !== undefined) {
        await this.delay(configuredDelayMs, controller.signal);
        delayCompleted = true;
      }
      timeout = setTimeout(
        () => controller.abort(),
        this.config.upstreamTimeoutMs,
      );
      const upstreamResponse = await fetch(this.config.upstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      const upstreamBody = await upstreamResponse.text();
      response.writeHead(upstreamResponse.status, {
        "content-type":
          upstreamResponse.headers.get("content-type") ?? "application/json",
      });
      response.end(upstreamBody);
      this.record(
        requestInfo,
        upstreamResponse.ok ? "forwarded_success" : "forwarded_error",
        started,
        latencyInjected,
        upstreamResponse.ok ? undefined : "upstream_http",
        configuredDelayMs,
      );
    } catch (error) {
      const cancelledDuringDelay = !delayCompleted && controller.signal.aborted;
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      const category = cancelledDuringDelay
        ? "proxy_error"
        : timedOut
          ? "upstream_timeout"
          : "upstream_unavailable";
      const errorCategory = timedOut
        ? cancelledDuringDelay
          ? "proxy"
          : "upstream_timeout"
        : "upstream_connection";
      this.record(
        requestInfo,
        category,
        started,
        latencyInjected,
        errorCategory,
        configuredDelayMs,
      );
      if (!response.writableEnded) {
        writeJson(
          response,
          200,
          rpcError(
            id ?? null,
            cancelledDuringDelay ? -32003 : timedOut ? -32001 : -32002,
            cancelledDuringDelay
              ? "RPC request was cancelled."
              : timedOut
                ? "Upstream RPC request timed out."
                : "Upstream RPC endpoint is unavailable.",
          ),
        );
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.activeRequests.delete(controller);
    }
  }
}

export function runRpcBlackout<T>(
  config: RpcBlackoutExecutionConfig,
  workload: RpcBlackoutWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-blackout",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-blackout",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.blackout ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

export function runRpcLatency<T>(
  config: RpcLatencyExecutionConfig,
  workload: RpcLatencyWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-latency",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-latency",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.latency ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

export function runRpcIntermittentFailure<T>(
  config: RpcIntermittentFailureExecutionConfig,
  workload: RpcIntermittentFailureWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-intermittent-failure",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-intermittent-failure",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.intermittent ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

export function runRpcRateLimit<T>(
  config: RpcRateLimitExecutionConfig,
  workload: RpcRateLimitWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-rate-limit",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-rate-limit",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.rateLimit ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

export function runRpcConnectionFailure<T>(
  config: RpcConnectionFailureExecutionConfig,
  workload: RpcConnectionFailureWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-connection-failure",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-connection-failure",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.connectionFailure ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

export function runRpcMalformedResponse<T>(
  config: RpcMalformedResponseExecutionConfig,
  workload: RpcMalformedResponseWorkload<T>,
): ExecutionHandle<T> {
  const proxyConfig: RpcProxyConfig = {
    ...config.proxy,
    scenarioId: "rpc-malformed-response",
  };
  preflightRpcProxy(proxyConfig);
  const execution: ExecutionConfig = {
    ...config.execution,
    scenarioId: "rpc-malformed-response",
    target: config.proxy.upstreamUrl,
    parameters: {
      ...(config.execution.parameters ?? {}),
      ...(config.proxy.malformed ?? {}),
    },
  };
  preflightExecution(execution);
  return startExecution(execution, async (context) => {
    const proxy = new RpcProxy({
      ...proxyConfig,
      executionId: context.executionId,
    });
    await proxy.start();
    context.registerCleanup("rpc-proxy", () => proxy.close());
    return workload(proxy, context);
  });
}

interface CleanupResource {
  readonly resourceId: string;
  readonly cleanup: () => void | Promise<void>;
  hasRun: boolean;
}

export class ExecutionContext {
  public readonly executionId: string;
  public readonly scenarioId: string;
  public readonly timeoutMs: number;
  public readonly cancellationSignal: AbortSignal;
  public readonly createdAt: string;
  public preparingAt?: string;
  public startedAt?: string;
  public finishedAt?: string;
  public state: ExecutionState = "created";

  private readonly controller = new AbortController();
  private readonly resources: CleanupResource[] = [];
  private readonly lifecycleEvents: LifecycleEvent[] = [];
  private cleanupStarted = false;
  private cleanupPromise?: Promise<readonly CleanupFailure[]>;
  private terminalIntent?: "cancelled" | "timed_out";
  private readonly interruptionPromise: Promise<"cancelled" | "timed_out">;
  private resolveInterruption!: (intent: "cancelled" | "timed_out") => void;
  private readonly now: () => number;
  public readonly config: ExecutionConfig;

  public constructor(config: ExecutionConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
    this.executionId = randomUUID();
    this.scenarioId = config.scenarioId;
    this.timeoutMs = config.timeoutMs;
    this.cancellationSignal = this.controller.signal;
    this.createdAt = this.timestamp();
    this.interruptionPromise = new Promise<"cancelled" | "timed_out">(
      (resolve) => {
        this.resolveInterruption = resolve;
      },
    );
    this.record("execution.created", "Execution created.");
  }

  public get events(): readonly LifecycleEvent[] {
    return [...this.lifecycleEvents];
  }

  public transition(to: ExecutionState): void {
    if (!TRANSITIONS[this.state].includes(to)) {
      throw new InvalidTransitionError(this.state, to);
    }
    this.state = to;
    if (to === "preparing") this.preparingAt = this.timestamp();
    if (to === "running") this.startedAt = this.timestamp();
    if (
      to === "completed" ||
      to === "failed" ||
      to === "timed_out" ||
      to === "cancelled"
    ) {
      this.finishedAt = this.timestamp();
    }
  }

  public record(type: LifecycleEventType, message?: string): void {
    this.lifecycleEvents.push({
      eventId: randomUUID(),
      executionId: this.executionId,
      type,
      timestamp: this.timestamp(),
      state: this.state,
      ...(message === undefined ? {} : { message }),
    });
  }

  public registerCleanup(
    resourceId: string,
    cleanup: () => void | Promise<void>,
  ): void {
    if (this.cleanupStarted) {
      throw new RunnerError(
        "Cannot register cleanup after cleanup has started.",
      );
    }
    if (this.resources.some((resource) => resource.resourceId === resourceId)) {
      throw new RunnerError(
        `Cleanup resource already registered: ${resourceId}.`,
      );
    }
    if (
      this.config.maxCleanupHandlers !== undefined &&
      this.resources.length >= this.config.maxCleanupHandlers
    ) {
      throw new RunnerError("The cleanup resource limit has been reached.");
    }
    this.resources.push({ resourceId, cleanup, hasRun: false });
  }

  public requestCancellation(): boolean {
    if (this.isTerminal() || this.terminalIntent !== undefined) return false;
    this.terminalIntent = "cancelled";
    if (this.state === "preparing" || this.state === "running") {
      this.transition("cancelling");
    }
    this.record("cancellation.requested", "Cancellation requested.");
    this.controller.abort();
    this.resolveInterruption("cancelled");
    return true;
  }

  public triggerTimeout(): boolean {
    if (this.isTerminal() || this.terminalIntent !== undefined) return false;
    this.terminalIntent = "timed_out";
    if (this.state === "preparing" || this.state === "running") {
      this.transition("cancelling");
    }
    this.record(
      "timeout.triggered",
      `Timeout triggered after ${this.timeoutMs}ms.`,
    );
    this.controller.abort();
    this.resolveInterruption("timed_out");
    return true;
  }

  public async cleanup(): Promise<readonly CleanupFailure[]> {
    if (this.cleanupPromise !== undefined) return this.cleanupPromise;
    this.cleanupStarted = true;
    this.record("cleanup.started", "Cleanup started.");
    this.cleanupPromise = this.runCleanup();
    return this.cleanupPromise;
  }

  public terminalIntentState(): "cancelled" | "timed_out" | undefined {
    return this.terminalIntent;
  }

  public waitForInterruption(): Promise<never> {
    return this.interruptionPromise.then((intent) => {
      throw intent === "cancelled"
        ? new ExecutionCancelledError()
        : new ExecutionTimeoutError(this.timeoutMs);
    });
  }

  private async runCleanup(): Promise<readonly CleanupFailure[]> {
    const failures: CleanupFailure[] = [];
    for (const resource of [...this.resources].reverse()) {
      if (resource.hasRun) continue;
      resource.hasRun = true;
      try {
        await resource.cleanup();
        this.record(
          "cleanup.handler.completed",
          `Cleanup completed: ${resource.resourceId}.`,
        );
      } catch (error) {
        failures.push({ resourceId: resource.resourceId, error });
        this.record(
          "cleanup.handler.failed",
          `Cleanup failed: ${resource.resourceId}.`,
        );
      }
    }
    return failures;
  }

  private isTerminal(): boolean {
    return (
      this.state === "completed" ||
      this.state === "failed" ||
      this.state === "timed_out" ||
      this.state === "cancelled"
    );
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}

export interface ExecutionHandle<T> {
  readonly context: ExecutionContext;
  readonly result: Promise<ExecutionResult<T>>;
}

export function startExecution<T>(
  config: ExecutionConfig,
  operation: (context: ExecutionContext) => T | Promise<T>,
  now: () => number = Date.now,
): ExecutionHandle<T> {
  preflightExecution(config);
  const context = new ExecutionContext(config, now);
  const result = execute(context, operation);
  return { context, result };
}

async function execute<T>(
  context: ExecutionContext,
  operation: (context: ExecutionContext) => T | Promise<T>,
): Promise<ExecutionResult<T>> {
  let value: T | undefined;
  let primaryError: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    context.transition("preparing");
    context.record("preflight.started", "Preflight started.");
    context.record("preflight.completed", "Preflight completed.");
    context.transition("running");
    context.record("execution.started", "Execution started.");
    timer = setTimeout(() => context.triggerTimeout(), context.timeoutMs);
    const operationPromise = Promise.resolve().then(() => operation(context));
    operationPromise.catch(() => undefined);
    value = await Promise.race([
      operationPromise,
      context.waitForInterruption(),
    ]);
    if (context.terminalIntentState() === "cancelled") {
      primaryError = new ExecutionCancelledError();
    } else if (context.terminalIntentState() === "timed_out") {
      primaryError = new ExecutionTimeoutError(context.timeoutMs);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const intent = context.terminalIntentState();
  if (primaryError === undefined && intent === "cancelled") {
    primaryError = new ExecutionCancelledError();
  } else if (primaryError === undefined && intent === "timed_out") {
    primaryError = new ExecutionTimeoutError(context.timeoutMs);
  }

  const cleanupFailures = await context.cleanup();
  let finalState: ExecutionState;
  if (intent === "timed_out" || primaryError instanceof ExecutionTimeoutError) {
    finalState = "timed_out";
  } else if (
    intent === "cancelled" ||
    primaryError instanceof ExecutionCancelledError
  ) {
    finalState = "cancelled";
  } else if (primaryError !== undefined) {
    finalState = "failed";
  } else if (cleanupFailures.length > 0) {
    primaryError = new CleanupError(cleanupFailures);
    finalState = "failed";
  } else {
    finalState = "completed";
  }
  context.transition(finalState);
  const eventType =
    finalState === "completed"
      ? "execution.completed"
      : finalState === "cancelled"
        ? "execution.cancelled"
        : finalState === "timed_out"
          ? "execution.timed_out"
          : "execution.failed";
  context.record(
    eventType,
    primaryError instanceof Error ? primaryError.message : undefined,
  );
  return {
    executionId: context.executionId,
    state: finalState,
    ...(value === undefined ? {} : { value }),
    ...(primaryError === undefined ? {} : { error: primaryError }),
    cleanupFailures,
    events: context.events,
  };
}
