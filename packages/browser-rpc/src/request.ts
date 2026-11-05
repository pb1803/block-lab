import {
  BrowserRpcError,
  paramsForMethod,
  previewValue,
  type ReadOnlyMethod,
  type RpcErrorCategory,
  redactMessage,
} from "./types.js";

export interface JsonRpcCallOptions {
  readonly fetchFn: typeof fetch;
  readonly endpoint: string;
  readonly method: ReadOnlyMethod;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface JsonRpcOutcome {
  readonly success: boolean;
  readonly errorCategory?: RpcErrorCategory;
  readonly errorMessage?: string;
  readonly value?: string;
}

interface JsonRpcBody {
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

const DEFAULT_REQUEST_ID = 1;

function failure(
  errorCategory: RpcErrorCategory,
  errorMessage: string,
): JsonRpcOutcome {
  return {
    success: false,
    errorCategory,
    errorMessage: redactMessage(errorMessage),
  };
}

function classifyThrown(
  error: unknown,
  timedOut: boolean,
  cancelled: boolean,
): JsonRpcOutcome {
  if (cancelled) return failure("aborted", "Request was cancelled.");
  if (timedOut) return failure("timeout", "RPC request exceeded its timeout.");
  if (error instanceof BrowserRpcError) {
    return failure(error.category, error.message);
  }
  if (error instanceof TypeError) {
    return failure("connection", "Could not reach the RPC endpoint.");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return failure("aborted", "Request was cancelled.");
  }
  return failure(
    "connection",
    error instanceof Error ? error.message : "RPC request failed.",
  );
}

function readJsonRpcError(body: JsonRpcBody): string {
  const message =
    typeof body.error?.message === "string" ? body.error.message : undefined;
  const code =
    typeof body.error?.code === "number" ? String(body.error.code) : undefined;
  if (message !== undefined && code !== undefined) {
    return `JSON-RPC error ${code}: ${message}`;
  }
  return message ?? "RPC endpoint returned a JSON-RPC error.";
}

/**
 * One bounded JSON-RPC POST shared by the direct and harness routes, so both
 * routes classify transport, HTTP, JSON, and JSON-RPC failures identically.
 */
export async function callJsonRpc(
  options: JsonRpcCallOptions,
): Promise<JsonRpcOutcome> {
  if (options.signal?.aborted === true) {
    return failure("aborted", "Request was cancelled.");
  }

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = (): void => {
    cancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await options.fetchFn(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: DEFAULT_REQUEST_ID,
        method: options.method,
        params: paramsForMethod(options.method),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return failure("http", `RPC endpoint returned HTTP ${response.status}.`);
    }

    let body: JsonRpcBody;
    try {
      body = (await response.json()) as JsonRpcBody;
    } catch {
      return failure("json", "RPC endpoint returned invalid JSON.");
    }

    if (body.error !== undefined && body.error !== null) {
      return failure("json-rpc", readJsonRpcError(body));
    }

    const value = previewValue(body.result);
    return value === undefined ? { success: true } : { success: true, value };
  } catch (error) {
    return classifyThrown(error, timedOut, cancelled);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
