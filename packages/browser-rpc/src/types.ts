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
}

export interface RpcTransport {
  readonly route: RouteKind;
  readonly label: string;
  readonly state: TransportState;
  initialize(signal?: AbortSignal): Promise<void>;
  request(
    method: ReadOnlyMethod,
    options?: RequestOptions,
  ): Promise<RpcObservation>;
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
