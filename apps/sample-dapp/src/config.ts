import { findWorker, type WorkerDescriptor } from "@blocklab/browser-rpc";

export interface AppConfig {
  /** Destination for both routes; also the default bootstrap endpoint. */
  readonly endpoint: string;
  /** Endpoint used only to read the on-chain worker specifier. */
  readonly bootstrapRpcUrl: string;
  readonly worker: WorkerDescriptor;
  readonly workerId: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly error: string };

const DEFAULT_WORKER_ID = "passthrough";

export function readConfig(
  env: Record<string, string | undefined> = import.meta.env,
): ConfigResult {
  const endpoint = env.VITE_RPC_URL?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    return {
      ok: false,
      error:
        "VITE_RPC_URL is not set. Copy .env.example to .env.local and restart Vite.",
    };
  }

  const workerId = env.VITE_ANON_RPC_WORKER?.trim() || DEFAULT_WORKER_ID;
  const worker = findWorker(workerId);
  if (worker === undefined) {
    return {
      ok: false,
      error: `Unknown Anon-RPC worker "${workerId}". Use passthrough, tor-js, nym, or nox.`,
    };
  }

  const bootstrap = env.VITE_ANON_RPC_BOOTSTRAP_RPC_URL?.trim();
  return {
    ok: true,
    config: {
      endpoint,
      bootstrapRpcUrl:
        bootstrap === undefined || bootstrap.length === 0
          ? endpoint
          : bootstrap,
      worker,
      workerId,
    },
  };
}

/**
 * Neither route may be described as anonymizing unless the official adopter
 * list classifies the worker as a network worker.
 */
export function workerDescription(worker: WorkerDescriptor): string {
  return worker.kind === "network"
    ? `${worker.id} — anonymizing network worker (declared by the Anon-RPC adopter list)`
    : `${worker.id} — reference passthrough worker, NOT anonymizing`;
}
