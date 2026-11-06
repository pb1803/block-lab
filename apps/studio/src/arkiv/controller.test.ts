import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import { describe, expect, it, vi } from "vitest";
import { ArkivController } from "./controller.js";
import {
  type ArkivGateway,
  MalformedRecordError,
  type PublishResult,
} from "./gateway.js";
import { arkivRecordFromRow } from "./record.js";
import { ENTITY_KEY, makeRow, sampleMetadata } from "./test-fixtures.js";
import type { ArkivRecord, RecordSummary } from "./types.js";
import { initialState } from "./types.js";

const RABDI = "0x76edaf";
const OWNER = "0xD431714db82331B07697Ea4675334C3AF6d2EBE9";
const NEW_OWNER = "0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759";

type FakeOptions = {
  readonly existing?: string | null;
  readonly existingAfterFailure?: string | null;
  readonly publishError?: unknown;
  readonly readRecord?: () => Promise<ArkivRecord>;
  readonly queryError?: unknown;
  readonly records?: readonly RecordSummary[];
  readonly preflightError?: unknown;
  /** Owner reported by readOwnership; the second read flips to `ownerAfter`. */
  readonly owner?: string;
  readonly ownerAfter?: string;
  /** 1-based read count from which `ownerAfter` is reported. */
  readonly ownerAfterFromCall?: number;
  readonly creator?: string;
  readonly transferError?: unknown;
};

function fakeGateway(options: FakeOptions = {}) {
  const calls = {
    find: 0,
    publish: 0,
    read: 0,
    query: 0,
    readOwnership: 0,
    transfer: 0,
  };
  const owner = options.owner ?? OWNER;
  const validRecord = (): ArkivRecord => {
    const decoded = arkivRecordFromRow(makeRow());
    if (!decoded.ok) throw new Error("fixture invalid");
    return decoded.record;
  };
  const gateway: ArkivGateway = {
    async findExperiment() {
      calls.find += 1;
      if (options.preflightError !== undefined) throw options.preflightError;
      const afterFailure = options.existingAfterFailure;
      const key =
        calls.find > 1 && afterFailure !== undefined
          ? afterFailure
          : (options.existing ?? null);
      return { entityKey: key === null ? null : (key as never) };
    },
    async publishExperiment(): Promise<PublishResult> {
      calls.publish += 1;
      if (options.publishError !== undefined) throw options.publishError;
      return {
        entityKey: ENTITY_KEY as never,
        txHash: "0xfeed" as never,
        expiresAtBlock: 571_599n,
      };
    },
    async readRecord() {
      calls.read += 1;
      if (options.readRecord !== undefined) return options.readRecord();
      return validRecord();
    },
    async queryBy() {
      calls.query += 1;
      if (options.queryError !== undefined) throw options.queryError;
      return options.records ?? [];
    },
    async currentBlock() {
      return 269_199n;
    },
    async readOwnership() {
      calls.readOwnership += 1;
      const reported =
        options.ownerAfter !== undefined &&
        calls.readOwnership >= (options.ownerAfterFromCall ?? 2)
          ? options.ownerAfter
          : owner;
      return {
        owner: reported as never,
        creator: (options.creator ?? OWNER) as never,
        expiresAtBlock: 571_599n,
        payloadHex: "0x7b7d",
      };
    },
    async transferOwnership() {
      calls.transfer += 1;
      if (options.transferError !== undefined) throw options.transferError;
      return "0xbeef" as never;
    },
  };
  return { gateway, calls };
}

function connected(gateway: ArkivGateway, metadata?: ExperimentMetadata) {
  const controller = new ArkivController({ gateway });
  controller.walletConnected("0xa" as never, RABDI as never);
  if (metadata !== undefined) controller.loadRecord(metadata);
  return controller;
}

function missingEntityError(): Error {
  const error = new Error("No live entity with that key.");
  error.name = "NoEntityFoundError";
  return error;
}

