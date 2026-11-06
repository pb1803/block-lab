import { describe, expect, it } from "vitest";
import { reduce } from "./state.js";
import { sampleMetadata } from "./test-fixtures.js";
import { initialState } from "./types.js";

const RABDI = "0x76edaf";
const CHAIN_1 = "0x1";

describe("state reducer — wallet", () => {
  it("moves missing → connected on Rabdi; wrong-network otherwise", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: "0xa",
      chainIdHex: RABDI,
    });
    expect(state.wallet.status).toBe("connected");
    state = reduce(state, {
      type: "wallet-chain-changed",
      chainIdHex: CHAIN_1,
    });
    expect(state.wallet.status).toBe("wrong-network");
    state = reduce(state, { type: "wallet-chain-changed", chainIdHex: RABDI });
    expect(state.wallet.status).toBe("connected");
  });

  it("disconnect clears the account and resets publish state", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: "0xa",
      chainIdHex: RABDI,
    });
    state = reduce(state, {
      type: "record-loaded",
      metadata: sampleMetadata(),
    });
    state = reduce(state, {
      type: "publish-confirmed",
      entityKey: "0xbb",
      txHash: "0xcc",
      expiresAtBlock: 10n,
    });
    state = reduce(state, { type: "wallet-disconnected" });
    expect(state.wallet.status).toBe("disconnected");
    expect(state.publish.phase).toBe("idle");
    expect(state.publish.entityKey).toBeUndefined();
  });
});

describe("state reducer — publish", () => {
  it("confirms only after an actual signing step; refuses out-of-order confirms", () => {
    // Out of order: no signature was ever requested.
    const state = reduce(
      reduce(initialState(), {
        type: "wallet-connected",
        address: "0xa",
        chainIdHex: RABDI,
      }),
      {
        type: "publish-confirmed",
        entityKey: "0xbb",
        txHash: "0xcc",
        expiresAtBlock: 10n,
      },
    );
    expect(state.publish.phase).toBe("failed");
    expect(state.publish.error?.message).toContain("out of order");
  });

  it("tracks the full successful lifecycle", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: "0xa",
      chainIdHex: RABDI,
    });
    state = reduce(state, {
      type: "record-loaded",
      metadata: sampleMetadata(),
    });
    state = reduce(state, { type: "publish-started" });
    expect(state.publish.phase).toBe("preflight");
    state = reduce(state, { type: "preflight-ok" });
    expect(state.publish.phase).toBe("awaiting-signature");
    state = reduce(state, { type: "signature-requested" });
    expect(state.publish.phase).toBe("confirming");
    state = reduce(state, {
      type: "publish-confirmed",
      entityKey: "0xbb",
      txHash: "0xcc",
      expiresAtBlock: 10n,
    });
    expect(state.publish.phase).toBe("confirmed");
    state = reduce(state, {
      type: "read-back",
      result: { outcome: "verified", detail: "byte-identical" },
    });
    expect(state.publish.readBack?.outcome).toBe("verified");
  });

  it("reports duplicates and blocks re-publication", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: "0xa",
      chainIdHex: RABDI,
    });
    state = reduce(state, {
      type: "record-loaded",
      metadata: sampleMetadata(),
    });
    state = reduce(state, { type: "duplicate-found", entityKey: "0xbb" });
    expect(state.publish.phase).toBe("existing");
    expect(state.publish.entityKey).toBe("0xbb");
    expect(state.publish.error?.category).toBe("duplicate");
  });

  it("uncertain outcomes keep the found key and refuse retry", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: "0xa",
      chainIdHex: RABDI,
    });
    state = reduce(state, {
      type: "record-loaded",
      metadata: sampleMetadata(),
    });
    state = reduce(state, {
      type: "publish-uncertain",
      entityKey: "0xbb",
      error: {
        category: "unknown",
        message: "uncertain; Nothing was re-signed; verify before retry",
      },
    });
    expect(state.publish.phase).toBe("failed");
    expect(state.publish.entityKey).toBe("0xbb");
    expect(state.publish.error?.message).toContain("Nothing was re-signed");
  });
});

describe("state reducer — history and detail", () => {
  it("distinguishes a genuine empty history from an error", () => {
    let state = reduce(initialState(), {
      type: "history-started",
      field: "status",
      value: "passed",
    });
    expect(state.history.phase).toBe("searching");
    state = reduce(state, { type: "history-empty" });
    expect(state.history.phase).toBe("empty");
    state = reduce(state, {
      type: "history-started",
      field: "status",
      value: "passed",
    });
    state = reduce(state, {
      type: "history-failed",
      error: { category: "network", message: "429" },
    });
    expect(state.history.phase).toBe("failed");
    expect(state.history.error?.category).toBe("network");
  });

  it("tracks detail phases including missing and malformed", () => {
    let state = reduce(initialState(), {
      type: "detail-started",
      entityKey: "0xbb",
    });
    expect(state.detail.phase).toBe("loading");
    state = reduce(state, {
      type: "detail-succeeded",
      record: {
        entityKey: "0xbb",
        owner: "0xa",
        creator: "0xa",
        createdAtBlock: 1n,
        updatedAtBlock: 1n,
        expiresAtBlock: 10n,
        readonlyFlag: false,
        payloadJson: "{}",
        metadata: sampleMetadata(),
      },
    });
    expect(state.detail.phase).toBe("ok");
    state = reduce(state, { type: "detail-started", entityKey: "0xbb" });
    state = reduce(state, { type: "detail-missing" });
    expect(state.detail.phase).toBe("missing");
    state = reduce(state, { type: "detail-started", entityKey: "0xbb" });
    state = reduce(state, {
      type: "detail-malformed",
      error: { category: "malformed-response", message: "not JSON" },
    });
    expect(state.detail.phase).toBe("malformed");
  });
});
