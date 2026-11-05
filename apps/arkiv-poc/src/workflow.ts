import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import type { ArkivGateway } from "./gateway.js";
import {
  type ArchivedRecord,
  initialState,
  publishBlockReason,
  reduce,
  type WorkflowError,
  type WorkflowEvent,
  type WorkflowState,
} from "./status.js";
import { classifyError } from "./wallet.js";

export type StateListener = (state: WorkflowState) => void;

export type WorkflowDeps = {
  /** Created per connection; the wallet account is bound to it. */
  gateway: ArkivGateway | null;
  /** Error classifier; injected so tests can force categories. */
  classify?: (error: unknown) => WorkflowError;
};

/**
 * Runs the publish lifecycle described in Step 4/6 of the plan: load record,
 * preflight duplicate check, explicit signature request, confirmation (from the
 * SDK's receipt), then a read-back query.
 *
 * The SDK's `createEntity` resolves only once the transaction is in a block, so
 * the POC never emits a "submitted-but-unconfirmed" success: the confirmed
 * state and entity key are only set from that resolved receipt, and the read
 * back is a separate check performed afterwards.
 */
export class ArkivPocWorkflow {
  #state: WorkflowState = initialState();
  #listeners = new Set<StateListener>();
  readonly gateway: ArkivGateway | null;
  readonly #classify: (error: unknown) => WorkflowError;
  /** Monotonic lifecycle id so stale async steps cannot overwrite newer ones. */
  #generation = 0;

  constructor(deps: WorkflowDeps) {
    this.gateway = deps.gateway;
    this.#classify = deps.classify ?? classifyError;
  }

  get state(): WorkflowState {
    return this.#state;
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: WorkflowEvent, generation = this.#generation) {
    if (generation !== this.#generation) return;
    this.#state = reduce(this.#state, event);
    for (const listener of this.#listeners) listener(this.#state);
  }

  #invalidateInFlight() {
    this.#generation += 1;
  }

  walletMissing() {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-missing" });
  }

  walletDisconnected() {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-disconnected" });
  }

  walletConnected(address: Address, chainIdHex: Hex) {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-connected", address, chainIdHex });
  }

  chainChanged(chainIdHex: Hex) {
    this.#invalidateInFlight();
    this.#emit({ type: "wallet-chain-changed", chainIdHex });
  }

  accountsChanged(address: Address | undefined, chainIdHex: Hex) {
    this.#invalidateInFlight();
    this.#emit({ type: "accounts-changed", address, chainIdHex });
  }

  loadRecord(metadata: ExperimentMetadata) {
    this.#invalidateInFlight();
    this.#emit({ type: "record-loaded", metadata });
  }

  async publish(): Promise<void> {
    // Duplicate-submission protection: never two writes for the same
    // experimentId, and never a second click while one is in flight.
    const blocked = publishBlockReason(this.#state);
    if (blocked !== null) {
      this.#emit({ type: "publish-blocked", error: blocked });
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
    const generation = this.#generation;

    this.#emit({ type: "preflight-started" }, generation);
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
      // The duplicate check failed, so nothing was written; a write must not
      // proceed on top of an unknown duplicate state.
      this.#emit(
        { type: "publish-failed", error: this.#classify(error) },
        generation,
      );
      return;
    }

    this.#emit({ type: "signature-requested" }, generation);
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
    } catch (error) {
      this.#emit(
        { type: "publish-failed", error: this.#classify(error) },
        generation,
      );
    }
  }

  async queryEntity(entityKey: Hex): Promise<void> {
    const gateway = this.gateway;
    if (gateway === null) {
      this.#emit({
        type: "query-failed",
        error: { category: "validation", message: "Gateway is not ready." },
      });
      return;
    }
    const generation = this.#generation;
    this.#emit({ type: "query-started" }, generation);
    try {
      const record: ArchivedRecord = await gateway.readExperiment(entityKey);
      this.#emit({ type: "query-succeeded", record }, generation);
    } catch (error) {
      const named = this.#classify(error);
      this.#emit({ type: "query-failed", error: named }, generation);
    }
  }
}
