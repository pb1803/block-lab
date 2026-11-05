import { randomUUID } from "node:crypto";
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
