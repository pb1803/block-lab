/**
 * Viem transport adapter for the BLOCKLAB browser routes.
 *
 * This module is a separate entry point (`@blocklab/browser-rpc/viem`) so the
 * main package stays usable without Viem. It contains no RPC execution logic:
 * every request is delegated to a caller-owned `RpcTransport`, which keeps the
 * read-only allowlist, no-fallback guarantee, and error classification.
 */
import {
  BaseError,
  createTransport,
  type EIP1193RequestFn,
  type Transport,
  type TransportConfig,
} from "viem";
import type { AnonRpcOptions } from "./anon.js";
import { AnonRpcTransport } from "./anon.js";
import { type DirectRpcOptions, DirectRpcTransport } from "./direct.js";
import {
  assertReadOnlyMethod,
  BrowserRpcError,
  type ReadOnlyMethod,
  type RequestOptions,
  type RpcErrorCategory,
  type RpcObservation,
  type RpcTransport,
  type TransportState,
} from "./types.js";

export interface ViemAdapterOptions {
  /** Transport key exposed on `client.transport.config.key`. */
  readonly key?: string;
  /** Transport name exposed on `client.transport.config.name`. */
  readonly name?: string;
  /**
   * Viem-level retries. Defaults to `0`: BLOCKLAB surfaces one failure instead
   * of silently repeating requests. Retrying never changes the route.
   */
  readonly retryCount?: number;
  readonly retryDelay?: number;
  /**
   * Viem-level request timeout. Defaults to the transport's own timeout plus
   * five seconds, so BLOCKLAB's classification (which also covers the harness)
   * wins the race and is not replaced by a generic Viem timeout.
   */
  readonly timeoutMs?: number;
}

/**
 * A route owns one transport instance and exposes it in three shapes:
 * a Viem transport for `createPublicClient`, the underlying transport for
 * observations/comparison, and explicit `initialize`/`close` calls.
 */
export interface BlocklabViemRoute {
  /** Pass to `createPublicClient({ transport: route.transport })`. */
  readonly transport: Transport;
  /** The underlying transport, for observation-level measurements. */
  readonly instance: RpcTransport;
  readonly route: RpcTransport["route"];
  readonly state: TransportState;
  initialize(signal?: AbortSignal): Promise<void>;
  request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation>;
  /** Closes the owned worker. No-op for the direct route beyond state. */
  close(): void;
}

const DEFAULT_TIMEOUT_BUFFER_MS = 5_000;

/**
 * Viem re-throws its own `BaseError` subclasses unchanged but wraps any other
 * thrown value in `UnknownRpcError`. Deriving from `BaseError` keeps the
 * BLOCKLAB classification (`category`) and the original error (`cause`)
 * visible to callers instead of burying them inside an opaque wrapper.
 */
export class BlocklabRpcError extends BaseError {
  readonly category: RpcErrorCategory;

  public constructor(error: BrowserRpcError) {
    super(error.message, {
      name: "BlocklabRpcError",
      cause: error,
      docsPath: undefined,
      metaMessages: [
        `Route: ${error.category === "not-ready" ? "no request sent" : "read-only allowlist"}`,
      ],
    });
    this.category = error.category;
  }
}

function toViemError(error: unknown): unknown {
  if (error instanceof BlocklabRpcError) return error;
  if (error instanceof BrowserRpcError) return new BlocklabRpcError(error);
  return error;
}

function buildViemTransport(
  instance: RpcTransport,
  options: ViemAdapterOptions,
): Transport {
  // Viem's EIP-1193 request function is generic over the caller's expected
  // result type; the value is the JSON-RPC `result` that the transport already
  // returns. The assertion is confined to this boundary.
  const request = (async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown;
  }): Promise<unknown> => {
    try {
      const readOnlyMethod = assertReadOnlyMethod(method);
      // Initialization is lazy and memoized by the transport itself, so several
      // Viem clients can share one route without creating extra workers.
      if (instance.state !== "ready") {
        await instance.initialize();
      }
      return await instance.requestResult(
        readOnlyMethod,
        params === undefined ? {} : { params: params as readonly unknown[] },
      );
    } catch (error) {
      throw toViemError(error);
    }
  }) as EIP1193RequestFn;

  const config: TransportConfig<"blocklab"> = {
    key: options.key ?? `blocklab-${instance.route}`,
    name: options.name ?? instance.label,
    type: "blocklab",
    retryCount: options.retryCount ?? 0,
    timeout:
      options.timeoutMs ?? instance.timeoutMs + DEFAULT_TIMEOUT_BUFFER_MS,
    request,
    ...(options.retryDelay === undefined
      ? {}
      : { retryDelay: options.retryDelay }),
  };

  return ({ chain }) =>
    createTransport(config, {
      chainId: chain?.id,
    });
}

class Route implements BlocklabViemRoute {
  readonly transport: Transport;
  readonly instance: RpcTransport;

  public constructor(instance: RpcTransport, options: ViemAdapterOptions) {
    this.instance = instance;
    this.transport = buildViemTransport(instance, options);
  }

  public get route(): RpcTransport["route"] {
    return this.instance.route;
  }

  public get state(): TransportState {
    return this.instance.state;
  }

  public initialize(signal?: AbortSignal): Promise<void> {
    return this.instance.initialize(signal);
  }

  public request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation> {
    return this.instance.request(method, options);
  }

  public close(): void {
    this.instance.close();
  }
}

/**
 * Wraps an existing transport as a Viem transport. The caller keeps ownership:
 * closing the returned route closes the instance it was given.
 */
export function createViemRoute(
  instance: RpcTransport,
  options: ViemAdapterOptions = {},
): BlocklabViemRoute {
  return new Route(instance, options);
}

/** Direct (control) route over ordinary `fetch`, for `createPublicClient`. */
export function createDirectViemRoute(
  options: DirectRpcOptions,
  adapter: ViemAdapterOptions = {},
): BlocklabViemRoute {
  return createViemRoute(new DirectRpcTransport(options), adapter);
}

/**
 * Anon-RPC route for `createPublicClient`. The worker is created on the first
 * request (or on an explicit `initialize()`), and `close()` is the only way to
 * dispose it: Viem clients have no disposal hook, so ownership stays explicit.
 */
export function createAnonViemRoute(
  options: AnonRpcOptions,
  adapter: ViemAdapterOptions = {},
): BlocklabViemRoute {
  return createViemRoute(new AnonRpcTransport(options), adapter);
}

/** True for both the Viem-facing and the underlying BLOCKLAB errors. */
export function isBlocklabRpcError(
  error: unknown,
): error is BlocklabRpcError | BrowserRpcError {
  return error instanceof BlocklabRpcError || error instanceof BrowserRpcError;
}
