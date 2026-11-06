import { join } from "node:path";
import {
  type BlackoutSchedule,
  type ConnectionFailureSchedule,
  createRpcBlackoutEvidence,
  createRpcConnectionFailureEvidence,
  createRpcIntermittentFailureEvidence,
  createRpcLatencyEvidence,
  createRpcMalformedResponseEvidence,
  createRpcRateLimitEvidence,
  type EvidenceRecord,
  type IntermittentFailureSchedule,
  type LatencySchedule,
  type MalformedResponseSchedule,
  type ProxyEvidenceLike,
  type RateLimitSchedule,
  writeEvidence,
} from "@blocklab/evidence";
import {
  type ExecutionContext,
  type ExecutionResult,
  RpcProxy,
  startExecution,
} from "@blocklab/runner";
import {
  rpcBlackoutScenario,
  rpcConnectionFailureScenario,
  rpcIntermittentFailureScenario,
  rpcLatencyScenario,
  rpcMalformedResponseScenario,
  rpcRateLimitScenario,
  validateScenarioMode,
} from "@blocklab/scenarios";

export const SUPPORTED_APPLICATION_SCENARIOS = [
  "rpc-blackout",
  "rpc-latency",
  "rpc-intermittent-failure",
  "rpc-rate-limit",
  "rpc-connection-failure",
  "rpc-malformed-response",
] as const;

export type ApplicationScenario =
  (typeof SUPPORTED_APPLICATION_SCENARIOS)[number];

export type ExperimentSchedule =
  | BlackoutSchedule
  | LatencySchedule
  | IntermittentFailureSchedule
  | RateLimitSchedule
  | ConnectionFailureSchedule
  | MalformedResponseSchedule;

export interface ExperimentInput {
  readonly evidenceDirectory: string;
  readonly upstream: string;
  readonly scenario: ApplicationScenario;
  readonly schedule: ExperimentSchedule;
  readonly port: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ApplicationProxy {
  readonly evidence: readonly ProxyEvidenceLike[];
  readonly experimentStartedAt?: string;
  readonly listeningAddress: { readonly url: string } | undefined;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface ApplicationDependencies {
  readonly createProxy?: (
    config: ConstructorParameters<typeof RpcProxy>[0],
  ) => ApplicationProxy;
  readonly startExecution?: typeof startExecution;
  readonly writeEvidence?: typeof writeEvidence;
}

const scenarioDefinitions = {
  "rpc-blackout": rpcBlackoutScenario,
  "rpc-latency": rpcLatencyScenario,
  "rpc-intermittent-failure": rpcIntermittentFailureScenario,
  "rpc-rate-limit": rpcRateLimitScenario,
  "rpc-connection-failure": rpcConnectionFailureScenario,
  "rpc-malformed-response": rpcMalformedResponseScenario,
} as const;

function scenarioDefinition(scenario: ApplicationScenario) {
  return scenarioDefinitions[scenario];
}

function proxyConfig(
  input: ExperimentInput,
  executionId: string,
): ConstructorParameters<typeof RpcProxy>[0] {
  const common = {
    upstreamUrl: input.upstream,
    port: input.port,
    executionId,
    scenarioId: input.scenario,
  };
  switch (input.scenario) {
    case "rpc-blackout":
      if ("delayMs" in input.schedule)
        throw new Error("Latency configuration cannot run as rpc-blackout.");
      return {
        ...common,
        blackout: input.schedule as BlackoutSchedule,
      };
    case "rpc-latency":
      if (!("delayMs" in input.schedule))
        throw new Error("Latency configuration requires a delay.");
      return { ...common, latency: input.schedule as LatencySchedule };
    case "rpc-intermittent-failure":
      return {
        ...common,
        intermittent: input.schedule as IntermittentFailureSchedule,
      };
    case "rpc-rate-limit":
      return { ...common, rateLimit: input.schedule as RateLimitSchedule };
    case "rpc-connection-failure":
      return {
        ...common,
        connectionFailure: input.schedule as ConnectionFailureSchedule,
      };
    case "rpc-malformed-response":
      return {
        ...common,
        malformed: input.schedule as MalformedResponseSchedule,
      };
  }
}

async function request(
  proxy: ApplicationProxy,
  context: ExecutionContext,
): Promise<Response> {
  const address = proxy.listeningAddress;
  if (address === undefined) throw new Error("Proxy did not start.");
  return fetch(address.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
    signal: context.cancellationSignal,
  });
}

async function waitUntilElapsed(
  proxy: ApplicationProxy,
  context: ExecutionContext,
  targetMs: number,
): Promise<void> {
  const startedAtMs = Date.parse(
    proxy.experimentStartedAt ?? context.startedAt ?? new Date().toISOString(),
  );
  const remainingMs = targetMs - (Date.now() - startedAtMs);
  if (remainingMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  }
}

async function runWorkload(
  proxy: ApplicationProxy,
  context: ExecutionContext,
  input: ExperimentInput,
): Promise<readonly ProxyEvidenceLike[]> {
  const schedule = input.schedule;
  await request(proxy, context);
  if (input.scenario === "rpc-rate-limit") {
    const rateLimit = schedule as RateLimitSchedule;
    for (let index = 0; index < Math.max(2, rateLimit.maxRequests); index += 1)
      await request(proxy, context);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, rateLimit.windowMs),
    );
    if (!context.cancellationSignal.aborted) await request(proxy, context);
  } else if (input.scenario === "rpc-intermittent-failure") {
    const intermittent = schedule as IntermittentFailureSchedule;
    await waitUntilElapsed(proxy, context, intermittent.startOffsetMs);
    for (
      let index = 0;
      index < intermittent.windowCount && !context.cancellationSignal.aborted;
      index += 1
    ) {
      await request(proxy, context);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, intermittent.failureDurationMs),
      );
      if (!context.cancellationSignal.aborted) await request(proxy, context);
      if (index + 1 < intermittent.windowCount)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, intermittent.recoveryIntervalMs),
        );
    }
  } else {
    await waitUntilElapsed(
      proxy,
      context,
      "startOffsetMs" in schedule ? schedule.startOffsetMs : 0,
    );
    if (input.scenario === "rpc-connection-failure") {
      try {
        await request(proxy, context);
      } catch (error) {
        if (proxy.evidence.at(-1)?.outcome !== "injected_connection_failure")
          throw error;
      }
    } else {
      await request(proxy, context);
    }
    const faultDuration =
      "durationMs" in schedule
        ? schedule.durationMs
        : "failureDurationMs" in schedule
          ? schedule.failureDurationMs
          : 100;
    await new Promise<void>((resolve) => setTimeout(resolve, faultDuration));
    if (!context.cancellationSignal.aborted) await request(proxy, context);
  }
  return proxy.evidence;
}