describe("publish — happy path", () => {
  it("preflights, signs once, confirms, then verifies the read-back", async () => {
    const { gateway, calls } = fakeGateway();
    const controller = connected(gateway, sampleMetadata());
    await controller.publish();
    expect(calls.find).toBe(1);
    expect(calls.publish).toBe(1);
    expect(controller.state.publish.phase).toBe("confirmed");
    expect(controller.state.publish.entityKey).toBe(ENTITY_KEY);
    expect(controller.state.publish.readBack?.outcome).toBe("verified");
  });

  it("does not publish when the wallet is not connected", async () => {
    const { gateway, calls } = fakeGateway();
    const controller = new ArkivController({ gateway });
    controller.loadRecord(sampleMetadata());
    await controller.publish();
    expect(calls.publish).toBe(0);
    expect(controller.state.publish.phase).toBe("failed");
    expect(controller.state.publish.error?.category).not.toBe("unknown");
  });
});

describe("publish — duplicate and preflight", () => {
  it("stops at an existing entity without signing", async () => {
    const { gateway, calls } = fakeGateway({ existing: ENTITY_KEY });
    const controller = connected(gateway, sampleMetadata());
    await controller.publish();
    expect(calls.publish).toBe(0);
    expect(controller.state.publish.phase).toBe("existing");
    expect(controller.state.publish.error?.category).toBe("duplicate");
  });

  it("refuses to sign when the duplicate check itself fails", async () => {
    const { gateway, calls } = fakeGateway({
      preflightError: new Error("429 Too Many Requests"),
    });
    const controller = connected(gateway, sampleMetadata());
    await controller.publish();
    expect(calls.publish).toBe(0);
    expect(controller.state.publish.phase).toBe("failed");
    expect(controller.state.publish.error?.category).toBe("network");
  });
});

describe("publish — rejection and uncertainty", () => {
  it("reports a wallet rejection as user-rejected without retrying", async () => {
    const rejected = new Error("User rejected the request.");
    Object.assign(rejected, { code: 4001 });
    const { gateway, calls } = fakeGateway({ publishError: rejected });
    const controller = connected(gateway, sampleMetadata());
    await controller.publish();
    expect(calls.publish).toBe(1);
    expect(controller.state.publish.phase).toBe("failed");
    expect(controller.state.publish.error?.category).toBe("user-rejected");
  });

  it("re-checks after an uncertain failure and never re-signs", async () => {
    const { gateway, calls } = fakeGateway({
      publishError: new Error("fetch failed"),
      existingAfterFailure: ENTITY_KEY,
    });
    const controller = connected(gateway, sampleMetadata());
    await controller.publish();
    expect(calls.publish).toBe(1);
    expect(controller.state.publish.phase).toBe("failed");
    expect(controller.state.publish.entityKey).toBe(ENTITY_KEY);
    expect(controller.state.publish.error?.message).toContain(
      "Nothing was re-signed",
    );
  });

  it("fails closed on credential-shaped metadata before any gateway call", async () => {
    const leaked = { ...sampleMetadata(), evidenceRef: "api_key=abc" };
    const { gateway, calls } = fakeGateway();
    const controller = connected(gateway, leaked);
    await controller.publish();
    expect(calls.find).toBe(0);
    expect(calls.publish).toBe(0);
    expect(controller.state.publish.error?.category).toBe("validation");
  });
});

describe("publish — races", () => {
  it("ignores a confirmation that lands after a disconnect", async () => {
    let release: (() => void) | undefined;
    const { gateway } = fakeGateway();
    const original = gateway.publishExperiment.bind(gateway);
    const gated: ArkivGateway = {
      ...gateway,
      publishExperiment: async (metadata) => {
        release ??= () => {
          /* assigned below on first await */
        };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original(metadata);
      },
    };
    const controller = connected(gated, sampleMetadata());
    const inFlight = controller.publish();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.walletDisconnected();
    release?.();
    await inFlight;
    expect(controller.state.publish.phase).toBe("idle");
    expect(controller.state.publish.entityKey).toBeUndefined();
  });
});

