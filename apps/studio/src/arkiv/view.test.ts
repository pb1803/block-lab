import { describe, expect, it } from "vitest";
import { arkivRecordFromRow } from "./record.js";
import { makeRow, payloadHex, sampleMetadata } from "./test-fixtures.js";
import type { ArkivRecord } from "./types.js";
import { initialState } from "./types.js";
import {
  DETAIL_DISCLAIMER,
  detailRows,
  detailView,
  historyView,
  publishView,
  studioArkivView,
  walletView,
} from "./view.js";

const RABDI = "0x76edaf";

function asArkiv(): ArkivRecord {
  const decoded = arkivRecordFromRow(makeRow());
  if (!decoded.ok) throw new Error("fixture invalid");
  return decoded.record;
}

describe("walletView", () => {
  it("explains missing vs connected vs wrong network", () => {
    const missing = walletView({
      ...initialState(),
      wallet: { status: "missing", address: undefined, chainIdHex: undefined },
    });
    expect(missing.statusText).toContain("No EIP-1193 wallet");

    const wrongNetwork = walletView({
      ...initialState(),
      wallet: {
        status: "wrong-network",
        address: "0x8888888888888888888888888888888888888888",
        chainIdHex: "0x1",
      },
    });
    expect(wrongNetwork.showSwitch).toBe(true);
    expect(wrongNetwork.chainLine).toContain("0x1");

    const connected = walletView({
      ...initialState(),
      wallet: { status: "connected", address: "0xa", chainIdHex: RABDI },
    });
    expect(connected.statusText).toContain("Studio never sees a key");
    expect(connected.chainLine).toContain(RABDI);
  });

  it("offers exactly the wallet actions the state allows", () => {
    const missing = walletView({
      ...initialState(),
      wallet: { status: "missing", address: undefined, chainIdHex: undefined },
    });
    expect([
      missing.showConnect,
      missing.showDetect,
      missing.showSwitch,
    ]).toEqual([false, true, false]);

    // The regression: a disconnected wallet must offer Connect.
    const disconnected = walletView({
      ...initialState(),
      wallet: {
        status: "disconnected",
        address: undefined,
        chainIdHex: undefined,
      },
    });
    expect([
      disconnected.showConnect,
      disconnected.showDetect,
      disconnected.showSwitch,
    ]).toEqual([true, false, false]);

    const wrongNetwork = walletView({
      ...initialState(),
      wallet: {
        status: "wrong-network",
        address: "0x8888888888888888888888888888888888888888",
        chainIdHex: "0x1",
      },
    });
    expect([wrongNetwork.showConnect, wrongNetwork.showSwitch]).toEqual([
      false,
      true,
    ]);
    expect(wrongNetwork.canDisconnect).toBe(true);

    const connected = walletView({
      ...initialState(),
      wallet: { status: "connected", address: "0xa", chainIdHex: RABDI },
    });
    expect([
      connected.showConnect,
      connected.showDetect,
      connected.showSwitch,
    ]).toEqual([false, false, false]);
    expect(connected.canDisconnect).toBe(true);
  });
});

describe("publishView", () => {
  it("blocks publish unless connected on Rabdi with a loaded record", () => {
    const missingView = publishView(initialState());
    expect(missingView.canPublish).toBe(false);

    const connected = {
      ...initialState(),
      wallet: { status: "connected", address: "0xa", chainIdHex: RABDI },
      publish: { ...initialState().publish, metadata: sampleMetadata() },
    };
    expect(publishView(connected).canPublish).toBe(true);

    const wrongNetwork = {
      ...connected,
      wallet: { status: "wrong-network", address: "0xa", chainIdHex: "0x1" },
    };
    expect(publishView(wrongNetwork).canPublish).toBe(false);
  });

  it("shows the confirmed result and honest read-back wording", () => {
    const confirmed = {
      ...initialState(),
      wallet: { status: "connected", address: "0xa", chainIdHex: RABDI },
      publish: {
        phase: "confirmed" as const,
        metadata: sampleMetadata(),
        entityKey: "0xbb",
        txHash: "0xcc",
        expiresAtBlock: 571_599n,
        error: undefined,
        readBack: { outcome: "verified" as const, detail: "byte-identical" },
      },
    };
    const view = publishView(confirmed);
    expect(view.phaseText).toContain("Confirmed in a block");
    expect(view.resultRows.map((row) => row.label)).toContain("Entity key");
    expect(view.readBackTone).toBe("ok");
  });

  it("hides the error line for success phases", () => {
    const existing = {
      ...initialState(),
      publish: {
        phase: "existing" as const,
        metadata: sampleMetadata(),
        entityKey: "0xbb",
        txHash: undefined,
        expiresAtBlock: undefined,
        error: undefined,
        readBack: undefined,
      },
    };
    expect(publishView(existing).error).toBeUndefined();
    expect(publishView(existing).phaseText).toContain(
      "No new transaction was sent",
    );
  });
});