function createEvidence(
  input: ExperimentInput,
  result: ExecutionResult<readonly ProxyEvidenceLike[]>,
  proxy: ApplicationProxy | undefined,
  context: ExecutionContext,
): EvidenceRecord {
  const records = (
    Array.isArray(result.value) ? result.value : (proxy?.evidence ?? [])
  ) as readonly ProxyEvidenceLike[];
  const execution = {
    executionId: result.executionId,
    state:
      result.state === "completed" ||
      result.state === "failed" ||
      result.state === "cancelled" ||
      result.state === "timed_out"
        ? result.state
        : "failed",
    ...(proxy?.experimentStartedAt === undefined &&
    context.startedAt === undefined
      ? {}
      : { startedAt: proxy?.experimentStartedAt ?? context.startedAt }),
    ...(context.finishedAt === undefined
      ? {}
      : { finishedAt: context.finishedAt }),
  } as const;
  const warnings =
    result.cleanupFailures.length > 0
      ? ["One or more cleanup handlers failed."]
      : [];
  switch (input.scenario) {
    case "rpc-blackout":
      return createRpcBlackoutEvidence(
        execution,
        input.schedule as BlackoutSchedule,
        records,
        { warnings },
      );
    case "rpc-latency":
      return createRpcLatencyEvidence(
        execution,
        input.schedule as LatencySchedule,
        records,
        { warnings },
      );
    case "rpc-intermittent-failure":
      return createRpcIntermittentFailureEvidence(
        execution,
        input.schedule as IntermittentFailureSchedule,
        records,
        { warnings },
      );
    case "rpc-rate-limit":
      return createRpcRateLimitEvidence(
        execution,
        input.schedule as RateLimitSchedule,
        records,
        { warnings },
      );
    case "rpc-connection-failure":
      return createRpcConnectionFailureEvidence(
        execution,
        input.schedule as ConnectionFailureSchedule,
        records,
        { warnings },
      );
    case "rpc-malformed-response":
      return createRpcMalformedResponseEvidence(
        execution,
        input.schedule as MalformedResponseSchedule,
        records,
        { warnings },
      );
  }
}

export async function runExperiment(
  input: ExperimentInput,
  dependencies: ApplicationDependencies = {},
): Promise<EvidenceRecord> {
  validateScenarioMode(scenarioDefinition(input.scenario), "local");
  const createProxy =
    dependencies.createProxy ??
    ((config: ConstructorParameters<typeof RpcProxy>[0]): ApplicationProxy => {
      const proxy = new RpcProxy(config);
      return {
        get evidence() {
          return proxy.evidence;
        },
        get experimentStartedAt() {
          return proxy.experimentStartedAt;
        },
        get listeningAddress() {
          return proxy.listeningAddress;
        },
        start: async () => {
          await proxy.start();
        },
        close: () => proxy.close(),
      };
    });
  const start = dependencies.startExecution ?? startExecution;
  let proxy: ApplicationProxy | undefined;
  const handle = start<readonly ProxyEvidenceLike[]>(
    {
      scenarioId: input.scenario,
      timeoutMs: input.timeoutMs,
      target: input.upstream,
      parameters: { ...input.schedule },
    },
    async (context) => {
      const createdProxy = createProxy(proxyConfig(input, context.executionId));
      proxy = createdProxy;
      context.registerCleanup("rpc-proxy", () => createdProxy.close());
      await createdProxy.start();
      return runWorkload(createdProxy, context, input);
    },
  );
  const onAbort = (): void => {
    handle.context.requestCancellation();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let result: ExecutionResult<readonly ProxyEvidenceLike[]>;
  try {
    result = await handle.result;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
  const evidence = createEvidence(input, result, proxy, handle.context);
  await (dependencies.writeEvidence ?? writeEvidence)(
    join(input.evidenceDirectory, `${evidence.executionId}.json`),
    evidence,
  );
  return evidence;
}
