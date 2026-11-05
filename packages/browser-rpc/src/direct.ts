import { callJsonRpc } from "./request.js";
import {
  assertReadOnlyMethod,
  BrowserRpcError,
  type ReadOnlyMethod,
  type RequestOptions,
  type RpcObservation,
  type RpcTransport,
  type TransportState,
} from "./types.js";

export interface DirectRpcOptions {
  readonly endpoint: string;
  readonly label?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function parseEndpoint(raw: string): string {
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

/**
 * Ordinary RPC over the ambient `fetch`. This is the control route: it is what
 * BLOCKLAB compares Anon-RPC against, and it is never used as a fallback for a
 * failed harness.
 */
export class DirectRpcTransport implements RpcTransport {
  readonly route = "direct" as const;
  readonly label: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  #state: TransportState = "idle";
  #initializationError: string | undefined;

  public constructor(options: DirectRpcOptions) {
    this.#endpoint = parseEndpoint(options.endpoint);
    this.label = options.label ?? "Direct RPC";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#state = "ready";
  }

  public get state(): TransportState {
    return this.#state;
  }

  public get initializationError(): string | undefined {
    return this.#initializationError;
  }

  public initialize(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      this.#state = "failed";
      this.#initializationError = "Initialization was cancelled.";
      return Promise.reject(
        new BrowserRpcError("aborted", this.#initializationError),
      );
    }
    if (this.#state === "closed") {
      this.#state = "failed";
      this.#initializationError = "Transport is closed.";
      return Promise.reject(
        new BrowserRpcError("initialization", this.#initializationError),
      );
    }
    this.#state = "ready";
    return Promise.resolve();
  }

  public async request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation> {
    const readOnlyMethod = assertReadOnlyMethod(method);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    if (this.#state !== "ready") {
      return {
        route: this.route,
        method: readOnlyMethod,
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        success: false,
        errorCategory: "not-ready",
        errorMessage: `Direct transport is ${this.#state}.`,
        harnessReady: false,
        receivedThroughHarness: false,
      };
    }

    const outcome = await callJsonRpc({
      fetchFn: this.#fetch,
      endpoint: this.#endpoint,
      method: readOnlyMethod,
      timeoutMs: this.#timeoutMs,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const endedAt = new Date().toISOString();

    return {
      route: this.route,
      method: readOnlyMethod,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - started),
      success: outcome.success,
      ...(outcome.errorCategory === undefined
        ? {}
        : { errorCategory: outcome.errorCategory }),
      ...(outcome.errorMessage === undefined
        ? {}
        : { errorMessage: outcome.errorMessage }),
      ...(outcome.value === undefined ? {} : { value: outcome.value }),
      harnessReady: false,
      receivedThroughHarness: false,
    };
  }

  public close(): void {
    this.#state = "closed";
  }
}
