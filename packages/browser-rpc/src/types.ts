/**
 * Platform-neutral contracts for the browser-only RPC routes.
 *
 * This package must never be imported by the Node.js CLI, runner, or core
 * packages: it owns the browser-only `@anon-rpc/browser-harness` dependency.
 * Only the four read-only Ethereum methods below may be routed, and no wallet,
 * signing, or transaction method can pass through a transport.
 */

export const READ_ONLY_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
] as const;

export type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number];

/**
 * Wallet-control and transaction methods are deliberately unsupported. These
 * prefixes exist so errors can say "excluded" rather than "unknown".
 */
export const EXCLUDED_METHOD_PREFIXES = [
  "eth_send",
  "eth_sign",
  "eth_accounts",
  "personal_",
  "wallet_",
] as const;

export type RouteKind = "direct" | "anon-rpc";

/**
 * Official Anon-RPC adopter classification: `reference` workers demonstrate
 * the sandbox and hash pinning only, `network` workers route over an
 * anonymizing network.
 */
export type WorkerKind = "reference" | "network";

export type TransportState =
  | "idle"
  | "initializing"
  | "ready"
  | "failed"
  | "closed";

export type RpcErrorCategory =
  | "unsupported-method"
  | "invalid-params"
  | "not-ready"
  | "initialization"
  | "worker"
  | "connection"
  | "timeout"
  | "aborted"
  | "http"
  | "json"
  | "json-rpc";

export class BrowserRpcError extends Error {
  readonly category: RpcErrorCategory;

  public constructor(category: RpcErrorCategory, message: string) {
    super(message);
    this.name = "BrowserRpcError";
    this.category = category;
  }
}

export interface WorkerDescriptor {
  readonly id: string;
  readonly specifier: string;
  readonly kind: WorkerKind;
  /** Chain the specifier contract lives on; not the chain the fetch reaches. */
  readonly chainId: number;
  /** Worker-defined, opaque config (for example a demonstration gateway). */
  readonly exampleConfig?: unknown;
}

/**
 * Transcribed from the official adopter list:
 * https://github.com/ethereum/anon-rpc/blob/main/adopters.json5
 *
 * Addresses are copied verbatim from that file. `passthrough` is a reference
 * worker: it performs an ordinary `fetch` inside the sandbox and does not
 * anonymize anything.
 */
export const OFFICIAL_WORKERS: readonly WorkerDescriptor[] = [
  {
    id: "passthrough",
    specifier: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27",
    kind: "reference",
    chainId: 1,
  },
  {
    id: "tor-js",
    specifier: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    kind: "network",
    chainId: 1,
    exampleConfig: {
      // Demonstration gateway published in adopters.json5; it may disappear.
      gateways: [
        "152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ",
      ],
    },
  },
  {
    id: "nym",
    specifier: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0",
    kind: "network",
    chainId: 1,
  },
  {
    id: "nox",
    specifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
    kind: "network",
    chainId: 11155111,
  },
];

export function findWorker(id: string): WorkerDescriptor | undefined {
  return OFFICIAL_WORKERS.find((worker) => worker.id === id);
}

export function isReadOnlyMethod(value: string): value is ReadOnlyMethod {
  return (READ_ONLY_METHODS as readonly string[]).includes(value);
}

export function isExcludedMethod(value: string): boolean {
  return EXCLUDED_METHOD_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function assertReadOnlyMethod(value: string): ReadOnlyMethod {
  if (isReadOnlyMethod(value)) return value;
  if (isExcludedMethod(value)) {
    throw new BrowserRpcError(
      "unsupported-method",
      `${value} is a wallet or transaction method and is never routed by BLOCKLAB.`,
    );
  }
  throw new BrowserRpcError(
    "unsupported-method",
    `${value} is not in the BLOCKLAB read-only method allowlist.`,
  );
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Only public, non-sensitive parameters are used. There is deliberately no API
 * for caller-supplied params, so wallet identifiers cannot leak into evidence.
 */
export function paramsForMethod(method: ReadOnlyMethod): readonly unknown[] {
  if (method === "eth_getBalance") return [ZERO_ADDRESS, "latest"];
  if (method === "eth_call")
    return [{ to: ZERO_ADDRESS, data: "0x" }, "latest"];
  return [];
}

const BLOCK_TAGS = new Set([
  "latest",
  "earliest",
  "pending",
  "safe",
  "finalized",
]);
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,16}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * `eth_call` transaction objects are restricted to fields that describe a
 * simulation. No field can sign, and state overrides are refused outright.
 */
const CALL_FIELDS = new Set([
  "to",
  "from",
  "data",
  "value",
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "type",
  "chainId",
  "accessList",
]);

function invalidParams(method: ReadOnlyMethod, detail: string): never {
  throw new BrowserRpcError(
    "invalid-params",
    `${method} rejected invalid parameters: ${detail}`,
  );
}

function normalizeBlockTag(method: ReadOnlyMethod, value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "bigint" && value >= 0n) {
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "string") {
    if (BLOCK_TAGS.has(value) || HEX_QUANTITY.test(value)) return value;
  }
  return invalidParams(method, "block tag is not a supported tag or quantity");
}

