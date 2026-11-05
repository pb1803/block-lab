import { callJsonRpc } from "./request.js";
import {
  assertReadOnlyMethod,
  BrowserRpcError,
  paramsForMethod,
  type ReadOnlyMethod,
  type RequestOptions,
  type RpcObservation,
  type RpcTransport,
  redactMessage,
  type TransportState,
  validateRequestParams,
  type WorkerDescriptor,
  type WorkerKind,
} from "./types.js";

export interface WorkerInstance {
  readonly ready: Promise<void>;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly acceptLog?: (opts?: { signal?: AbortSignal }) => Promise<unknown>;
  close(): void;
}

interface BootstrapProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface WorkerInitLike {
  readonly address: string;
  readonly config?: unknown;
  readonly preExisting?: { readonly rpcProvider?: BootstrapProvider };
}

export type WorkerFactory = (init: WorkerInitLike) => WorkerInstance;

export interface AnonRpcOptions {
  /** Endpoint the worker fetches. It is not used for any direct request. */
  readonly endpoint: string;
  /** Worker descriptor from OFFICIAL_WORKERS. */
  readonly worker: WorkerDescriptor;
  /** Endpoint used only to read the on-chain worker specifier. */
  readonly bootstrapRpcUrl: string;
  readonly config?: unknown;
  readonly initializationTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  /** Test seam; production uses the real browser harness. */
  readonly workerFactory?: WorkerFactory;
}

const DEFAULT_INIT_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_LOG_ENTRIES = 50;

let cachedWorkerConstructor:
  | Promise<new (init: WorkerInitLike) => WorkerInstance>
  | undefined;

/**
 * The harness is browser-only, so it is imported lazily: Node.js test runs and
 * the CLI never load it, and a bundler still sees a static specifier.
 */
async function loadHarness(): Promise<
  new (
    init: WorkerInitLike,
  ) => WorkerInstance
> {
  if (cachedWorkerConstructor === undefined) {
    cachedWorkerConstructor = import("@anon-rpc/browser-harness").then(
      (module) =>
        module.AnonRpcWorker as new (
          init: WorkerInitLike,
        ) => WorkerInstance,
    );
  }
  return cachedWorkerConstructor;
}

function validateSpecifier(specifier: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(specifier)) {
    throw new BrowserRpcError(
      "initialization",
      "Worker specifier is not a 20-byte address.",
    );
  }
}

function validateEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrowserRpcError(
      "initialization",
      "RPC endpoint is not a valid URL.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserRpcError(
      "initialization",
      "RPC endpoint must use http or https.",
    );
  }
  return url.toString();
}

function workerLabel(kind: WorkerKind): string {
  return kind === "network"
    ? "Anon-RPC network worker"
    : "Anon-RPC reference worker";
}

/**
 * Read-only route through `@anon-rpc/browser-harness`.
 *
 * There is no fallback: if the worker is not ready, or the harness fails, the
 * request is reported as failed. A failed harness never becomes an ordinary
 * RPC call, and the bootstrap provider is used only to read the specifier.
 */
export class AnonRpcTransport implements RpcTransport {
  readonly route = "anon-rpc" as const;
  readonly label: string;
  readonly #endpoint: string;
  readonly #bootstrapRpcUrl: string;
  readonly #workerDescriptor: WorkerDescriptor;
  readonly #config: unknown;
  readonly #initTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #workerFactory: WorkerFactory | undefined;

  #state: TransportState = "idle";
  #worker: WorkerInstance | undefined;
  #initPromise: Promise<void> | undefined;
  #initializationError: string | undefined;
  #logAbortController: AbortController | undefined;
  #logCount = 0;

  public constructor(options: AnonRpcOptions) {
    validateSpecifier(options.worker.specifier);
    this.#endpoint = validateEndpoint(options.endpoint);
    this.#bootstrapRpcUrl = validateEndpoint(options.bootstrapRpcUrl);
    this.#workerDescriptor = options.worker;
    this.#config = options.config;
    this.#initTimeoutMs =
      options.initializationTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#workerFactory = options.workerFactory;
    this.label = workerLabel(options.worker.kind);
  }

  public get state(): TransportState {
    return this.#state;
  }

  public get timeoutMs(): number {
    return this.#requestTimeoutMs;
  }

