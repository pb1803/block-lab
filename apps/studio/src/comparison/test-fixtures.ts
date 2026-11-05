/**
 * TEST DATA ONLY.
 *
 * These fixtures model the payload shape that the browser layer produces. They
 * were written by hand for unit tests and are not browser verification and not
 * real measurements. Real values are recorded in docs/anon-rpc-poc.md.
 */
import type { RouteComparison, RouteWorkload } from "@blocklab/browser-rpc";
import type { StudioRpcSnapshot, ViemProbeResult } from "./model.js";

const METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
] as const;

function attempts(
  routed: boolean,
  latencies: readonly number[],
): RouteWorkload["attempts"] {
  return METHODS.map((method, index) => ({
    method,
    success: true,
    durationMs: latencies[index] ?? 0,
    receivedThroughHarness: routed,
  }));
}

export const directWorkload: RouteWorkload = {
  route: "direct",
  label: "Direct RPC",
  state: "ready",
  initialized: true,
  attempts: attempts(false, [12, 18, 25, 30]),
  total: 4,
  succeeded: 4,
  failed: 0,
  successRatePct: 100,
  averageLatencyMs: 21.3,
  harnessRouted: 0,
};

export const networkWorkload: RouteWorkload = {
  route: "anon-rpc",
  label: "Anon-RPC network worker",
  workerId: "tor-js",
  workerKind: "network",
  state: "ready",
  initialized: true,
  attempts: attempts(true, [90, 120, 150, 180]),
  total: 4,
  succeeded: 4,
  failed: 0,
  successRatePct: 100,
  averageLatencyMs: 135,
  harnessRouted: 4,
};

export const referenceWorkload: RouteWorkload = {
  ...networkWorkload,
  label: "Anon-RPC reference worker",
  workerId: "passthrough",
  workerKind: "reference",
};

export const okComparison: RouteComparison = {
  schemaVersion: "1.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  direct: directWorkload,
  anonRpc: networkWorkload,
  coverage: {
    eligibleMethods: [...METHODS],
    routedMethods: [...METHODS],
    excludedMethods: ["eth_sendTransaction"],
    coveragePct: 100,
  },
  notes: [
    "Latency is a transport measurement. It is not a measure of privacy and must not be read as evidence of anonymity.",
    "The configured worker is declared by the Anon-RPC adopter list as an anonymizing network worker.",
  ],
};

export const partialComparison: RouteComparison = {
  schemaVersion: "1.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  direct: {
    route: "direct",
    label: "Direct RPC",
    state: "ready",
    initialized: true,
    attempts: [
      {
        method: "eth_chainId",
        success: true,
        durationMs: 10,
        receivedThroughHarness: false,
      },
      {
        method: "eth_blockNumber",
        success: false,
        durationMs: 0,
        receivedThroughHarness: false,
        errorCategory: "timeout",
      },
    ],
    total: 2,
    succeeded: 1,
    failed: 1,
    successRatePct: 50,
    averageLatencyMs: 5,
    harnessRouted: 0,
  },
  anonRpc: null,
  coverage: {
    eligibleMethods: [...METHODS],
    routedMethods: [],
    excludedMethods: [],
    coveragePct: 0,
  },
  notes: [],
};

export const failedWorkerComparison: RouteComparison = {
  schemaVersion: "1.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  direct: directWorkload,
  anonRpc: {
    route: "anon-rpc",
    label: "Anon-RPC network worker",
    workerId: "nox",
    workerKind: "network",
    state: "failed",
    initialized: false,
    initializationError: "short bytes32 return",
    attempts: METHODS.map((method) => ({
      method,
      success: false,
      durationMs: 0,
      receivedThroughHarness: false,
      errorCategory: "not-ready",
    })),
    total: 4,
    succeeded: 0,
    failed: 4,
    successRatePct: 0,
    averageLatencyMs: 0,
    harnessRouted: 0,
  },
  coverage: {
    eligibleMethods: [...METHODS],
    routedMethods: [],
    excludedMethods: [],
    coveragePct: 0,
  },
  notes: [
    "Anon-RPC initialization did not succeed: short bytes32 return. No request was attempted through the harness and no direct fallback occurred.",
  ],
};

export const viemDirect: ViemProbeResult = {
  route: "direct",
  ok: true,
  chainId: 1,
  blockNumber: "26350471",
  balanceWei: "14156789249369330431019",
  callData: "0x",
};

export const viemAnon: ViemProbeResult = {
  route: "anon-rpc",
  ok: true,
  chainId: 1,
  blockNumber: "26350477",
  balanceWei: "14156789249369330431019",
  callData: "0x",
};

/**
 * Builds a snapshot from a payload that may be deliberately malformed, so tests
 * can exercise the parser instead of only the happy path.
 */
export function snapshot(
  comparison: unknown,
  viem?: StudioRpcSnapshot["viem"],
): StudioRpcSnapshot {
  const generatedAt =
    typeof comparison === "object" &&
    comparison !== null &&
    "generatedAt" in comparison &&
    typeof (comparison as { generatedAt: unknown }).generatedAt === "string"
      ? (comparison as { generatedAt: string }).generatedAt
      : "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: "1.0",
    generatedAt,
    comparison: comparison as RouteComparison,
    ...(viem === undefined ? {} : { viem }),
    runtime: {
      userAgent: "test-fixture",
      url: "http://127.0.0.1:5173/?selftest=1",
    },
  };
}
