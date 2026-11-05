import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";

/** Wallet attach/detach and network state. */
export type WalletStatus =
  | "missing" // no window.ethereum
  | "disconnected"
  | "connected" // connected and on Rabdi
  | "wrong-network"; // connected but not on Rabdi

/** Publish lifecycle. Every transition is driven by a real event. */
export type PublishStatus =
  | "idle"
  | "preflight" // duplicate check in flight
  | "awaiting-signature" // wallet prompt requested
  | "confirming" // signed, waiting for on-chain confirmation
  | "confirmed" // SDK returned a receipt-backed entity key
  | "existing" // an entity with this experimentId already exists
  | "failed";

export type QueryStatus = "idle" | "querying" | "ok" | "missing" | "failed";

export type ErrorCategory =
  | "user-rejected"
  | "wrong-network"
  | "network"
  | "sdk"
  | "malformed-response"
  | "validation"
  | "unknown";

export type WorkflowError = {
  readonly category: ErrorCategory;
  readonly message: string;
};

/** What the read-back view knows about an archived entity. */
export type ArchivedRecord = {
  readonly entityKey: Hex;
  readonly owner: Address;
  readonly creator: Address;
  readonly createdAtBlock: bigint;
  readonly updatedAtBlock: bigint;
  readonly expiresAtBlock: bigint;
  readonly readonlyFlag: boolean;
  readonly payloadJson: string;
};

export type WalletPart = {
  readonly status: WalletStatus;
  readonly address: Address | undefined;
  readonly chainIdHex: Hex | undefined;
};

export type PublishPart = {
  readonly status: PublishStatus;
  readonly metadata: ExperimentMetadata | undefined;
  readonly txHash: Hex | undefined;
  readonly entityKey: Hex | undefined;
  readonly expiresAtBlock: bigint | undefined;
  readonly error: WorkflowError | undefined;
  readonly alreadyPublished: boolean;
};

export type QueryPart = {
  readonly status: QueryStatus;
  readonly record: ArchivedRecord | undefined;
  readonly error: WorkflowError | undefined;
};

export type WorkflowState = {
  readonly wallet: WalletPart;
  readonly publish: PublishPart;
  readonly query: QueryPart;
};

export function initialState(): WorkflowState {
  return {
    wallet: { status: "missing", address: undefined, chainIdHex: undefined },
    publish: {
      status: "idle",
      metadata: undefined,
      txHash: undefined,
      entityKey: undefined,
      expiresAtBlock: undefined,
      error: undefined,
      alreadyPublished: false,
    },
    query: { status: "idle", record: undefined, error: undefined },
  };
}

/** A human reason a publish request cannot currently proceed, or null. */
export function publishBlockReason(state: WorkflowState): WorkflowError | null {
  const wallet = state.wallet;
  if (wallet.status === "missing") {
    return {
      category: "wrong-network",
      message: "No wallet extension (window.ethereum) is available.",
    };
  }
  if (wallet.status === "disconnected") {
    return { category: "wrong-network", message: "Connect a wallet first." };
  }
  if (wallet.status === "wrong-network") {
    return {
      category: "wrong-network",
      message: "Switch the wallet to Rabdi (chain id 0x76edaf) first.",
    };
  }
  if (state.publish.metadata === undefined) {
    return {
      category: "validation",
      message: "No experiment record is loaded to publish.",
    };
  }
  const status = state.publish.status;
  if (
    status === "preflight" ||
    status === "awaiting-signature" ||
    status === "confirming"
  ) {
    return {
      category: "unknown",
      message: "A publish is already in flight; wait for it to finish.",
    };
  }
  if (status === "confirmed" || status === "existing") {
    return {
      category: "unknown",
      message:
        "This experiment is already published. Use the query view instead.",
    };
  }
  return null;
}

export type WorkflowEvent =
  | { readonly type: "wallet-missing" }
  | { readonly type: "wallet-disconnected" }
  | {
      readonly type: "wallet-connected";
      readonly address: Address;
      readonly chainIdHex: Hex;
    }
  | { readonly type: "wallet-chain-changed"; readonly chainIdHex: Hex }
  | {
      readonly type: "accounts-changed";
      readonly address: Address | undefined;
      readonly chainIdHex: Hex;
    }
  | { readonly type: "record-loaded"; readonly metadata: ExperimentMetadata }
  | { readonly type: "publish-blocked"; readonly error: WorkflowError }
  | { readonly type: "preflight-started" }
  | { readonly type: "duplicate-found"; readonly entityKey: Hex }
  | { readonly type: "signature-requested" }
  | {
      readonly type: "publish-confirmed";
      readonly entityKey: Hex;
      readonly txHash: Hex;
      readonly expiresAtBlock: bigint;
    }
  | { readonly type: "publish-failed"; readonly error: WorkflowError }
  | { readonly type: "publish-reset" }
  | { readonly type: "query-started" }
  | { readonly type: "query-succeeded"; readonly record: ArchivedRecord }
  | { readonly type: "query-not-found" }
  | { readonly type: "query-failed"; readonly error: WorkflowError };