  public get initializationError(): string | undefined {
    return this.#initializationError;
  }

  public get workerId(): string {
    return this.#workerDescriptor.id;
  }

  public get workerKind(): WorkerKind {
    return this.#workerDescriptor.kind;
  }

  /** Counts only: worker log payloads are never persisted or displayed. */
  public get logCount(): number {
    return this.#logCount;
  }

  public initialize(signal?: AbortSignal): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    if (this.#state === "closed") {
      // Closed is terminal: a closed route must never resurrect a worker.
      return Promise.reject(
        new BrowserRpcError(
          "not-ready",
          "Anon-RPC transport is closed; create a new transport to restart routing.",
        ),
      );
    }
    if (this.#state === "initializing" && this.#initPromise !== undefined) {
      return this.#initPromise;
    }
    if (signal?.aborted === true) {
      return Promise.reject(
        new BrowserRpcError("aborted", "Initialization was cancelled."),
      );
    }

    // A retry after failure starts from a clean worker; close() also clears it.
    this.#disposeWorker();
    this.#state = "initializing";
    this.#initializationError = undefined;

    const attempt = this.#startWorker(signal).then(
      () => {
        if (this.#state !== "initializing") return;
        this.#state = "ready";
        this.#initPromise = undefined;
      },
      (error: unknown) => {
        // close() during initialization must keep the transport closed rather
        // than resurrect it as failed.
        if (this.#state === "initializing") {
          this.#disposeWorker();
          this.#state = "failed";
          this.#initializationError = redactMessage(
            error instanceof Error
              ? error.message
              : "Worker initialization failed.",
          );
        }
        this.#initPromise = undefined;
        const category =
          error instanceof BrowserRpcError ? error.category : "initialization";
        throw new BrowserRpcError(
          category,
          this.#initializationError ?? "Worker initialization failed.",
        );
      },
    );
    this.#initPromise = attempt;
    return attempt;
  }

  async #startWorker(signal: AbortSignal | undefined): Promise<void> {
    const factory = this.#workerFactory ?? (await this.#defaultWorkerFactory());
    const worker = factory({
      address: this.#workerDescriptor.specifier,
      ...(this.#config === undefined ? {} : { config: this.#config }),
      preExisting: {
        rpcProvider: {
          request: async ({ method, params }) => {
            // Only specifier reads. This call is not harness-routed and is not
            // part of the measured workload.
            const response = await this.#fetch(this.#bootstrapRpcUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method,
                params,
              }),
              ...(signal === undefined ? {} : { signal }),
            });
            if (!response.ok) {
              throw new BrowserRpcError(
                "initialization",
                `Bootstrap RPC returned HTTP ${response.status}.`,
              );
            }
            const body = (await response.json()) as {
              result?: unknown;
              error?: { message?: unknown };
            };
            if (body.error !== undefined && body.error !== null) {
              const detail =
                typeof body.error.message === "string"
                  ? body.error.message
                  : "Bootstrap RPC returned a JSON-RPC error.";
              throw new BrowserRpcError("initialization", detail);
            }
            return body.result;
          },
        },
      },
    });
    this.#worker = worker;

    try {
      await this.#withTimeout(
        worker.ready,
        this.#initTimeoutMs,
        signal,
        `Worker did not become ready within ${this.#initTimeoutMs}ms.`,
      );
    } catch (error) {
      // A failed boot must not leave a sandbox running.
      worker.close();
      this.#worker = undefined;
      throw error;
    }

    if (worker.acceptLog !== undefined) {
      const controller = new AbortController();
      this.#logAbortController = controller;
      void this.#collectLogs(worker, controller.signal);
    }
  }

  async #defaultWorkerFactory(): Promise<WorkerFactory> {
    const WorkerConstructor = await loadHarness();
    return (init) => new WorkerConstructor(init);
  }

  async #collectLogs(
    worker: WorkerInstance,
    signal: AbortSignal,
  ): Promise<void> {
    if (worker.acceptLog === undefined) return;
    while (!signal.aborted) {
      try {
        await worker.acceptLog({ signal });
        this.#logCount = Math.min(this.#logCount + 1, MAX_LOG_ENTRIES);
      } catch {
        return;
      }
    }
  }

  #withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new BrowserRpcError("timeout", message))),
        timeoutMs,
      );
      const onAbort = (): void =>
        finish(() =>
          reject(
            new BrowserRpcError("aborted", "Initialization was cancelled."),
          ),
        );
      signal?.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  public async request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation> {
    const readOnlyMethod = assertReadOnlyMethod(method);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const worker = this.#worker;

    if (this.#state !== "ready" || worker === undefined) {
      const message =
        this.#initializationError ??
        `Anon-RPC transport is ${this.#state}; no direct fallback is performed.`;
      return {
        route: this.route,
        workerId: this.#workerDescriptor.id,
        workerKind: this.#workerDescriptor.kind,
        method: readOnlyMethod,
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        success: false,
        errorCategory: "not-ready",
        errorMessage: redactMessage(message),
        harnessReady: false,
        receivedThroughHarness: false,
      };
    }

    let params: readonly unknown[];
    try {
      params =
        options?.params === undefined
          ? paramsForMethod(readOnlyMethod)
          : validateRequestParams(readOnlyMethod, options.params);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid request parameters.";
      return {
        route: this.route,
        workerId: this.#workerDescriptor.id,
        workerKind: this.#workerDescriptor.kind,
        method: readOnlyMethod,
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        success: false,
        errorCategory: "invalid-params",
        errorMessage: redactMessage(message),
        harnessReady: false,
        receivedThroughHarness: false,
      };
    }

    const outcome = await callJsonRpc({
      fetchFn: worker.fetch as typeof fetch,
      endpoint: this.#endpoint,
      method: readOnlyMethod,
      params,
      timeoutMs: this.#requestTimeoutMs,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const endedAt = new Date().toISOString();
    // A thrown `TypeError` through `worker.fetch` is a harness/worker failure,
    // not a direct connection failure: nothing was attempted outside the worker.
    const errorCategory =
      outcome.errorCategory === "connection" ? "worker" : outcome.errorCategory;
    const receivedThroughHarness =
      outcome.success ||
      outcome.errorCategory === "http" ||
      outcome.errorCategory === "json" ||
      outcome.errorCategory === "json-rpc";

    return {
      route: this.route,
      workerId: this.#workerDescriptor.id,
      workerKind: this.#workerDescriptor.kind,
      method: readOnlyMethod,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - started),
      success: outcome.success,
      ...(errorCategory === undefined ? {} : { errorCategory }),
      ...(outcome.errorMessage === undefined
        ? {}
        : { errorMessage: outcome.errorMessage }),
      ...(outcome.value === undefined ? {} : { value: outcome.value }),
      harnessReady: true,
      receivedThroughHarness,
    };
  }

  public close(): void {
    this.#disposeWorker();
    this.#state = "closed";
    this.#initPromise = undefined;
  }

  public async requestResult(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<unknown> {
    const readOnlyMethod = assertReadOnlyMethod(method);
    const worker = this.#worker;
    if (this.#state !== "ready" || worker === undefined) {
      throw new BrowserRpcError(
        "not-ready",
        this.#initializationError ??
          `Anon-RPC transport is ${this.#state}; no direct fallback is performed.`,
      );
    }
    const params =
      options?.params === undefined
        ? paramsForMethod(readOnlyMethod)
        : validateRequestParams(readOnlyMethod, options.params);
    const outcome = await callJsonRpc({
      fetchFn: worker.fetch as typeof fetch,
      endpoint: this.#endpoint,
      method: readOnlyMethod,
      params,
      timeoutMs: this.#requestTimeoutMs,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!outcome.success) {
      // A thrown `TypeError` through `worker.fetch` is a worker failure; nothing
      // was attempted outside the sandbox, and no direct fallback occurs.
      throw new BrowserRpcError(
        outcome.errorCategory === "connection"
          ? "worker"
          : (outcome.errorCategory ?? "worker"),
        outcome.errorMessage ?? "Anon-RPC request failed.",
      );
    }
    if (outcome.rawResult === undefined) {
      throw new BrowserRpcError(
        "json",
        "Anon-RPC worker returned no JSON-RPC result.",
      );
    }
    return outcome.rawResult;
  }

  #disposeWorker(): void {
    this.#logAbortController?.abort();
    this.#logAbortController = undefined;
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker !== undefined) {
      try {
        worker.close();
      } catch {
        // Closing a dead sandbox is already the desired end state.
      }
    }
  }
}
