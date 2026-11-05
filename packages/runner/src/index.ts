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
  | "proxy";

export interface RpcProxyEvidence {
  readonly executionId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly requestId?: string | number | null;
  readonly correlationId: string;
  readonly outcome: ProxyOutcome;
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly upstreamOrigin: string;
  readonly errorCategory?: ProxyErrorCategory;
}

export interface BlackoutConfig {
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

export type RpcBlackoutWorkload<T> = (
  proxy: RpcProxy,
  context: ExecutionContext,
) => T | Promise<T>;

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DISALLOWED_METHOD = /^(eth_send|personal_|wallet_|admin_|debug_)/i;

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
  ): void {
    const record: RpcProxyEvidence = {
      executionId: this.config.executionId ?? "unattached",
      scenarioId: this.config.scenarioId ?? "rpc-blackout",
      timestamp: new Date(this.currentTime()).toISOString(),
      method: request.method,
      correlationId: request.correlationId,
      outcome,
      injected,
      latencyMs: Math.max(0, this.currentTime() - started),
      upstreamOrigin: upstreamOrigin(this.config.upstreamUrl),
      ...(request.id === undefined ? {} : { requestId: request.id }),
      ...(errorCategory === undefined ? {} : { errorCategory }),
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
    if (DISALLOWED_METHOD.test(payload.method)) {
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
    const controller = new AbortController();
    this.activeRequests.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.upstreamTimeoutMs,
    );
    try {
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
        false,
        upstreamResponse.ok ? undefined : "upstream_http",
      );
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      const category = timedOut ? "upstream_timeout" : "upstream_unavailable";
      const errorCategory = timedOut
        ? "upstream_timeout"
        : "upstream_connection";
      this.record(requestInfo, category, started, false, errorCategory);
      if (!response.writableEnded) {
        writeJson(
          response,
          200,
          rpcError(
            id ?? null,
            timedOut ? -32001 : -32002,
            timedOut
              ? "Upstream RPC request timed out."
              : "Upstream RPC endpoint is unavailable.",
          ),
        );
      }
    } finally {
      clearTimeout(timeout);
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
