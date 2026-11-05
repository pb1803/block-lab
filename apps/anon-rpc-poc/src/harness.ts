import { AnonRpcWorker } from "@anon-rpc/browser-harness";

export const SUPPORTED_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
] as const;

export type SupportedMethod = (typeof SUPPORTED_METHODS)[number];
export type ErrorCategory =
  | "harness"
  | "connection"
  | "http"
  | "json-rpc"
  | "invalid-response";

export interface RpcObservation {
  readonly method: SupportedMethod;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly errorCategory?: ErrorCategory;
  readonly harnessReady: boolean;
  readonly receivedThroughHarness: boolean;
  readonly result?: unknown;
}

export interface WorkerLike {
  readonly ready: Promise<void>;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly acceptLog?: (opts?: {
    readonly signal?: AbortSignal;
  }) => Promise<unknown>;
  readonly close: () => void;
}

export type WorkerFactory = (init: {
  readonly address: string;
  readonly preExisting: {
    readonly rpcProvider: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    };
  };
}) => WorkerLike;

export interface SessionOptions {
  readonly endpoint: string;
  readonly workerAddress: string;
  readonly bootstrapRpcUrl: string;
  readonly workerFactory?: WorkerFactory;
  readonly fetchImpl?: typeof fetch;
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: unknown;
}

const zeroAddress = "0x0000000000000000000000000000000000000000";

function classifyError(error: unknown): ErrorCategory {
  if (error instanceof TypeError) return "connection";
  return "harness";
}

function paramsFor(method: SupportedMethod): unknown[] {
  if (method === "eth_getBalance") return [zeroAddress, "latest"];
  if (method === "eth_call") return [{ to: zeroAddress, data: "0x" }, "latest"];
  return [];
}

export class AnonRpcSession {
  readonly #options: SessionOptions;
  readonly #fetchImpl: typeof fetch;
  #worker: WorkerLike | undefined;
  #ready = false;
  #logAbortController: AbortController | undefined;
  #logs: unknown[] = [];

  public constructor(options: SessionOptions) {
    this.#options = options;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  public get ready(): boolean {
    return this.#ready;
  }

  public async initialize(): Promise<void> {
    if (this.#worker !== undefined) {
      await this.#worker.ready;
      this.#ready = true;
      return;
    }
    const factory =
      this.#options.workerFactory ?? ((init) => new AnonRpcWorker(init));
    const worker = factory({
      address: this.#options.workerAddress,
      preExisting: {
        rpcProvider: {
          request: async ({ method, params }) => {
            const response = await this.#fetchImpl(
              this.#options.bootstrapRpcUrl,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
              },
            );
            if (!response.ok)
              throw new Error(`Bootstrap HTTP ${response.status}`);
            const body = (await response.json()) as JsonRpcResponse;
            if (body.error !== undefined)
              throw new Error("Bootstrap JSON-RPC error");
            return body.result;
          },
        },
      },
    });
    this.#worker = worker;
    try {
      await worker.ready;
      this.#ready = true;
      if (worker.acceptLog !== undefined) {
        const logAbortController = new AbortController();
        this.#logAbortController = logAbortController;
        void this.#collectLogs(worker, logAbortController.signal);
      }
    } catch (error) {
      worker.close();
      this.#worker = undefined;
      throw error;
    }
  }

  public get logs(): readonly unknown[] {
    return this.#logs;
  }

  async #collectLogs(worker: WorkerLike, signal: AbortSignal): Promise<void> {
    if (worker.acceptLog === undefined) return;
    while (!signal.aborted) {
      try {
        this.#logs.push(await worker.acceptLog({ signal }));
      } catch {
        return;
      }
    }
  }

  public async request(method: SupportedMethod): Promise<RpcObservation> {
    if (!SUPPORTED_METHODS.includes(method)) {
      throw new Error(`Unsupported read-only RPC method: ${method}`);
    }
    const requestedAt = new Date();
    const worker = this.#worker;
    if (worker === undefined || !this.#ready) {
      const completedAt = new Date();
      return {
        method,
        requestedAt: requestedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - requestedAt.getTime(),
        success: false,
        errorCategory: "harness",
        harnessReady: false,
        receivedThroughHarness: false,
      };
    }
    try {
      const response = await worker.fetch(this.#options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: paramsFor(method),
        }),
      });
      const completedAt = new Date();
      if (!response.ok) {
        return {
          method,
          requestedAt: requestedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - requestedAt.getTime(),
          success: false,
          errorCategory: "http",
          harnessReady: true,
          receivedThroughHarness: true,
        };
      }
      let body: JsonRpcResponse;
      try {
        body = (await response.json()) as JsonRpcResponse;
      } catch {
        return {
          method,
          requestedAt: requestedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - requestedAt.getTime(),
          success: false,
          errorCategory: "invalid-response",
          harnessReady: true,
          receivedThroughHarness: true,
        };
      }
      if (body.error !== undefined) {
        return {
          method,
          requestedAt: requestedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - requestedAt.getTime(),
          success: false,
          errorCategory: "json-rpc",
          harnessReady: true,
          receivedThroughHarness: true,
        };
      }
      return {
        method,
        requestedAt: requestedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - requestedAt.getTime(),
        success: true,
        harnessReady: true,
        receivedThroughHarness: true,
        result: body.result,
      };
    } catch (error) {
      const completedAt = new Date();
      return {
        method,
        requestedAt: requestedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - requestedAt.getTime(),
        success: false,
        errorCategory: classifyError(error),
        harnessReady: true,
        receivedThroughHarness: false,
      };
    }
  }

  public close(): void {
    this.#logAbortController?.abort();
    this.#logAbortController = undefined;
    this.#worker?.close();
    this.#worker = undefined;
    this.#ready = false;
  }
}