function validateCallObject(
  method: ReadOnlyMethod,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidParams(method, "call object must be a plain object");
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!CALL_FIELDS.has(key)) {
      return invalidParams(method, `unsupported call field "${key}"`);
    }
  }
  if (source.to !== undefined && typeof source.to !== "string") {
    return invalidParams(method, "call `to` must be a string");
  }
  if (source.data !== undefined && typeof source.data !== "string") {
    return invalidParams(method, "call `data` must be a string");
  }
  return source;
}

/**
 * Caller-supplied parameters are only accepted in the exact read-only shapes
 * below. The same validated array is what reaches the network, so an adapter
 * cannot smuggle wallet or signing calls past the allowlist.
 */
export function validateRequestParams(
  method: ReadOnlyMethod,
  params?: readonly unknown[],
): readonly unknown[] {
  const values = params ?? [];
  if (!Array.isArray(values)) {
    return invalidParams(method, "params must be an array");
  }

  if (method === "eth_chainId" || method === "eth_blockNumber") {
    if (values.length !== 0) {
      return invalidParams(method, "this method takes no parameters");
    }
    return [];
  }

  if (method === "eth_getBalance") {
    if (values.length < 1 || values.length > 2) {
      return invalidParams(method, "expected [address, blockTag?]");
    }
    const [address, blockTag] = values;
    if (typeof address !== "string" || !HEX_ADDRESS.test(address)) {
      return invalidParams(method, "address must be a 20-byte hex string");
    }
    return [
      address,
      blockTag === undefined ? "latest" : normalizeBlockTag(method, blockTag),
    ];
  }

  // eth_call
  if (values.length < 1 || values.length > 2) {
    return invalidParams(
      method,
      "expected [callObject, blockTag?]; state overrides are not supported",
    );
  }
  const [call, blockTag] = values;
  return [
    validateCallObject(method, call),
    blockTag === undefined ? "latest" : normalizeBlockTag(method, blockTag),
  ];
}

export interface RpcObservation {
  readonly route: RouteKind;
  readonly workerId?: string;
  readonly workerKind?: WorkerKind;
  readonly method: ReadOnlyMethod;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly errorCategory?: RpcErrorCategory;
  readonly errorMessage?: string;
  /** True only when a verified harness worker had reached readiness. */
  readonly harnessReady: boolean;
  /** True only when the request was actually answered through the harness. */
  readonly receivedThroughHarness: boolean;
  /** Truncated, non-sensitive result preview (quantity or JSON snippet). */
  readonly value?: string;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  /**
   * Method parameters supplied by a caller (for example Viem). They are
   * validated against a strict read-only shape and are never retained in
   * observations or evidence.
   */
  readonly params?: readonly unknown[];
}

export interface RpcTransport {
  readonly route: RouteKind;
  readonly label: string;
  readonly state: TransportState;
  /** Enforced request timeout, so adapters can align their own ceiling. */
  readonly timeoutMs: number;
  initialize(signal?: AbortSignal): Promise<void>;
  request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation>;
  /**
   * Raw JSON-RPC result for adapters (Viem, EIP-1193) that need the actual
   * value. Throws a typed `BrowserRpcError`; never falls back to another route.
   */
  requestResult(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<unknown>;
  close(): void;
}

/** A transport can be summarized without knowing whether it used a harness. */
export interface TransportSummary {
  readonly route: RouteKind;
  readonly label: string;
  readonly workerId?: string;
  readonly workerKind?: WorkerKind;
  readonly state: TransportState;
  readonly initialized: boolean;
  readonly initializationError?: string;
}

const MAX_MESSAGE_LENGTH = 200;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Error messages can originate from an upstream or from the worker. Reduce any
 * embedded URL to its origin and drop query strings so credentials, API keys,
 * and tokens cannot reach the UI or evidence.
 */
export function redactMessage(message: string): string {
  const redacted = message.replace(URL_PATTERN, (candidate) => {
    try {
      return new URL(candidate).origin;
    } catch {
      return "[redacted-url]";
    }
  });
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

/** Result previews are truncated and never include request parameters. */
export function previewValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
