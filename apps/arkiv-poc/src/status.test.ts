import { ARKIV_ENTITY_TAG } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  initialState,
  publishBlockReason,
  reduce,
  type WorkflowState,
} from "../src/status.js";

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as Address;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as Address;
const RABDI = "0x76edaf" as Hex;
const OTHER = "0x1" as Hex;
const KEY = `0x${"ab".repeat(32)}` as Hex;

const META = {
  schemaVersion: "1.0" as const,
  experimentId: "run-001",
  experimentType: "rpc-blackout",
  scenarioName: "RPC blackout",
  targetChainId: 31337,
  status: "passed" as const,
  startedAtMs: 1_790_000_000_000,
  completedAtMs: 1_790_000_010_000,
  requestCount: 10,
  succeededCount: 8,
  failedCount: 2,
  rpcFailureCount: 2,
  evidenceDigest: "3f".repeat(32),
  expiryDays: 30,
};

describe("wallet and network state", () => {
  it("marks connected only when the chain is Rabdi", () => {
    let state = reduce(initialState(), {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: RABDI,
    });
    expect(state.wallet.status).toBe("connected");
    expect(state.wallet.address).toBe(ADDRESS_A);

    state = reduce(initialState(), {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: OTHER,
    });
    expect(state.wallet.status).toBe("wrong-network");
  });

  it("handles a chain change and account change", () => {
    const connected = reduce(initialState(), {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: RABDI,
    });

    const switched = reduce(connected, {
      type: "wallet-chain-changed",
      chainIdHex: OTHER,
    });
    expect(switched.wallet.status).toBe("wrong-network");

    const back = reduce(switched, {
      type: "wallet-chain-changed",
      chainIdHex: RABDI,
    });
    expect(back.wallet.status).toBe("connected");

    const moved = reduce(back, {
      type: "accounts-changed",
      address: ADDRESS_B,
      chainIdHex: RABDI,
    });
    expect(moved.wallet.address).toBe(ADDRESS_B);
    expect(moved.wallet.status).toBe("connected");

    const dropped = reduce(moved, {
      type: "accounts-changed",
      address: undefined,
      chainIdHex: RABDI,
    });
    expect(dropped.wallet.status).toBe("disconnected");
    expect(dropped.wallet.address).toBeUndefined();
  });

  it("is immutable", () => {
    const before = initialState();
    const after = reduce(before, {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: RABDI,
    });
    expect(after).not.toBe(before);
    expect(before.wallet.status).toBe("missing");
  });
});

function readyState(): WorkflowState {
  let state = reduce(initialState(), {
    type: "wallet-connected",
    address: ADDRESS_A,
    chainIdHex: RABDI,
  });
  state = reduce(state, { type: "record-loaded", metadata: META });
  return state;
}

describe("publishBlockReason", () => {
  it("blocks when there is no wallet or the wrong network", () => {
    expect(publishBlockReason(initialState())?.category).toBe("wrong-network");

    const disconnected = reduce(initialState(), {
      type: "wallet-disconnected",
    });
    expect(publishBlockReason(disconnected)?.category).toBe("wrong-network");

    const wrong = reduce(initialState(), {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: OTHER,
    });
    expect(publishBlockReason(wrong)?.category).toBe("wrong-network");
  });

  it("blocks without a loaded record", () => {
    const state = reduce(initialState(), {
      type: "wallet-connected",
      address: ADDRESS_A,
      chainIdHex: RABDI,
    });
    expect(publishBlockReason(state)?.category).toBe("validation");
  });

  it("allows an idle ready state", () => {
    expect(publishBlockReason(readyState())).toBeNull();
  });

  it("blocks while in flight, confirmed or existing", () => {
    const preflight = reduce(readyState(), { type: "preflight-started" });
    expect(publishBlockReason(preflight)?.message).toMatch(/in flight/);

    const signing = reduce(readyState(), { type: "signature-requested" });
    expect(publishBlockReason(signing)?.message).toMatch(/in flight/);

    const confirmed = reduce(
      reduce(readyState(), { type: "signature-requested" }),
      {
        type: "publish-confirmed",
        entityKey: KEY,
        txHash: "0xabc",
        expiresAtBlock: 123n,
      },
    );
    expect(publishBlockReason(confirmed)?.message).toMatch(/already published/);

    const existing = reduce(readyState(), {
      type: "duplicate-found",
      entityKey: KEY,
    });
    expect(publishBlockReason(existing)?.message).toMatch(/already published/);
  });

  it("allows retry after a failure", () => {
    const failed = reduce(readyState(), {
      type: "publish-failed",
      error: { category: "network", message: "boom" },
    });
    expect(publishBlockReason(failed)).toBeNull();
  });
});