describe("history", () => {
  it("separates a genuine empty result from a failed query", async () => {
    const { gateway } = fakeGateway();
    const controller = connected(gateway);
    await controller.search("status", " passed ");
    expect(controller.state.history.phase).toBe("empty");
    expect(vi.mocked(gateway.queryBy)).toBeDefined();

    const failing = connected(
      fakeGateway({ queryError: new Error("429 rate limit") }).gateway,
    );
    await failing.search("status", "passed");
    expect(failing.state.history.phase).toBe("failed");
    expect(failing.state.history.error?.category).toBe("network");
  });

  it("stores matched rows", async () => {
    const record: RecordSummary = {
      entityKey: ENTITY_KEY as never,
      experimentId: "poc-write-001",
      scenarioName: "RPC blackout",
      status: "passed",
      startedAtMs: 1_793_924_125_113,
    };
    const controller = connected(fakeGateway({ records: [record] }).gateway);
    await controller.search("experimentId", "poc-write-001");
    expect(controller.state.history.phase).toBe("ok");
    expect(controller.state.history.records).toHaveLength(1);
  });
});

describe("detail", () => {
  it("opens a valid record", async () => {
    const controller = connected(fakeGateway().gateway);
    await controller.openRecord(ENTITY_KEY as never);
    expect(controller.state.detail.phase).toBe("ok");
    expect(controller.state.detail.record?.metadata.experimentId).toBe(
      "poc-write-001",
    );
  });

  it("reports a missing entity as missing", async () => {
    const controller = connected(
      fakeGateway({
        readRecord: async () => {
          throw missingEntityError();
        },
      }).gateway,
    );
    await controller.openRecord(ENTITY_KEY as never);
    expect(controller.state.detail.phase).toBe("missing");
  });

  it("reports a malformed entity as malformed, not as a record", async () => {
    const controller = connected(
      fakeGateway({
        readRecord: async () => {
          throw new MalformedRecordError(
            "payload is not a valid BLOCKLAB record",
          );
        },
      }).gateway,
    );
    await controller.openRecord(ENTITY_KEY as never);
    expect(controller.state.detail.phase).toBe("malformed");
  });

  it("reports an RPC failure as failed", async () => {
    const controller = connected(
      fakeGateway({
        readRecord: async () => {
          throw new Error("fetch failed");
        },
      }).gateway,
    );
    await controller.openRecord(ENTITY_KEY as never);
    expect(controller.state.detail.phase).toBe("failed");
    expect(controller.state.detail.error?.category).toBe("network");
  });
});

describe("initial state", () => {
  it("starts without a wallet or record", () => {
    const state = initialState();
    expect(state.wallet.status).toBe("missing");
    expect(state.publish.phase).toBe("idle");
    expect(state.history.records).toEqual([]);
  });
});

