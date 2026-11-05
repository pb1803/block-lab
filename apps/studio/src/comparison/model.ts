/**
 * Read-only view model for BLOCKLAB's RPC comparison.
 *
 * Studio owns presentation only. The model consumes the payload that the
 * browser layer already produces (`RouteComparison` from
 * `@blocklab/browser-rpc`, plus optional Viem probe results) and never executes
 * an RPC request itself.
 *
 * Schema `1.0` is deliberately narrow: unknown keys are ignored, missing or
 * malformed values become `unavailable`, and every rendered string is either
 * copied from a validated field or a fixed statement written here.
 */
import {
  type RouteComparison,
  type RouteWorkload,
  redactMessage,
} from "@blocklab/browser-rpc";

export const STUDIO_COMPARISON_SCHEMA_VERSION = "1.0";

export const STUDIO_COMPARISON_EVENT = "blocklab:comparison";

export interface ViemProbeResult {
  readonly route: "direct" | "anon-rpc";
  readonly ok: boolean;
  readonly chainId?: number;
  readonly blockNumber?: string;
  readonly balanceWei?: string;
  readonly callData?: string;
  readonly errorCategory?: string;
  readonly errorMessage?: string;
}

/** The single payload Studio renders. Produced by the browser application. */
export interface StudioRpcSnapshot {
  readonly schemaVersion: typeof STUDIO_COMPARISON_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly comparison: RouteComparison;
  readonly viem?: {
    readonly direct?: ViemProbeResult;
    readonly anonRpc?: ViemProbeResult | null;
  };
  readonly runtime?: { readonly userAgent: string; readonly url: string };
}

export interface RouteCell {
  readonly attempted: boolean;
  readonly success: boolean | null;
  readonly latencyMs: number | null;
  readonly errorCategory: string | null;
  readonly routedThroughHarness: boolean | null;
}

export interface MethodRow {
  readonly method: string;
  readonly direct: RouteCell;
  readonly anonRpc: RouteCell;
}

export interface RouteStatusView {
  readonly route: "direct" | "anon-rpc";
  readonly label: string;
  readonly state: string;
  readonly ready: boolean;
  readonly measured: boolean;
  readonly workerId: string | null;
  readonly workerKind: "reference" | "network" | null;
  readonly workerDescription: string;
  readonly initializationError: string | null;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
}

export interface CoverageView {
  readonly eligibleMethods: readonly string[];
  readonly routedMethods: readonly string[];
  readonly routedCount: number;
  readonly coveragePct: number;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly denominator: string;
}

export interface ViemRouteView {
  readonly route: RouteStatusView["route"];
  readonly ran: boolean;
  readonly ok: boolean;
  readonly chainId: number | null;
  readonly blockNumber: string | null;
  readonly balanceWei: string | null;
  readonly callData: string | null;
  readonly errorCategory: string | null;
  readonly errorMessage: string | null;
}

export interface StudioComparisonModel {
  readonly schemaVersion: typeof STUDIO_COMPARISON_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly direct: RouteStatusView;
  readonly anonRpc: RouteStatusView | null;
  readonly methods: readonly MethodRow[];
  readonly coverage: CoverageView;
  readonly viem: {
    readonly direct: ViemRouteView;
    readonly anonRpc: ViemRouteView;
  } | null;
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
  readonly summary: string;
}

export type StudioComparisonState =
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly issues: readonly string[] }
  | {
      readonly status: "ready";
      readonly model: StudioComparisonModel;
    };

const METHOD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const MAX_TEXT = 220;
const LIMITATIONS = [
  "Latency is not a privacy measurement. It describes the transport only.",
  "A passthrough reference worker performs an ordinary fetch inside the sandbox and does not anonymize anything.",
  "Successful routing proves that a request reached the harness, not that it is anonymous.",
  "Results reflect the specific worker and endpoint recorded for this run; they are not a general claim about Anon-RPC.",
];

