import {
  AnonRpcTransport,
  buildComparison,
  DirectRpcTransport,
  type RouteComparison,
  type RouteWorkload,
  runWorkload,
  summarizeRoute,
  type WorkerDescriptor,
} from "@blocklab/browser-rpc";
import { runViemProbe, type ViemProbe } from "./viem-demo.js";

export interface SelfTestResult {
  readonly schemaVersion: "1.0";
  readonly generatedAt: string;
  readonly runtime: { readonly userAgent: string; readonly url: string };
  readonly worker: {
    readonly id: string;
    readonly kind: WorkerDescriptor["kind"];
    readonly chainId: number;
  };
  readonly direct: RouteWorkload;
  readonly anonRpc: RouteWorkload | null;
  readonly viem: {
    readonly direct: ViemProbe;
    readonly anonRpc: ViemProbe | null;
  };
  readonly comparison: RouteComparison;
  readonly ok: boolean;
}

export interface SelfTestInput {
  readonly endpoint: string;
  readonly bootstrapRpcUrl: string;
  readonly worker: WorkerDescriptor;
}

type SelfTestWindow = Window & {
  __blocklabSelfTest?: SelfTestResult;
  __blocklabSelfTestStatus?: "running" | "done";
};

/**
 * Headless-browser verification path: runs the same read-only workload on both
 * routes, records the comparison, and publishes it for an external driver. It
 * is only used when the page is opened with `?selftest=1`.
 */
export async function runSelfTest(
  input: SelfTestInput,
): Promise<SelfTestResult> {
  const scope = window as SelfTestWindow;
  scope.__blocklabSelfTestStatus = "running";

  const direct = new DirectRpcTransport({ endpoint: input.endpoint });
  const directObservations = await runWorkload(direct);
  const directSummary = summarizeRoute({
    transport: direct,
    observations: directObservations,
    initialized: true,
  });
  // Viem public-client path over the same transport instance, before it closes.
  const directViem = await runViemProbe(direct);
  direct.close();

  const anon = new AnonRpcTransport({
    endpoint: input.endpoint,
    bootstrapRpcUrl: input.bootstrapRpcUrl,
    worker: input.worker,
    ...(input.worker.exampleConfig === undefined
      ? {}
      : { config: input.worker.exampleConfig }),
  });

  let initialized = false;
  let initializationError: string | undefined;
  try {
    await anon.initialize();
    initialized = true;
  } catch (error) {
    initializationError =
      error instanceof Error ? error.message : "Worker initialization failed.";
  }

  const anonObservations = await runWorkload(anon);
  const anonSummary = summarizeRoute({
    transport: anon,
    observations: anonObservations,
    initialized,
    ...(initializationError === undefined ? {} : { initializationError }),
  });
  const anonViem = initialized ? await runViemProbe(anon) : null;
  const anonState = anon.state;
  anon.close();

  const comparison = buildComparison({
    direct: directSummary,
    anonRpc: anonSummary,
  });
  const result: SelfTestResult = {
    schemaVersion: "1.0",
    generatedAt: comparison.generatedAt,
    runtime: {
      userAgent: navigator.userAgent,
      url: location.href,
    },
    worker: {
      id: input.worker.id,
      kind: input.worker.kind,
      chainId: input.worker.chainId,
    },
    direct: directSummary,
    anonRpc: { ...anonSummary, state: anonState },
    viem: { direct: directViem, anonRpc: anonViem },
    comparison,
    ok:
      directSummary.successRatePct === 100 &&
      initialized &&
      anonSummary.successRatePct === 100 &&
      anonSummary.failed === 0 &&
      directViem.ok &&
      anonViem?.ok === true,
  };

  scope.__blocklabSelfTest = result;
  scope.__blocklabSelfTestStatus = "done";

  const output = document.querySelector<HTMLPreElement>("#selftest-output");
  if (output !== null) {
    output.hidden = false;
    output.textContent = JSON.stringify(result, null, 2);
  }
  return result;
}