describe("transfer — staging", () => {
  function transferController(options: FakeOptions = {}) {
    const { gateway, calls } = fakeGateway(options);
    const controller = new ArkivController({ gateway });
    controller.walletConnected(OWNER as never, RABDI as never);
    return { controller, calls };
  }

  it("previews against a live read and signs nothing", async () => {
    const { controller, calls } = transferController();
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    expect(calls.transfer).toBe(0);
    expect(controller.state.transfer.phase).toBe("preview");
    expect(controller.state.transfer.before?.owner).toBe(OWNER);
    expect(controller.state.transfer.newOwner).toBe(NEW_OWNER);
  });

  it("accepts the lowercase account a wallet actually reports", async () => {
    const { gateway } = fakeGateway();
    const controller = new ArkivController({ gateway });
    controller.walletConnected(OWNER.toLowerCase() as never, RABDI as never);
    await controller.previewTransfer(
      ENTITY_KEY as never,
      NEW_OWNER.toLowerCase(),
    );
    expect(controller.state.transfer.phase).toBe("preview");
  });

  it("blocks a wallet that is not the owner", async () => {
    const { gateway } = fakeGateway();
    const controller = new ArkivController({ gateway });
    controller.walletConnected(
      "0x9999999999999999999999999999999999999999" as never,
      RABDI as never,
    );
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    expect(controller.state.transfer.phase).toBe("failed");
    expect(controller.state.transfer.error?.message).toMatch(/not the owner/);
  });

  it("blocks on the wrong network without switching", async () => {
    const { gateway } = fakeGateway();
    const controller = new ArkivController({ gateway });
    controller.walletConnected(OWNER as never, "0x1" as never);
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    expect(controller.state.transfer.error?.message).toMatch(/0x76edaf/);
  });

  it("requires a preview before confirming", async () => {
    const { controller, calls } = transferController();
    await controller.submitTransfer();
    expect(calls.transfer).toBe(0);
    expect(controller.state.transfer.error?.message).toMatch(/Preview/);
  });
});

describe("transfer — submitting", () => {
  function staged(options: FakeOptions = {}) {
    const { gateway, calls } = fakeGateway(options);
    const controller = new ArkivController({ gateway });
    controller.walletConnected(OWNER as never, RABDI as never);
    return { controller, calls };
  }

  it("sends exactly one transfer and verifies the read-back", async () => {
    const { controller, calls } = staged({
      ownerAfter: NEW_OWNER,
      ownerAfterFromCall: 3,
    });
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(calls.transfer).toBe(1);
    expect(controller.state.transfer.phase).toBe("confirmed");
    expect(controller.state.transfer.readBack?.ok).toBe(true);
    expect(controller.state.transfer.txHash).toBe("0xbeef");
  });

  it("reports a wallet rejection and does not retry", async () => {
    const rejection = Object.assign(new Error("User rejected"), { code: 4001 });
    const { controller, calls } = staged({ transferError: rejection });
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(calls.transfer).toBe(1);
    expect(controller.state.transfer.phase).toBe("failed");
    expect(controller.state.transfer.error?.category).toBe("user-rejected");
  });

  it("reports an uncertain outcome as landed when the owner moved", async () => {
    const { controller } = staged({
      transferError: new Error("receipt timeout"),
      ownerAfter: NEW_OWNER,
      ownerAfterFromCall: 3,
    });
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(controller.state.transfer.error?.message).toMatch(/it landed/);
    // The verdict is still reported, so the panel shows what the chain says.
    expect(controller.state.transfer.readBack?.ok).toBe(true);
  });

  it("reports an uncertain outcome as not landed when the owner is unchanged", async () => {
    const { controller, calls } = staged({
      transferError: new Error("receipt timeout"),
    });
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(calls.transfer).toBe(1);
    expect(controller.state.transfer.error?.message).toMatch(/still owned by/);
    expect(controller.state.transfer.readBack?.ok).toBe(false);
  });

  it("refuses to send when the owner changed after the preview", async () => {
    const { controller, calls } = staged({
      ownerAfter: NEW_OWNER,
      ownerAfterFromCall: 2,
    });
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(calls.transfer).toBe(0);
    expect(controller.state.transfer.error?.message).toMatch(/preview again/);
    // The refreshed owner is staged, so a second preview is not stale.
    expect(controller.state.transfer.before?.owner).toBe(NEW_OWNER);
  });

  it("flags a mismatched read-back instead of claiming success", async () => {
    // The transfer resolves but the owner never changed on read-back.
    const { controller } = staged();
    await controller.previewTransfer(ENTITY_KEY as never, NEW_OWNER);
    await controller.submitTransfer();
    expect(controller.state.transfer.phase).toBe("confirmed");
    expect(controller.state.transfer.readBack?.ok).toBe(false);
  });
});
