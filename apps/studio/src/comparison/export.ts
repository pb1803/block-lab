/**
 * Redacted, versioned export of a completed RPC comparison.
 *
 * The export is built from the validated Studio model, not from the raw payload,
 * so it is a whitelist: raw RPC parameters, headers, storage, worker internals,
 * and anything else the page may have attached cannot reach the artifact. The
 * only exceptions are explicitly listed in `redaction.excluded`.
 *
 * This module is environment-neutral (no DOM, no Node APIs) so it can be tested
 * directly and reused by any host.
 */
import { EXCLUDED_METHOD_EXAMPLES, redactMessage } from "@blocklab/browser-rpc";
import {
  type MethodRow,
  parseStudioSnapshot,
  type RouteStatusView,
  type StudioComparisonModel,
  type StudioComparisonState,
  type ViemRouteView,
} from "./model.js";

export const STUDIO_EXPORT_SCHEMA_VERSION = "1.0";

export const STUDIO_EXPORT_KIND = "blocklab.rpc-comparison";

/** Two routes measured and every eligible method attempted successfully. */
export type ExportCompleteness = "complete" | "incomplete" | "failed";

export interface ExportedAttempt {
  readonly method: string;
  readonly success: boolean | null;
  readonly latencyMs: number | null;
  readonly harnessRouted: boolean | null;
  readonly errorCategory: string | null;
}

export interface ExportedRouteTotals {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly successRatePct: number;
  readonly averageLatencyMs: number | null;
  readonly harnessRouted: number;
}

export interface ExportedRoute {
  readonly route: "direct" | "anon-rpc";
  readonly label: string;
  readonly ready: boolean;
  readonly state: string;
  readonly workerId: string | null;
  readonly workerKind: "reference" | "network" | null;
  readonly workerClassification: string;
  readonly initializationError: string | null;
  readonly attempts: readonly ExportedAttempt[];
  readonly totals: ExportedRouteTotals;
}

export interface ExportedViemRoute {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly chainId: number | null;
  readonly blockNumber: string | null;
  readonly balanceWei: string | null;
  readonly callData: string | null;
  readonly errorCategory: string | null;
  readonly errorMessage: string | null;
}

export interface StudioComparisonExport {
  readonly schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION;
  readonly kind: typeof STUDIO_EXPORT_KIND;
  readonly exportedAt: string;
  readonly run: {
    readonly runId: string;
    readonly generatedAt: string;
    readonly comparisonSchemaVersion: string;
    readonly completeness: ExportCompleteness;
    readonly completenessReasons: readonly string[];
    readonly worker: {
      readonly id: string | null;
      readonly kind: "reference" | "network" | null;
      readonly classification: string;
      readonly ready: boolean;
    };
  };
  readonly direct: ExportedRoute;
  readonly anonRpc: ExportedRoute | null;
  readonly methods: {
    readonly eligible: readonly string[];
    readonly excluded: readonly string[];
  };
  readonly coverage: {
    readonly routedMethods: readonly string[];
    readonly routedCount: number;
    readonly coveragePct: number;
    readonly skippedMethods: number;
    readonly denominator: string;
  };
  readonly viem: {
    readonly direct: ExportedViemRoute;
    readonly anonRpc: ExportedViemRoute;
  } | null;
  readonly runtime: {
    readonly userAgent: string;
    readonly origin: string;
  } | null;
  readonly limitations: readonly string[];
  readonly redaction: {
    readonly version: string;
    readonly excluded: readonly string[];
  };
}

export interface ComparisonExportArtifact {
  readonly value: StudioComparisonExport;
  /** Pretty-printed JSON with a trailing newline. */
  readonly json: string;
  readonly filename: string;
  readonly runId: string;
  readonly completeness: ExportCompleteness;
}

export type ComparisonExportResult =
  | { readonly ok: true; readonly artifact: ComparisonExportArtifact }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly issues: readonly string[];
    };

export interface ComparisonExportOptions {
  /** Injectable clock for deterministic tests; defaults to now. */
  readonly exportedAt?: string;
  /** Reject `incomplete` / `failed` results instead of labelling them. */
  readonly requireComplete?: boolean;
}

const REDACTION_VERSION = "1.0";

/** Fixed, reviewable list of what an export never contains. */
const EXCLUDED_FIELDS: readonly string[] = [
  "private keys and signer material",
  "wallet identifiers, addresses, and account lists",
  "cookies and browser storage",
  "authentication tokens, API keys, and bearer headers",
  "credential-bearing RPC URLs (only a page origin may be recorded)",
  "raw RPC request parameters and state overrides",
  "request and response headers",
  "worker internals (bundle contents, specifiers, sandbox objects)",
  "unredacted exception messages and stack traces",
];

const WORKER_CLASSIFICATION = {
  reference:
    "reference passthrough worker: ordinary fetch inside the sandbox, not anonymizing",
  network:
    "network worker declared anonymizing by the Anon-RPC adopter list; routing verified, anonymity not measured",
  unknown: "worker classification not recorded for this run",
} as const;

