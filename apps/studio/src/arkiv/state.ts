/**
 * Pure state reducer for the Studio Arkiv history feature.
 *
 * Mirrors the proven POC state machine (`apps/arkiv-poc/src/status.ts`) and
 * extends it with history/detail transitions. Every transition is driven by a
 * real event; out-of-order confirmations are refused, so a stale async result
 * can never fabricate a success.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { RABDI_CHAIN_ID_HEX } from "./config.js";
import type {
  ArkivRecord,
  ReadBackResult,
  RecordSummary,
  StudioArkivState,
  StudioError,
} from "./types.js";
import { initialState } from "./types.js";

export type ArkivEvent =
  | { readonly type: "wallet-missing" }
  | { readonly type: "wallet-disconnected" }
  | {
      readonly type: "wallet-connected";
      readonly address: Address;
      readonly chainIdHex: Hex;
    }
  | { readonly type: "wallet-chain-changed"; readonly chainIdHex: Hex }
  | { readonly type: "record-loaded"; readonly metadata: ExperimentMetadata }
  | { readonly type: "publish-started" }
  | { readonly type: "preflight-ok" }
  | { readonly type: "duplicate-found"; readonly entityKey: Hex }
  | { readonly type: "signature-requested" }
  | {
      readonly type: "publish-confirmed";
      readonly entityKey: Hex;
      readonly txHash: Hex;
      readonly expiresAtBlock: bigint;
    }
  | { readonly type: "read-back"; readonly result: ReadBackResult }
  | { readonly type: "publish-failed"; readonly error: StudioError }
  | {
      readonly type: "publish-uncertain";
      readonly entityKey: Hex;
      readonly error: StudioError;
    }
  | { readonly type: "publish-reset" }
  | {
      readonly type: "history-started";
      readonly field: string;
      readonly value: string;
    }
  | {
      readonly type: "history-succeeded";
      readonly records: readonly RecordSummary[];
    }
  | { readonly type: "history-empty" }
  | { readonly type: "history-failed"; readonly error: StudioError }
  | { readonly type: "detail-started"; readonly entityKey: Hex }
  | { readonly type: "detail-succeeded"; readonly record: ArkivRecord }
  | { readonly type: "detail-missing" }
  | { readonly type: "detail-malformed"; readonly error: StudioError }
  | { readonly type: "detail-failed"; readonly error: StudioError };

function asChainId(value: Hex): Hex {
  return value.toLowerCase() as Hex;
}

function walletConnectedState(
  state: StudioArkivState,
  address: Address,
  chainIdHex: Hex,
): StudioArkivState {
  const chainId = asChainId(chainIdHex);
  return {
    ...state,
    wallet: {
      status: chainId === RABDI_CHAIN_ID_HEX ? "connected" : "wrong-network",
      address,
      chainIdHex: chainId,
    },
  };
}

export function reduce(
  state: StudioArkivState,
  event: ArkivEvent,
): StudioArkivState {
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
        publish: {
          phase: "idle",
          metadata: state.publish.metadata,
          txHash: undefined,
          entityKey: undefined,
          expiresAtBlock: undefined,
          error: undefined,
          readBack: undefined,
        },
      };

    case "wallet-connected":
      return walletConnectedState(state, event.address, event.chainIdHex);

    case "wallet-chain-changed":
      return walletConnectedState(
        state,
        state.wallet.address ?? "0x0",
        event.chainIdHex,
      );

    case "record-loaded":
      return {
        ...state,
        publish: {
          phase: "idle",
          metadata: event.metadata,
          txHash: undefined,
          entityKey: undefined,
          expiresAtBlock: undefined,
          error: undefined,
          readBack: undefined,
        },
      };

    case "publish-started":
      return {
        ...state,
        publish: {
          ...state.publish,
          phase: "preflight",
          error: undefined,
          readBack: undefined,
        },
      };

    case "preflight-ok":
      return {
        ...state,
        publish: { ...state.publish, phase: "awaiting-signature" },
      };

    case "duplicate-found":
      return {
        ...state,
        publish: {
          ...state.publish,
          phase: "existing",
          entityKey: event.entityKey,
          txHash: undefined,
          error: {
            category: "duplicate",
            message: `An entity with this experimentId already exists at ${event.entityKey}. No new transaction was sent.`,
          },
        },
      };

    case "signature-requested":
      return {
        ...state,
        publish: { ...state.publish, phase: "confirming", error: undefined },
      };

    case "publish-confirmed":
      // Only trusted after an actual signing step; an out-of-order confirm
      // (never signed) would otherwise fabricate success.
      if (
        state.publish.phase !== "awaiting-signature" &&
        state.publish.phase !== "confirming"
      ) {
        return {
          ...state,
          publish: {
            ...state.publish,
            phase: "failed",
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
          phase: "confirmed",
          txHash: event.txHash,
          entityKey: event.entityKey,
          expiresAtBlock: event.expiresAtBlock,
          error: undefined,
        },
      };

    case "read-back":
      return {
        ...state,
        publish: { ...state.publish, readBack: event.result },
      };

    case "publish-failed":
      return {
        ...state,
        publish: { ...state.publish, phase: "failed", error: event.error },
      };

    case "publish-uncertain":
      return {
        ...state,
        publish: {
          ...state.publish,
          phase: "failed",
          entityKey: event.entityKey,
          error: event.error,
        },
      };

    case "publish-reset":
      return {
        ...state,
        publish: {
          phase: "idle",
          metadata: state.publish.metadata,
          txHash: undefined,
          entityKey: undefined,
          expiresAtBlock: undefined,
          error: undefined,
          readBack: undefined,
        },
      };

    case "history-started":
      return {
        ...state,
        history: {
          phase: "searching",
          query: { field: event.field, value: event.value },
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

    case "history-succeeded":
      return {
        ...state,
        history: {
          ...state.history,
          phase: event.records.length === 0 ? "empty" : "ok",
          records: event.records,
          error: undefined,
        },
      };

    case "history-empty":
      return {
        ...state,
        history: {
          ...state.history,
          phase: "empty",
          records: [],
          error: undefined,
        },
      };

    case "history-failed":
      return {
        ...state,
        history: {
          ...state.history,
          phase: "failed",
          records: [],
          error: event.error,
        },
      };

    case "detail-started":
      return {
        ...state,
        detail: {
          phase: "loading",
          entityKey: event.entityKey,
          record: undefined,
          error: undefined,
        },
      };

    case "detail-succeeded":
      return {
        ...state,
        detail: {
          phase: "ok",
          entityKey: event.record.entityKey,
          record: event.record,
          error: undefined,
        },
      };

    case "detail-missing":
      return {
        ...state,
        detail: {
          phase: "missing",
          entityKey: state.detail.entityKey,
          record: undefined,
          error: undefined,
        },
      };

    case "detail-malformed":
      return {
        ...state,
        detail: {
          phase: "malformed",
          entityKey: state.detail.entityKey,
          record: undefined,
          error: event.error,
        },
      };

    case "detail-failed":
      return {
        ...state,
        detail: {
          phase: "failed",
          entityKey: state.detail.entityKey,
          record: undefined,
          error: event.error,
        },
      };
  }
}
