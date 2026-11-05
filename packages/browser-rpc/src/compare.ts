import {
  READ_ONLY_METHODS,
  type ReadOnlyMethod,
  type RouteKind,
  type RpcObservation,
  type RpcTransport,
  type TransportState,
  type WorkerKind,
} from "./types.js";

/** Representative wallet/transaction methods BLOCKLAB refuses to route. */
export const EXCLUDED_METHOD_EXAMPLES: readonly string[] = [
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData_v4",
  "eth_accounts",
  "personal_sign",
  "wallet_switchEthereumChain",
];

export interface WorkloadEntry {
  readonly method: ReadOnlyMethod;
  readonly success: boolean;
  readonly durationMs: number;
  readonly receivedThroughHarness: boolean;
  readonly errorCategory?: string;
}

export interface RouteWorkload {
  readonly route: RouteKind;
  readonly label: string;
  readonly workerId?: string;
  readonly workerKind?: WorkerKind;
  readonly state: TransportState;
  readonly initialized: boolean;
  readonly initializationError?: string;
  readonly attempts: readonly WorkloadEntry[];
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly successRatePct: number;
  readonly averageLatencyMs: number | null;
  readonly harnessRouted: number;
}

export interface RouteComparison {
  readonly schemaVersion: "1.0";
  readonly generatedAt: string;
  readonly direct: RouteWorkload;
  readonly anonRpc: RouteWorkload | null;
  readonly coverage: {
    readonly eligibleMethods: readonly string[];
    readonly routedMethods: readonly string[];
    readonly excludedMethods: readonly string[];
    readonly coveragePct: number;
  };
  readonly notes: readonly string[];
}

export interface RunWorkloadOptions {
  readonly signal?: AbortSignal;
  readonly methods?: readonly ReadOnlyMethod[];
}

/** Runs the same read-only workload on one route, in a fixed order. */
export async function runWorkload(
  transport: RpcTransport,
  options?: RunWorkloadOptions,
): Promise<readonly RpcObservation[]> {
  const methods = options?.methods ?? READ_ONLY_METHODS;
  const observations: RpcObservation[] = [];
  for (const method of methods) {
    if (options?.signal?.aborted === true) break;
    observations.push(
      await transport.request(
        method,
        options?.signal === undefined ? undefined : { signal: options.signal },
      ),
    );
  }
  return observations;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface SummarizeOptions {
  readonly transport: RpcTransport;
  readonly observations: readonly RpcObservation[];
  readonly initialized: boolean;
  readonly initializationError?: string;
}

export function summarizeRoute(options: SummarizeOptions): RouteWorkload {
  const { transport, observations } = options;
  const attempts = observations.map(
    (observation): WorkloadEntry => ({
      method: observation.method,
      success: observation.success,
      durationMs: observation.durationMs,
      receivedThroughHarness: observation.receivedThroughHarness,
      ...(observation.errorCategory === undefined
        ? {}
        : { errorCategory: observation.errorCategory }),
    }),
  );
  const succeeded = attempts.filter((attempt) => attempt.success).length;
  const total = attempts.length;
  const latencyTotal = attempts.reduce(
    (sum, attempt) => sum + attempt.durationMs,
    0,
  );
  const workerId = observations.find(
    (observation) => observation.workerId !== undefined,
  )?.workerId;
  const workerKind = observations.find(
    (observation) => observation.workerKind !== undefined,
  )?.workerKind;

  return {
    route: transport.route,
    label: transport.label,
    ...(workerId === undefined ? {} : { workerId }),
    ...(workerKind === undefined ? {} : { workerKind }),
    state: transport.state,
    initialized: options.initialized,
    ...(options.initializationError === undefined
      ? {}
      : { initializationError: options.initializationError }),
    attempts,
    total,
    succeeded,
    failed: total - succeeded,
    successRatePct: total === 0 ? 0 : round((succeeded / total) * 100),
    averageLatencyMs: total === 0 ? null : round(latencyTotal / total),
    harnessRouted: attempts.filter((attempt) => attempt.receivedThroughHarness)
      .length,
  };
}

export interface BuildComparisonInput {
  readonly direct: RouteWorkload;
  readonly anonRpc: RouteWorkload | null;
}

/**
 * Builds a serializable comparison payload. It deliberately contains no
 * privacy verdict: latency and success rate describe the transport, not
 * anonymity, and the notes state that limitation explicitly.
 */
export function buildComparison(
  input: BuildComparisonInput,
  now: Date = new Date(),
): RouteComparison {
  const routedMethods =
    input.anonRpc === null
      ? []
      : [
          ...new Set(
            input.anonRpc.attempts
              .filter((attempt) => attempt.receivedThroughHarness)
              .map((attempt) => attempt.method),
          ),
        ];
  const notes: string[] = [
    "Latency is a transport measurement. It is not a measure of privacy and must not be read as evidence of anonymity.",
    "BLOCKLAB measures routing coverage, success rate, and latency only. It does not measure anonymity, resistance to traffic analysis, or endpoint honesty.",
    "Signing, transaction, wallet-control, and account methods are never routed by either transport.",
  ];

  if (input.anonRpc === null) {
    notes.push(
      "Anon-RPC was not measured, so no route comparison is available.",
    );
  } else {
    if (!input.anonRpc.initialized) {
      notes.push(
        `Anon-RPC initialization did not succeed${
          input.anonRpc.initializationError === undefined
            ? "."
            : `: ${input.anonRpc.initializationError}`
        } No request was attempted through the harness and no direct fallback occurred.`,
      );
    }
    if (input.anonRpc.workerKind === "reference") {
      notes.push(
        "The configured worker is a reference passthrough worker: it performs an ordinary fetch inside the sandbox, so requests are not anonymized.",
      );
    }
    if (input.anonRpc.workerKind === "network") {
      notes.push(
        "The configured worker is declared by the Anon-RPC adopter list as an anonymizing network worker. BLOCKLAB verified routing through the harness, not the network's anonymity properties.",
      );
    }
  }

  return {
    schemaVersion: "1.0",
    generatedAt: now.toISOString(),
    direct: input.direct,
    anonRpc: input.anonRpc,
    coverage: {
      eligibleMethods: READ_ONLY_METHODS,
      routedMethods,
      excludedMethods: EXCLUDED_METHOD_EXAMPLES,
      coveragePct: round(
        (routedMethods.length / READ_ONLY_METHODS.length) * 100,
      ),
    },
    notes,
  };
}
