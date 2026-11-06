/**
 * The Studio Arkiv controller: drives publish, history search and detail
 * retrieval through one gateway, with a monotonic generation counter so stale
 * async results cannot race a newer session.
 *
 * Publish rules (mirrors the verified POC harness):
 * - duplicate preflight BEFORE signing; a preflight that cannot run blocks the
 *   write (unknown duplicate state is never treated as "no duplicate");
 * - exactly one `createEntity` per attempt;
 * - an error is never retried blindly: the controller re-queries for the
 *   entity, and if one now exists it reports the uncertain outcome with the
 *   found key instead of re-signing.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { HISTORY_LIMIT, type HistorySearchField } from "./config.js";
import { type ArkivGateway, MalformedRecordError } from "./gateway.js";
import type { OwnershipSnapshot } from "./ownership.js";
import {
  compareOwnership,
  normalizeAddress,
  sameAddress,
  transferBlockReason,
} from "./ownership.js";
import { findSensitiveContent, verifyReadBack } from "./record.js";
import { type ArkivEvent, reduce } from "./state.js";
import type { StudioArkivState, StudioError } from "./types.js";
import { initialState, publishBlockReason } from "./types.js";
import { classifyError } from "./wallet.js";

export type StateListener = (state: StudioArkivState) => void;

export type ControllerDeps = {
  /** Fixed gateway, or a function resolving the current one (live app swaps
   * gateways when the wallet account changes). */
  readonly gateway: ArkivGateway | (() => ArkivGateway | null) | null;
  readonly classify?: (error: unknown) => StudioError;
};

function classifyWithMalformed(
  error: unknown,
  classify: (error: unknown) => StudioError,
): StudioError {
  if (error instanceof MalformedRecordError) {
    return { category: "malformed-response", message: error.message };
  }
  return classify(error);
}

export class ArkivController {
  #state: StudioArkivState = initialState();
  #listeners = new Set<StateListener>();
  readonly #gatewayFn: () => ArkivGateway | null;
  readonly #classify: (error: unknown) => StudioError;
  /** Monotonic lifecycle id: stale async steps cannot overwrite newer ones. */
  #generation = 0;

  constructor(deps: ControllerDeps) {
    const gateway = deps.gateway;
    this.#gatewayFn =
      typeof gateway === "function"
        ? (gateway as unknown as () => ArkivGateway | null)
        : () => gateway as ArkivGateway | null;
    this.#classify = deps.classify ?? classifyError;
  }

  get gateway(): ArkivGateway | null {
    return this.#gatewayFn();
  }

