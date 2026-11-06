/**
 * Shared types for the Studio Arkiv history feature.
 *
 * Every state is a plain value, so the reducer and the view model stay
 * testable without a DOM or a network. The metadata record itself is the
 * `ExperimentMetadata` allowlist from `@blocklab/arkiv-metadata`; nothing else
 * is ever written to the chain.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";

/** Wallet attach/detach and network state. */
export type WalletStatus =
  | "missing" // no window.ethereum
  | "disconnected"
  | "connected" // connected and on Rabdi
  | "wrong-network"; // connected but not on Rabdi

export type ErrorCategory =
  | "user-rejected"
  | "wrong-network"
  | "network"
  | "sdk"
  | "malformed-response"
  | "validation"
  | "expired"
  | "duplicate"
  | "missing"
  | "unknown";

export type StudioError = {
  readonly category: ErrorCategory;
  readonly message: string;
};

export type WalletState = {
  readonly status: WalletStatus;
  readonly address: Address | undefined;
  readonly chainIdHex: Hex | undefined;
};

/** Publish lifecycle for one selected local record. */
export type PublishPhase =
  | "idle" // record loaded, nothing sent
  | "preflight" // duplicate check in flight
  | "awaiting-signature" // wallet prompt requested
  | "confirming" // signed, waiting for the mined receipt
  | "confirmed" // receipt-backed entity key
  | "existing" // an entity with this experimentId already exists
  | "failed";

export type PublishState = {
  readonly phase: PublishPhase;
  readonly metadata: ExperimentMetadata | undefined;
  readonly txHash: Hex | undefined;
  readonly entityKey: Hex | undefined;
  readonly expiresAtBlock: bigint | undefined;
  readonly error: StudioError | undefined;
  /** Result of the post-confirmation read-back comparison, when run. */
  readonly readBack: ReadBackResult | undefined;
};

export type ReadBackOutcome = "verified" | "mismatch" | "unavailable";

export type ReadBackResult = {
  readonly outcome: ReadBackOutcome;
  readonly detail: string;
};

/** A row returned by an indexed history query (the discovery subset). */
export type RecordSummary = {
  readonly entityKey: Hex;
  readonly experimentId: string;
  readonly scenarioName: string;
  readonly status: string;
  readonly startedAtMs: number;
};

export type HistoryPhase = "idle" | "searching" | "ok" | "empty" | "failed";

export type HistoryQuery = {
  readonly field: string;
  readonly value: string;
};

export type HistoryState = {
  readonly phase: HistoryPhase;
  readonly query: HistoryQuery | undefined;
  readonly records: readonly RecordSummary[];
  readonly error: StudioError | undefined;
};

export type DetailPhase =
  | "idle"
  | "loading"
  | "ok"
  | "missing" // deleted or expired, per the node
  | "malformed" // retrievable but the payload fails validation
  | "failed";

/**
 * A fully decoded and validated Arkiv entity: system metadata plus the parsed
 * allowlisted experiment record. `payloadJson` is kept so "the exact bytes on
 * chain" stays visible next to the parsed record.
 */
export type ArkivRecord = {
  readonly entityKey: Hex;
  readonly owner: Address;
  readonly creator: Address;
  readonly createdAtBlock: bigint;
  readonly updatedAtBlock: bigint;
  readonly expiresAtBlock: bigint;
  readonly readonlyFlag: boolean;
  readonly payloadJson: string;
  readonly metadata: ExperimentMetadata;
};

export type DetailState = {
  readonly phase: DetailPhase;
  readonly entityKey: Hex | undefined;
  readonly record: ArkivRecord | undefined;
  readonly error: StudioError | undefined;
};

/** The full UI state the Arkiv feature reduces. */
export type StudioArkivState = {
  readonly wallet: WalletState;
  readonly publish: PublishState;
  readonly history: HistoryState;
  readonly detail: DetailState;
};

export function initialState(): StudioArkivState {
  return {
    wallet: { status: "missing", address: undefined, chainIdHex: undefined },
    publish: {
      phase: "idle",
      metadata: undefined,
      txHash: undefined,
      entityKey: undefined,
      expiresAtBlock: undefined,
      error: undefined,
      readBack: undefined,
    },
    history: {
      phase: "idle",
      query: undefined,
      records: [],
      error: undefined,
    },
    detail: {
      phase: "idle",
      entityKey: undefined,
      record: undefined,
      error: undefined,
    },
  };
}

/** A reason a publish request cannot proceed, or null when it can. */
export function publishBlockReason(
  state: Pick<StudioArkivState, "wallet" | "publish">,
): StudioError | null {
  const wallet = state.wallet;
  if (wallet.status === "missing") {
    return {
      category: "wrong-network",
      message:
        "No wallet extension (window.ethereum) is available in this browser.",
    };
  }
  if (wallet.status === "disconnected") {
    return { category: "wrong-network", message: "Connect a wallet first." };
  }
  if (wallet.status === "wrong-network") {
    return {
      category: "wrong-network",
      message:
        "Switch the wallet to Rabdi (chain id 0x76edaf) first. No network is switched silently.",
    };
  }
  const metadata = state.publish.metadata;
  if (metadata === undefined) {
    return {
      category: "validation",
      message: "Load and validate a local experiment record first.",
    };
  }
  const phase = state.publish.phase;
  if (
    phase === "preflight" ||
    phase === "awaiting-signature" ||
    phase === "confirming"
  ) {
    return {
      category: "unknown",
      message: "A publish is already in flight; wait for it to finish.",
    };
  }
  if (phase === "confirmed" || phase === "existing") {
    return {
      category: "duplicate",
      message:
        "This record is already published. Use the history view instead.",
    };
  }
  return null;
}