describe("historyView", () => {
  it("distinguishes empty, results and failure", () => {
    const empty = {
      ...initialState(),
      history: {
        phase: "empty" as const,
        query: { field: "status" as const, value: "passed" },
        records: [],
        error: undefined,
      },
    };
    expect(historyView(empty).phaseText).toContain("No records match");

    const ok = {
      ...initialState(),
      history: {
        phase: "ok" as const,
        query: undefined,
        records: [
          {
            entityKey: "0xbb",
            experimentId: "poc-write-001",
            scenarioName: "RPC blackout",
            status: "passed",
            startedAtMs: 1,
          },
        ],
        error: undefined,
      },
    };
    expect(historyView(ok).phaseText).toContain("1 record matched");

    const failed = {
      ...initialState(),
      history: {
        phase: "failed" as const,
        query: undefined,
        records: [],
        error: { category: "network", message: "429" },
      },
    };
    expect(historyView(failed).phaseText).toContain("could not be completed");
  });
});

describe("detailView", () => {
  it("renders every allowlisted field plus system metadata without substitutes", () => {
    const record = asArkiv();
    const view = detailView({
      ...initialState(),
      detail: { phase: "ok", entityKey: "0xbb", record, error: undefined },
    });
    const labels = detailRows(record).map((row) => row.label);
    expect(labels).toContain("Owner");
    expect(labels).toContain("Creator");
    expect(labels).toContain("Evidence digest (sha256)");
    expect(view.disclaimer).toContain(
      "does not prove the execution was trustworthy on its own",
    );
    expect(DETAIL_DISCLAIMER).toContain(
      "The detailed traces and evidence remain local",
    );
  });

  it("explains missing and malformed states honestly", () => {
    const missing = detailView({
      ...initialState(),
      detail: {
        phase: "missing",
        entityKey: "0xbb",
        record: undefined,
        error: undefined,
      },
    });
    expect(missing.phaseText).toContain(
      "never created, or it has been deleted or has expired",
    );
    const malformed = detailView({
      ...initialState(),
      detail: {
        phase: "malformed",
        entityKey: "0xbb",
        record: undefined,
        error: { category: "malformed-response", message: "x" },
      },
    });
    expect(malformed.phaseText).toContain("Nothing is displayed as fact");
  });
});

void payloadHex;

describe("transferView", () => {
  const key = "0xaaaa" as const;
  const owner = "0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759" as const;
  const newOwner = "0x2222222222222222222222222222222222222222" as const;
  const before = {
    entityKey: key,
    owner,
    creator: owner,
    expiresAtBlock: 900n,
    payloadHex: "0x7b7d" as const,
  };

  it("explains the idle state and enables nothing", () => {
    const view = studioArkivView(initialState());
    expect(view.transfer.phaseText).toContain("No transfer staged");
    expect(view.transfer.canConfirm).toBe(false);
    expect(view.transfer.rows).toHaveLength(0);
  });

  it("renders the preview rows and the caveats", () => {
    const base = initialState();
    const view = studioArkivView({
      ...base,
      wallet: { ...base.wallet, status: "connected", address: owner },
      transfer: {
        phase: "preview",
        newOwner,
        before,
        txHash: undefined,
        after: undefined,
        readBack: undefined,
        error: undefined,
      },
    });
    expect(view.transfer.canConfirm).toBe(true);
    expect(view.transfer.rows.map((row) => row.label)).toContain("Owner after");
    expect(view.transfer.caveats.length).toBeGreaterThan(0);
    expect(view.transfer.phaseTone).toBe("warn");
  });

  it("reports a failed read-back", () => {
    const base = initialState();
    const view = studioArkivView({
      ...base,
      transfer: {
        ...base.transfer,
        phase: "confirmed",
        readBack: {
          ok: false,
          checks: [
            { name: "the owner is the recipient", ok: false, detail: "x" },
          ],
        },
      },
    });
    expect(view.transfer.readBackTone).toBe("error");
    expect(view.transfer.readBackLine).toContain("Read-back failed");
  });
});