  get state(): StudioArkivState {
    return this.#state;
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: ArkivEvent, generation = this.#generation): void {
    if (generation !== this.#generation) return;
    this.#state = reduce(this.#state, event);
    for (const listener of this.#listeners) listener(this.#state);
  }

  #invalidateInFlight(): void {
    this.#generation += 1;
  }

  walletMissing(): void {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-missing" });
  }

  walletDisconnected(): void {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-disconnected" });
  }

  walletConnected(address: Address, chainIdHex: Hex): void {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-connected", address, chainIdHex });
  }

  chainChanged(chainIdHex: Hex): void {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-chain-changed", chainIdHex });
  }

  loadRecord(metadata: ExperimentMetadata): void {
    this.#invalidateInFlight();
    this.#emit({ type: "record-loaded", metadata });
  }

  resetPublish(): void {
    this.#invalidateInFlight();
    this.#emit({ type: "publish-reset" });
  }

  /** Exactly one publication; every guard runs inside. */
  async publish(): Promise<void> {
    const blocked = publishBlockReason(this.#state);
    if (blocked !== null) {
      this.#emit({ type: "publish-failed", error: blocked });
      return;
    }
    const gateway = this.gateway;
    const metadata = this.#state.publish.metadata;
    if (gateway === null || metadata === undefined) {
      this.#emit({
        type: "publish-failed",
        error: { category: "validation", message: "Gateway is not ready." },
      });
      return;
    }
    // Last line of defence: never sign a record carrying credential shapes.
    const sensitive = findSensitiveContent(metadata);
    if (sensitive.length > 0) {
      this.#emit({
        type: "publish-failed",
        error: {
          category: "validation",
          message: `The record carries credential-shaped content (${sensitive.join(", ")}); nothing was signed.`,
        },
      });
      return;
    }
    const generation = this.#generation;
    this.#emit({ type: "publish-started" }, generation);

    try {
      const lookup = await gateway.findExperiment(metadata.experimentId);
      if (lookup.entityKey !== null) {
        this.#emit(
          { type: "duplicate-found", entityKey: lookup.entityKey },
          generation,
        );
        return;
      }
    } catch (error) {
      this.#emit(
        { type: "publish-failed", error: this.#classify(error) },
        generation,
      );
      return;
    }

    this.#emit({ type: "preflight-ok" }, generation);
    try {
      const result = await gateway.publishExperiment(metadata);
      this.#emit(
        {
          type: "publish-confirmed",
          entityKey: result.entityKey,
          txHash: result.txHash,
          expiresAtBlock: result.expiresAtBlock,
        },
        generation,
      );
      await this.#verifyReadBack(
        gateway,
        metadata,
        result.entityKey,
        generation,
      );
    } catch (error) {
      // Uncertain outcome: never re-sign. Re-check whether the entity exists.
      let after: Hex | null = null;
      try {
        const lookup = await gateway.findExperiment(metadata.experimentId);
        after = lookup.entityKey;
      } catch {
        after = null;
      }
      if (after !== null) {
        const classified = this.#classify(error);
        this.#emit(
          {
            type: "publish-uncertain",
            entityKey: after,
            error: {
              category: "unknown",
              message:
                `The write result was uncertain (${classified.category}) and an entity now exists for this id: ${after}. ` +
                "Nothing was re-signed; verify the entity before trying again.",
            },
          },
          generation,
        );
        return;
      }
      this.#emit(
        { type: "publish-failed", error: this.#classify(error) },
        generation,
      );
    }
  }

  resetTransfer(): void {
    this.#invalidateInFlight();
    this.#emit({ type: "transfer-reset" });
  }

  /**
   * Reads the entity live and stages a preview. Nothing is signed here, so the
   * confirmation always reflects chain state at preview time.
   */
  async previewTransfer(entityKey: Hex, typedNewOwner: string): Promise<void> {
    const gateway = this.gateway;
    if (gateway === null) {
      this.#emit({
        type: "transfer-failed",
        error: { category: "validation", message: "Gateway is not ready." },
      });
      return;
    }
    const newOwner = normalizeAddress(typedNewOwner);
    const generation = this.#generation;
    let snapshot: OwnershipSnapshot;
    let currentBlock: bigint | null;
    try {
      const read = await gateway.readOwnership(entityKey);
      snapshot = { entityKey, ...read };
      currentBlock = await gateway.currentBlock().catch(() => null);
    } catch (error) {
      this.#emit(
        { type: "transfer-failed", error: this.#classify(error) },
        generation,
      );
      return;
    }
    const blocked = transferBlockReason({
      wallet: this.#state.wallet,
      snapshot,
      newOwner: typedNewOwner,
      currentBlock,
    });
    if (blocked !== null || newOwner === null) {
      this.#emit(
        {
          type: "transfer-failed",
          error: blocked ?? {
            category: "validation",
            message: "Enter a valid recipient address.",
          },
        },
        generation,
      );
      return;
    }
    this.#emit(
      { type: "transfer-previewed", entityKey, newOwner, before: snapshot },
      generation,
    );
  }

  /**
   * Exactly one transfer per preview. The owner is re-read immediately before the
   * send so a wallet change in between cannot send a transfer the wallet will
   * simply revert; an error is never retried, it is re-read and reported.
   */
  async submitTransfer(): Promise<void> {
    const gateway = this.gateway;
    const staged = this.#state.transfer;
    const newOwner = staged.newOwner;
    const before = staged.before;
    if (
      gateway === null ||
      newOwner === undefined ||
      before === undefined ||
      staged.phase !== "preview"
    ) {
      this.#emit({
        type: "transfer-failed",
        error: {
          category: "validation",
          message: "Preview the transfer again before confirming it.",
        },
      });
      return;
    }
    const signer = this.#state.wallet.address;
    const generation = this.#generation;

    // Drift guard: the owner and the target must still be what was previewed.
    try {
      const fresh = await gateway.readOwnership(before.entityKey);
      const drift = compareBefore(before, {
        entityKey: before.entityKey,
        ...fresh,
      });
      if (drift !== null) {
        this.#emit(
          {
            type: "transfer-previewed",
            entityKey: before.entityKey,
            newOwner,
            before: { entityKey: before.entityKey, ...fresh },
          },
          generation,
        );
        this.#emit(
          {
            type: "transfer-failed",
            error: { category: "duplicate", message: drift },
          },
          generation,
        );
        return;
      }
      if (signer !== undefined && !sameAddress(fresh.owner, signer)) {
        this.#emit(
          {
            type: "transfer-failed",
            error: {
              category: "wrong-network",
              message: `The owner changed to ${fresh.owner} while previewing; reconnect that account and preview again.`,
            },
          },
          generation,
        );
        return;
      }
    } catch (error) {
      this.#emit(
        { type: "transfer-failed", error: this.#classify(error) },
        generation,
      );
      return;
    }

    this.#emit({ type: "transfer-submitting" }, generation);
    try {
      const txHash = await gateway.transferOwnership(
        before.entityKey,
        newOwner,
      );
      // Independent read-back, in this process, against what was previewed.
      const after = await gateway.readOwnership(before.entityKey).then(
        (read) => ({ entityKey: before.entityKey, ...read }),
        () => null,
      );
      if (after === null) {
        this.#emit(
          {
            type: "transfer-confirmed",
            txHash,
            after: before,
            readBack: {
              ok: false,
              checks: [
                {
                  name: "the entity could be read back after the transfer",
                  ok: false,
                  detail:
                    "read-back failed; re-open the entity before relying on it",
                },
              ],
            },
          },
          generation,
        );
        return;
      }
      this.#emit(
        {
          type: "transfer-confirmed",
          txHash,
          after,
          readBack: compareOwnership(before, after, newOwner),
        },
        generation,
      );
    } catch (error) {
      // Never re-sign: re-read once and say what the chain shows now.
      const after = await gateway
        .readOwnership(before.entityKey)
        .catch(() => null);
      const moved = after !== null && sameAddress(after.owner, newOwner);
      this.#emit(
        {
          type: "transfer-failed",
          ...(after === null
            ? {}
            : {
                readBack: compareOwnership(
                  before,
                  { entityKey: before.entityKey, ...after },
                  newOwner,
                ),
              }),
          error: {
            category: this.#classify(error).category,
            message: moved
              ? `The transfer reported an error, but the owner is now ${after.owner}: it landed. Nothing was re-signed.`
              : `The transfer failed and ${before.entityKey} is still owned by ${after?.owner ?? before.owner}. Nothing was re-signed.`,
          },
        },
        generation,
      );
    }
  }

  async #verifyReadBack(
    gateway: ArkivGateway,
    metadata: ExperimentMetadata,
    entityKey: Hex,
    generation: number,
  ): Promise<void> {
    try {
      const record = await gateway.readRecord(entityKey);
      const verification = verifyReadBack(metadata, record);
      this.#emit(
        {
          type: "read-back",
          result: verification.verified
            ? {
                outcome: "verified",
                detail:
                  "Read back after confirmation; the stored payload is byte-identical to the submitted record.",
              }
            : { outcome: "mismatch", detail: verification.reason },
        },
        generation,
      );
    } catch (error) {
      const classified = this.#classify(error);
      this.#emit(
        {
          type: "read-back",
          result: {
            outcome: "unavailable",
            detail: `Read-back could not run: [${classified.category}] ${classified.message}`,
          },
        },
        generation,
      );
    }
  }

  async search(field: HistorySearchField, value: string): Promise<void> {
    const gateway = this.gateway;
    if (gateway === null) {
      this.#emit({
        type: "history-failed",
        error: { category: "validation", message: "Gateway is not ready." },
      });
      return;
    }
    const generation = this.#generation;
    this.#emit({ type: "history-started", field, value }, generation);
    try {
      const records = await gateway.queryBy(field, value.trim(), HISTORY_LIMIT);
      this.#emit({ type: "history-succeeded", records }, generation);
    } catch (error) {
      this.#emit(
        {
          type: "history-failed",
          error: classifyWithMalformed(error, this.#classify),
        },
        generation,
      );
    }
  }

  async openRecord(entityKey: Hex): Promise<void> {
    const gateway = this.gateway;
    if (gateway === null) {
      this.#emit({
        type: "detail-failed",
        error: { category: "validation", message: "Gateway is not ready." },
      });
      return;
    }
    const generation = this.#generation;
    this.#emit({ type: "detail-started", entityKey }, generation);
    try {
      const record = await gateway.readRecord(entityKey);
      this.#emit({ type: "detail-succeeded", record }, generation);
    } catch (error) {
      const classified = classifyWithMalformed(error, this.#classify);
      if (classified.category === "missing") {
        this.#emit({ type: "detail-missing" }, generation);
        return;
      }
      if (
        classified.category === "malformed-response" ||
        classified.category === "validation"
      ) {
        this.#emit({ type: "detail-malformed", error: classified }, generation);
        return;
      }
      this.#emit({ type: "detail-failed", error: classified }, generation);
    }
  }
}

/**
 * Why a previewed transfer is no longer valid, or null when it still is. A
 * changed owner, a changed expiry or a changed payload all invalidate it.
 */
function compareBefore(
  before: OwnershipSnapshot,
  fresh: OwnershipSnapshot,
): string | null {
  if (sameAddress(fresh.owner, before.owner)) {
    if (fresh.creator !== before.creator) {
      return `The creator changed from ${before.creator} to ${fresh.creator}; preview again.`;
    }
    if (fresh.expiresAtBlock !== before.expiresAtBlock) {
      return `The expiry changed to block ${fresh.expiresAtBlock}; preview again.`;
    }
    if (fresh.payloadHex !== before.payloadHex) {
      return "The payload changed since the preview; preview again.";
    }
    return null;
  }
  return `The owner changed from ${before.owner} to ${fresh.owner} since the preview; preview again.`;
}