/** Walks the state with one event, never mutating the previous state. */
export function reduce(
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState {
  switch (event.type) {
    case "wallet-missing":
      return {
        ...state,
        wallet: {
          status: "missing",
          address: undefined,
          chainIdHex: undefined,
        },
      };

    case "wallet-disconnected":
      return {
        ...state,
        wallet: {
          status: "disconnected",
          address: undefined,
          chainIdHex: undefined,
        },
      };

    case "wallet-connected": {
      const chainId = event.chainIdHex.toLowerCase() as Hex;
      return {
        ...state,
        wallet: {
          status: chainId === "0x76edaf" ? "connected" : "wrong-network",
          address: event.address,
          chainIdHex: chainId,
        },
      };
    }

    case "wallet-chain-changed": {
      const chainId = event.chainIdHex.toLowerCase() as Hex;
      return {
        ...state,
        wallet: {
          ...state.wallet,
          status: chainId === "0x76edaf" ? "connected" : "wrong-network",
          chainIdHex: chainId,
        },
      };
    }

    case "accounts-changed": {
      if (event.address === undefined) {
        return {
          ...state,
          wallet: {
            status: "disconnected",
            address: undefined,
            chainIdHex: undefined,
          },
        };
      }
      const chainId = event.chainIdHex.toLowerCase() as Hex;
      return {
        ...state,
        wallet: {
          status: chainId === "0x76edaf" ? "connected" : "wrong-network",
          address: event.address,
          chainIdHex: chainId,
        },
      };
    }

    case "record-loaded":
      return {
        ...state,
        publish: {
          status: "idle",
          metadata: event.metadata,
          txHash: undefined,
          entityKey: undefined,
          expiresAtBlock: undefined,
          error: undefined,
          alreadyPublished: false,
        },
        query: { status: "idle", record: undefined, error: undefined },
      };

    case "publish-blocked":
      return {
        ...state,
        publish: { ...state.publish, error: event.error },
      };

    case "preflight-started":
      return {
        ...state,
        publish: { ...state.publish, status: "preflight", error: undefined },
      };

    case "duplicate-found":
      return {
        ...state,
        publish: {
          ...state.publish,
          status: "existing",
          entityKey: event.entityKey,
          txHash: undefined,
          alreadyPublished: true,
          error: undefined,
        },
      };

    case "signature-requested":
      return {
        ...state,
        publish: {
          ...state.publish,
          status: "awaiting-signature",
          error: undefined,
        },
      };

    case "publish-confirmed":
      // Confirmation is only trusted after an actual signing step; an
      // out-of-order confirm (never signed) would otherwise fabricate success.
      if (
        state.publish.status !== "awaiting-signature" &&
        state.publish.status !== "confirming"
      ) {
        return {
          ...state,
          publish: {
            ...state.publish,
            status: "failed",
            error: {
              category: "unknown",
              message:
                "Confirmation event arrived out of order; no record was written.",
            },
          },
        };
      }
      return {
        ...state,
        publish: {
          ...state.publish,
          status: "confirmed",
          txHash: event.txHash,
          entityKey: event.entityKey,
          expiresAtBlock: event.expiresAtBlock,
          error: undefined,
        },
      };

    case "publish-failed":
      return {
        ...state,
        publish: { ...state.publish, status: "failed", error: event.error },
      };

    case "publish-reset":
      return {
        ...state,
        publish: {
          status: "idle",
          metadata: state.publish.metadata,
          txHash: undefined,
          entityKey: undefined,
          expiresAtBlock: undefined,
          error: undefined,
          alreadyPublished: false,
        },
        query: { status: "idle", record: undefined, error: undefined },
      };

    case "query-started":
      return {
        ...state,
        query: { status: "querying", record: undefined, error: undefined },
      };

    case "query-succeeded":
      return {
        ...state,
        query: { status: "ok", record: event.record, error: undefined },
      };

    case "query-not-found":
      return {
        ...state,
        query: { status: "missing", record: undefined, error: undefined },
      };

    case "query-failed":
      return {
        ...state,
        query: { status: "failed", record: undefined, error: event.error },
      };
  }
}
