export type RpcErrorCategory =
  | "connection"
  | "timeout"
  | "http"
  | "json"
  | "json-rpc"
  | "invalid-chain-id";

export interface RpcProbeOptions {
  readonly rpcUrl: string;
  readonly method: "eth_chainId" | "eth_blockNumber";
  readonly timeoutMs?: number;
  readonly expectedChainId?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface RpcProbeResult {
  readonly method: RpcProbeOptions["method"];
  readonly rpcUrl: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly category?: RpcErrorCategory;
  readonly chainId?: number;
  readonly blockNumber?: number;
  readonly errorMessage?: string;
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;

function safeRpcReference(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).origin;
  } catch {
    return "[invalid endpoint]";
  }
}

function errorResult(
  options: RpcProbeOptions,
  startedAt: string,
  endedAt: string,
  category: RpcErrorCategory,
  message: string,
): RpcProbeResult {
  return {
    method: options.method,
    rpcUrl: safeRpcReference(options.rpcUrl),
    startedAt,
    endedAt,
    latencyMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    success: false,
    category,
    errorMessage: message,
  };
}

function parseQuantity(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`${label} was not a hexadecimal quantity.`);
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} was outside the safe integer range.`);
  }
  return parsed;
}

export async function probeRpc(
  options: RpcProbeOptions,
): Promise<RpcProbeResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: options.method,
        params: [],
      }),
      signal: controller.signal,
    });
    const endedAt = new Date().toISOString();
    if (!response.ok) {
      return errorResult(
        options,
        startedAt,
        endedAt,
        "http",
        `RPC endpoint returned HTTP ${response.status}.`,
      );
    }

    let payload: JsonRpcResponse;
    try {
      payload = (await response.json()) as JsonRpcResponse;
    } catch {
      return errorResult(
        options,
        startedAt,
        endedAt,
        "json",
        "RPC endpoint returned invalid JSON.",
      );
    }
    if (payload.error) {
      return errorResult(
        options,
        startedAt,
        endedAt,
        "json-rpc",
        payload.error.message
          ? `JSON-RPC error ${payload.error.code ?? "unknown"}: ${payload.error.message}`
          : "RPC endpoint returned a JSON-RPC error.",
      );
    }

    try {
      const value = parseQuantity(
        payload.result,
        options.method === "eth_chainId" ? "Chain ID" : "Block number",
      );
      if (
        options.method === "eth_chainId" &&
        options.expectedChainId !== undefined &&
        value !== options.expectedChainId
      ) {
        return errorResult(
          options,
          startedAt,
          endedAt,
          "invalid-chain-id",
          `Expected chain ID ${options.expectedChainId}, received ${value}.`,
        );
      }
      return {
        method: options.method,
        rpcUrl: safeRpcReference(options.rpcUrl),
        startedAt,
        endedAt,
        latencyMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        success: true,
        ...(options.method === "eth_chainId"
          ? { chainId: value }
          : { blockNumber: value }),
      };
    } catch (error) {
      return errorResult(
        options,
        startedAt,
        endedAt,
        options.method === "eth_chainId" ? "invalid-chain-id" : "json",
        error instanceof Error ? error.message : "RPC quantity was invalid.",
      );
    }
  } catch (error) {
    const endedAt = new Date().toISOString();
    const category =
      error instanceof DOMException && error.name === "AbortError"
        ? "timeout"
        : "connection";
    return errorResult(
      options,
      startedAt,
      endedAt,
      category,
      category === "timeout"
        ? `RPC request exceeded the ${timeoutMs}ms timeout.`
        : "Could not connect to the RPC endpoint.",
    );
  } finally {
    clearTimeout(timer);
  }
}