function classification(kind: "reference" | "network" | null): string {
  if (kind === "reference") return WORKER_CLASSIFICATION.reference;
  if (kind === "network") return WORKER_CLASSIFICATION.network;
  return WORKER_CLASSIFICATION.unknown;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowsFor(
  model: StudioComparisonModel,
  route: "direct" | "anon-rpc",
): ExportedAttempt[] {
  return model.methods.map((row: MethodRow) => {
    const cell = route === "direct" ? row.direct : row.anonRpc;
    return {
      method: row.method,
      success: cell.success,
      latencyMs: finite(cell.latencyMs),
      harnessRouted: cell.routedThroughHarness,
      errorCategory: cell.errorCategory,
    };
  });
}

function totalsOf(attempts: readonly ExportedAttempt[]): ExportedRouteTotals {
  const attempted = attempts.filter((attempt) => attempt.success !== null);
  const succeeded = attempts.filter(
    (attempt) => attempt.success === true,
  ).length;
  const failed = attempts.filter((attempt) => attempt.success === false).length;
  const measured = attempts.filter(
    (attempt): attempt is ExportedAttempt & { latencyMs: number } =>
      attempt.success !== null && attempt.latencyMs !== null,
  );
  const latencyTotal = measured.reduce(
    (sum, attempt) => sum + attempt.latencyMs,
    0,
  );
  return {
    attempted: attempted.length,
    succeeded,
    failed,
    successRatePct:
      attempted.length === 0 ? 0 : round((succeeded / attempted.length) * 100),
    averageLatencyMs:
      measured.length === 0 ? null : round(latencyTotal / measured.length),
    harnessRouted: attempts.filter((attempt) => attempt.harnessRouted === true)
      .length,
  };
}

function exportRoute(
  status: RouteStatusView,
  attempts: readonly ExportedAttempt[],
): ExportedRoute {
  return {
    route: status.route,
    label: status.label,
    ready: status.ready,
    state: status.state,
    workerId: status.route === "direct" ? null : status.workerId,
    workerKind: status.workerKind,
    workerClassification:
      status.route === "direct"
        ? "not applicable: direct RPC does not use a worker"
        : classification(status.workerKind),
    initializationError: status.initializationError,
    attempts,
    totals: totalsOf(attempts),
  };
}

function exportViem(view: ViemRouteView): ExportedViemRoute {
  return {
    ran: view.ran,
    ok: view.ok,
    chainId: view.chainId,
    blockNumber: view.blockNumber,
    balanceWei: view.balanceWei,
    callData: view.callData,
    errorCategory: view.errorCategory,
    errorMessage: view.errorMessage,
  };
}

/** Reduces a page URL to its origin so query strings and paths cannot leak. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

interface Completeness {
  readonly status: ExportCompleteness;
  readonly reasons: string[];
}

function completenessOf(model: StudioComparisonModel): Completeness {
  const reasons: string[] = [];
  const anon = model.anonRpc;
  let status: ExportCompleteness = "complete";

  if (anon === null) {
    status = "incomplete";
    reasons.push("Anon-RPC was not measured, so no route comparison exists.");
  } else if (!anon.ready) {
    status = "failed";
    reasons.push(
      anon.initializationError === null
        ? "Anon-RPC did not become ready; no harness request was attempted and no direct fallback occurred."
        : `Anon-RPC did not become ready: ${anon.initializationError}. No harness request was attempted and no direct fallback occurred.`,
    );
  }

  const notAttempted = model.methods.filter(
    (row) => !row.direct.attempted || !row.anonRpc.attempted,
  );
  if (notAttempted.length > 0) {
    if (status === "complete") status = "incomplete";
    reasons.push(
      `${notAttempted.length} eligible method(s) were not attempted on both routes: ${notAttempted
        .map((row) => row.method)
        .join(", ")}.`,
    );
  }

  const failedMethods = model.methods.filter(
    (row) => row.direct.success === false || row.anonRpc.success === false,
  );
  if (failedMethods.length > 0 && status === "complete") {
    status = "incomplete";
    reasons.push(
      `${failedMethods.length} method(s) failed on at least one route: ${failedMethods
        .map((row) => row.method)
        .join(", ")}.`,
    );
  }

  if (model.warnings.length > 0) {
    if (status === "complete") status = "incomplete";
    reasons.push(...model.warnings);
  }

  if (status === "complete") {
    reasons.push("Both routes were ready and every eligible method succeeded.");
  }
  return { status, reasons: [...new Set(reasons)] };
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Stable 64-bit FNV-1a over the canonical body; no crypto dependency. */
function digest(input: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

function compactTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  const date = Number.isNaN(parsed) ? new Date(0) : new Date(parsed);
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Deterministic file name: an artifact with the same body gets the same name. */
export function comparisonExportFilename(
  generatedAt: string,
  runId: string,
): string {
  const stamp = compactTimestamp(generatedAt).replace(/[^0-9TZ]/g, "");
  const safeId = runId.replace(/[^a-zA-Z0-9-]/g, "");
  return `blocklab-rpc-comparison-${stamp}-${safeId}.json`;
}

function rejected(
  reason: string,
  issues: readonly string[] = [],
): ComparisonExportResult {
  return { ok: false, reason, issues };
}

/**
 * Builds the export artifact for an already-published snapshot.
 *
 * The snapshot is validated again here; nothing is exported from a payload that
 * Studio could not display, and a run with no recorded attempt is rejected
 * rather than exported as an empty "result". Partial and failed runs are
 * exported only with an explicit `completeness` label and reasons.
 */
export function buildComparisonExport(
  snapshot: unknown,
  options: ComparisonExportOptions = {},
): ComparisonExportResult {
  const state: StudioComparisonState = parseStudioSnapshot(snapshot);
  if (state.status === "empty") {
    return rejected("There is no comparison to export.");
  }
  if (state.status === "invalid") {
    return rejected(
      "The comparison payload is not valid, so it cannot be exported.",
      state.issues,
    );
  }

  const model = state.model;
  const eligible = new Set(model.coverage.eligibleMethods);
  const offAllowlist = model.methods
    .map((row) => row.method)
    .filter((method) => !eligible.has(method));
  if (offAllowlist.length > 0) {
    return rejected(
      "The payload contains methods outside the read-only allowlist, so it cannot be exported.",
      [`Unexpected methods: ${[...new Set(offAllowlist)].join(", ")}.`],
    );
  }

  const attempted = model.methods.filter(
    (row) => row.direct.attempted || row.anonRpc.attempted,
  );
  if (attempted.length === 0) {
    return rejected(
      "No request attempts were recorded, so there is no result to export.",
      model.warnings,
    );
  }

  const completeness = completenessOf(model);
  if (options.requireComplete === true && completeness.status !== "complete") {
    return rejected(
      `The comparison is ${completeness.status}, and this export requires a complete result.`,
      completeness.reasons,
    );
  }

  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const directAttempts = rowsFor(model, "direct");
  const anonAttempts = rowsFor(model, "anon-rpc");
  const worker = model.anonRpc;
  const runtimeRaw = isRuntime(snapshot) ? snapshot.runtime : undefined;
  const origin = runtimeRaw === undefined ? null : originOf(runtimeRaw.url);
  const runtime =
    runtimeRaw === undefined
      ? null
      : {
          userAgent: redactMessage(runtimeRaw.userAgent).slice(0, 220),
          origin: origin ?? "unavailable",
        };

  const body: Omit<StudioComparisonExport, "run"> = {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION,
    kind: STUDIO_EXPORT_KIND,
    exportedAt,
    direct: exportRoute(model.direct, directAttempts),
    anonRpc:
      model.anonRpc === null ? null : exportRoute(model.anonRpc, anonAttempts),
    methods: {
      eligible: [...model.coverage.eligibleMethods],
      excluded: [...EXCLUDED_METHOD_EXAMPLES],
    },
    coverage: {
      routedMethods: [...model.coverage.routedMethods],
      routedCount: model.coverage.routedCount,
      coveragePct: model.coverage.coveragePct,
      skippedMethods: model.coverage.skipped,
      denominator: model.coverage.denominator,
    },
    viem:
      model.viem === null
        ? null
        : {
            direct: exportViem(model.viem.direct),
            anonRpc: exportViem(model.viem.anonRpc),
          },
    runtime,
    limitations: [...model.limitations],
    redaction: {
      version: REDACTION_VERSION,
      excluded: [...EXCLUDED_FIELDS],
    },
  };

  const provisionalRun = {
    runId: "",
    generatedAt: model.generatedAt,
    comparisonSchemaVersion: model.schemaVersion,
    completeness: completeness.status,
    completenessReasons: completeness.reasons,
    worker: {
      id: worker?.workerId ?? null,
      kind: worker?.workerKind ?? null,
      classification: classification(worker?.workerKind ?? null),
      ready: worker?.ready ?? false,
    },
  };
  // The identifier covers the exported run, not the export time: the same run
  // always maps to the same id, and two different runs cannot collide silently.
  const runId = `rpc-${digest(
    JSON.stringify({ ...body, exportedAt: "", run: provisionalRun }),
  )}`;
  const value: StudioComparisonExport = {
    ...body,
    run: { ...provisionalRun, runId },
  };
  const artifact: ComparisonExportArtifact = {
    value,
    json: `${JSON.stringify(value, null, 2)}\n`,
    filename: comparisonExportFilename(value.run.generatedAt, runId),
    runId,
    completeness: value.run.completeness,
  };
  return { ok: true, artifact };
}

function isRuntime(
  snapshot: unknown,
): snapshot is { runtime: { userAgent: string; url: string } } {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const runtime = (snapshot as { runtime?: unknown }).runtime;
  return (
    typeof runtime === "object" &&
    runtime !== null &&
    typeof (runtime as { userAgent?: unknown }).userAgent === "string" &&
    typeof (runtime as { url?: unknown }).url === "string"
  );
}