describe("publish lifecycle", () => {
  it("walks preflight → awaiting-signature → confirmed", () => {
    let state = readyState();
    state = reduce(state, { type: "preflight-started" });
    expect(state.publish.status).toBe("preflight");

    state = reduce(state, { type: "signature-requested" });
    expect(state.publish.status).toBe("awaiting-signature");

    state = reduce(state, {
      type: "publish-confirmed",
      entityKey: KEY,
      txHash: "0xabc",
      expiresAtBlock: 123n,
    });
    expect(state.publish.status).toBe("confirmed");
    expect(state.publish.entityKey).toBe(KEY);
    expect(state.publish.txHash).toBe("0xabc");
  });

  it("never fabricates a confirmation out of order", () => {
    const state = reduce(readyState(), {
      type: "publish-confirmed",
      entityKey: KEY,
      txHash: "0xabc",
      expiresAtBlock: 123n,
    });
    expect(state.publish.status).toBe("failed");
    expect(state.publish.entityKey).toBeUndefined();
    expect(state.publish.error?.category).toBe("unknown");
  });

  it("records a duplicate as existing without a transaction", () => {
    const state = reduce(readyState(), {
      type: "duplicate-found",
      entityKey: KEY,
    });
    expect(state.publish.status).toBe("existing");
    expect(state.publish.alreadyPublished).toBe(true);
    expect(state.publish.txHash).toBeUndefined();
  });

  it("records a publish failure", () => {
    const state = reduce(readyState(), {
      type: "publish-failed",
      error: { category: "user-rejected", message: "rejected" },
    });
    expect(state.publish.status).toBe("failed");
    expect(state.publish.error?.category).toBe("user-rejected");
  });

  it("loads a record and resets publish + query", () => {
    let state = readyState();
    state = reduce(state, {
      type: "publish-confirmed",
      entityKey: KEY,
      txHash: "0xabc",
      expiresAtBlock: 1n,
    });
    state = reduce(state, { type: "record-loaded", metadata: META });
    expect(state.publish.status).toBe("idle");
    expect(state.publish.entityKey).toBeUndefined();
    expect(state.query.status).toBe("idle");
  });
});

describe("query lifecycle", () => {
  it("succeeds, misses, and fails distinctly", () => {
    const base = reduce(readyState(), {
      type: "publish-confirmed",
      entityKey: KEY,
      txHash: "0xabc",
      expiresAtBlock: 1n,
    });

    const started = reduce(base, { type: "query-started" });
    expect(started.query.status).toBe("querying");

    const ok = reduce(started, {
      type: "query-succeeded",
      record: {
        entityKey: KEY,
        owner: ADDRESS_A,
        creator: ADDRESS_A,
        createdAtBlock: 1n,
        updatedAtBlock: 1n,
        expiresAtBlock: 100n,
        readonlyFlag: false,
        payloadJson: "{}",
      },
    });
    expect(ok.query.status).toBe("ok");
    expect(ok.query.record?.entityKey).toBe(KEY);

    const missing = reduce(started, { type: "query-not-found" });
    expect(missing.query.status).toBe("missing");
    expect(missing.query.record).toBeUndefined();

    const failed = reduce(started, {
      type: "query-failed",
      error: { category: "network", message: "x" },
    });
    expect(failed.query.status).toBe("failed");
    expect(failed.query.error?.category).toBe("network");
  });
});

describe("ARKIV_ENTITY_TAG linkage", () => {
  it("references the shared entity tag", () => {
    expect(ARKIV_ENTITY_TAG).toBe("blocklab.experiment");
  });
});