function text(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return redactMessage(trimmed).slice(0, MAX_TEXT);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function count(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeName(value: unknown): "direct" | "anon-rpc" | null {
  return value === "direct" || value === "anon-rpc" ? value : null;
}

function workerKind(value: unknown): "reference" | "network" | null {
  return value === "reference" || value === "network" ? value : null;
}

function workerDescription(kind: "reference" | "network" | null): string {
  if (kind === "reference") {
    return "Passthrough reference worker: ordinary fetch inside the sandbox, not anonymizing.";
  }
  if (kind === "network") {
    return "Network worker declared anonymizing by the Anon-RPC adopter list; routing verified, anonymity not measured.";
  }
  return "Worker not recorded for this run.";
}

interface Attempt {
  readonly method: string;
  readonly success: boolean | null;
  readonly durationMs: number | null;
  readonly routed: boolean | null;
  readonly errorCategory: string | null;
}

function readAttempts(
  workload: Record<string, unknown>,
  issues: string[],
): Attempt[] {
  const raw = workload.attempts;
  if (!Array.isArray(raw)) {
    issues.push("A route did not report any request attempts.");
    return [];
  }
  const attempts: Attempt[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const method = text(entry.method);
    if (method === null || !METHOD_NAME.test(method)) continue;
    const latency = finiteNumber(entry.durationMs);
    if (latency === null) {
      issues.push(`${method}: latency was unavailable.`);
    }
    attempts.push({
      method,
      success: bool(entry.success),
      durationMs: latency,
      routed: bool(entry.receivedThroughHarness),
      errorCategory: text(entry.errorCategory),
    });
  }
  if (attempts.length !== raw.length) {
    issues.push("One or more attempts were dropped because they were invalid.");
  }
  return attempts;
}

function readRoute(
  route: "direct" | "anon-rpc",
  workload: RouteWorkload | Record<string, unknown> | null,
  issues: string[],
): { status: RouteStatusView; attempts: readonly Attempt[] } | null {
  if (workload === null) return null;
  const record = workload as unknown as Record<string, unknown>;
  const attempts = readAttempts(record, issues);
  const succeeded = attempts.filter(
    (attempt) => attempt.success === true,
  ).length;
  const failed = attempts.filter((attempt) => attempt.success === false).length;
  const state = text(record.state, "unavailable") ?? "unavailable";
  const initialized = bool(record.initialized) ?? false;
  const kind = workerKind(record.workerKind);

  return {
    status: {
      route,
      label:
        text(record.label, route === "direct" ? "Direct RPC" : "Anon-RPC") ??
        route,
      state,
      ready: initialized && state === "ready",
      measured: true,
      workerId: text(record.workerId),
      workerKind: kind,
      workerDescription: workerDescription(kind),
      initializationError: text(record.initializationError),
      attempted: attempts.length,
      succeeded,
      failed,
    },
    attempts,
  };
}

function cell(attempts: readonly Attempt[], method: string): RouteCell {
  const attempt = attempts.find((entry) => entry.method === method);
  if (attempt === undefined) {
    return {
      attempted: false,
      success: null,
      latencyMs: null,
      errorCategory: null,
      routedThroughHarness: null,
    };
  }
  return {
    attempted: true,
    success: attempt.success,
    latencyMs: attempt.durationMs,
    errorCategory: attempt.errorCategory,
    routedThroughHarness: attempt.routed,
  };
}

function viemRoute(
  route: RouteStatusView["route"],
  value: unknown,
  issues: string[],
): ViemRouteView {
  const empty: ViemRouteView = {
    route,
    ran: false,
    ok: false,
    chainId: null,
    blockNumber: null,
    balanceWei: null,
    callData: null,
    errorCategory: null,
    errorMessage: null,
  };
  if (!isRecord(value)) return empty;
  const routeField = routeName(value.route);
  if (routeField !== null && routeField !== route) {
    issues.push("A Viem probe was reported under an unexpected route.");
  }
  return {
    route,
    ran: true,
    ok: bool(value.ok) === true,
    chainId: count(value.chainId),
    blockNumber: text(value.blockNumber),
    balanceWei: text(value.balanceWei),
    callData: text(value.callData),
    errorCategory: text(value.errorCategory),
    errorMessage: text(value.errorMessage),
  };
}

/**
 * Parses an untrusted snapshot. Nothing from the payload is rendered verbatim:
 * only validated fields become text, and problem fields are reported instead of
 * guessed.
 */
export function parseStudioSnapshot(value: unknown): StudioComparisonState {
  if (value === undefined || value === null) return { status: "empty" };
  if (!isRecord(value)) {
    return {
      status: "invalid",
      issues: ["The comparison payload is not an object."],
    };
  }
  if (value.schemaVersion !== STUDIO_COMPARISON_SCHEMA_VERSION) {
    return {
      status: "invalid",
      issues: [
        `Unsupported comparison schema version: ${String(value.schemaVersion)}.`,
      ],
    };
  }
  const comparison = value.comparison;
  if (!isRecord(comparison)) {
    return {
      status: "invalid",
      issues: ["The comparison payload has no comparison object."],
    };
  }
  if (!isRecord(comparison.direct)) {
    return {
      status: "invalid",
      issues: ["The comparison payload has no direct route result."],
    };
  }

  const issues: string[] = [];
  const direct = readRoute(
    "direct",
    comparison.direct as unknown as RouteWorkload,
    issues,
  );
  if (direct === null) {
    return {
      status: "invalid",
      issues: ["The direct route result could not be read."],
    };
  }
  const anonValue = comparison.anonRpc;
  const anonRpc =
    anonValue === null || anonValue === undefined
      ? null
      : readRoute("anon-rpc", anonValue as unknown as RouteWorkload, issues);

  const coverageRaw = isRecord(comparison.coverage) ? comparison.coverage : {};
  const eligible = Array.isArray(coverageRaw.eligibleMethods)
    ? coverageRaw.eligibleMethods
        .map((method) => text(method))
        .filter(
          (method): method is string =>
            method !== null && METHOD_NAME.test(method),
        )
    : [];
  const routed = Array.isArray(coverageRaw.routedMethods)
    ? coverageRaw.routedMethods
        .map((method) => text(method))
        .filter(
          (method): method is string =>
            method !== null && METHOD_NAME.test(method),
        )
    : [];
  if (eligible.length === 0) {
    issues.push("The payload did not list any eligible methods.");
  }

  const methods = [...eligible];
  for (const attempt of [...direct.attempts, ...(anonRpc?.attempts ?? [])]) {
    if (!methods.includes(attempt.method)) methods.push(attempt.method);
  }

  const rows: MethodRow[] = methods.map((method) => ({
    method,
    direct: cell(direct.attempts, method),
    anonRpc: cell(anonRpc?.attempts ?? [], method),
  }));

  const skipped = rows.filter(
    (row) => !row.direct.attempted && !row.anonRpc.attempted,
  ).length;
  const routedCount = new Set(routed).size;
  const coveragePct =
    eligible.length === 0
      ? 0
      : Math.round((routedCount / eligible.length) * 1000) / 10;
  const payloadPct = finiteNumber(coverageRaw.coveragePct);
  if (payloadPct !== null && Math.abs(payloadPct - coveragePct) > 0.05) {
    issues.push(
      `Routing coverage was recomputed from routed methods (${coveragePct}%) instead of the reported ${payloadPct}%.`,
    );
  }

  const notes = Array.isArray(comparison.notes)
    ? comparison.notes
        .map((note) => text(note))
        .filter((note): note is string => note !== null)
    : [];
  const limitations = [...LIMITATIONS];
  for (const note of notes) {
    if (!limitations.includes(note)) limitations.push(note);
  }

  const viemRaw = isRecord(value.viem) ? value.viem : null;
  const viem =
    viemRaw === null
      ? null
      : {
          direct: viemRoute("direct", viemRaw.direct, issues),
          anonRpc: viemRoute("anon-rpc", viemRaw.anonRpc, issues),
        };

  const model: StudioComparisonModel = {
    schemaVersion: STUDIO_COMPARISON_SCHEMA_VERSION,
    generatedAt: text(value.generatedAt) ?? "unavailable",
    direct: direct.status,
    anonRpc: anonRpc?.status ?? null,
    methods: rows,
    coverage: {
      eligibleMethods: eligible,
      routedMethods: [...new Set(routed)],
      routedCount,
      coveragePct,
      attempted: direct.status.attempted,
      succeeded: direct.status.succeeded,
      failed: direct.status.failed,
      skipped,
      denominator: `Routing coverage = methods answered through the Anon-RPC harness (${routedCount}) ÷ eligible read-only methods (${eligible.length}). Skipped methods are not counted as successful.`,
    },
    viem,
    limitations,
    warnings: [...new Set(issues)],
    summary:
      anonRpc === null
        ? "Direct route measured; Anon-RPC not measured."
        : anonRpc.status.ready
          ? `Both routes measured. Worker: ${anonRpc.status.workerId ?? "unrecorded"}.`
          : "Anon-RPC did not become ready; no harness request was attempted and no fallback occurred.",
  };

  return { status: "ready", model };
}

/** Builds a snapshot from already-computed results. Used by the browser layer. */
export function createStudioSnapshot(input: {
  readonly comparison: RouteComparison;
  readonly viem?: NonNullable<StudioRpcSnapshot["viem"]>;
  readonly runtime?: StudioRpcSnapshot["runtime"];
  readonly generatedAt?: string;
}): StudioRpcSnapshot {
  return {
    schemaVersion: STUDIO_COMPARISON_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    comparison: input.comparison,
    ...(input.viem === undefined ? {} : { viem: input.viem }),
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
  };
}
