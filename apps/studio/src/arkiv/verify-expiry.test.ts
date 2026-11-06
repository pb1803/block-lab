import { describe, expect, it } from "vitest";
import {
  buildExpiryEvidence,
  classifyExpiryLookup,
  type ExpiryLookup,
  type ExpiryVerificationInput,
} from "./verify-expiry.ts";

const KEY =
  "0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb";
const TX = `0x${"ab".repeat(32)}`;
const OWNER = "0xC58Caf332c90B90bfcD2D5021F7Ff6e7880B8759";

const network = { name: "rabdi", chainId: 7_794_095, chainIdHex: "0x76edaf" };

const missing: ExpiryLookup = {
  state: "missing",
  error: `No live entity with key ${KEY}. It was never created, or it has been deleted or has expired.`,
};

const receipt = {
  status: "success" as const,
  blockNumber: 300_000,
  gasUsed: 150_000,
  effectiveGasPriceWei: "1000000000",
};

const created = {
  entityKey: KEY,
  owner: OWNER,
  expiresAt: 300_005n,
  creationFlags: 0,
};

function input(
  overrides: Partial<ExpiryVerificationInput> = {},
): ExpiryVerificationInput {
  return {
    entityKey: KEY,
    txHash: TX,
    receipt,
    entityCreated: created,
    expiresAtBlock: 300_005n,
    headBlock: 300_005n,
    lookup: missing,
    network,
    explorerBase: "https://rabdi.explorer.arkiv.network",
    ...overrides,
  };
}

describe("buildExpiryEvidence", () => {
  it("verifies a documented missing result at the deadline, from the creation event", () => {
    const evidence = buildExpiryEvidence(input());
    expect(evidence.verdict).toBe("expected-expired");
    expect(evidence.verified).toBe(true);
    expect(evidence.lookupState).toBe("missing");
    expect(evidence.expiresAtBlock).toBe(300_005);
    expect(evidence.createdAtBlock).toBe(300_000);
    expect(evidence.owner).toBe(OWNER);
    expect(evidence.createdAtFromEvent).toBe(true);
    expect(evidence.checks.every((check) => check.ok)).toBe(true);
  });

  it("treats head exactly at the expiry block as past the deadline", () => {
    const evidence = buildExpiryEvidence(input({ headBlock: 300_005n }));
    expect(evidence.verified).toBe(true);
    expect(
      evidence.checks.find((check) =>
        check.name.startsWith("head is at or past"),
      )?.ok,
    ).toBe(true);
  });

  it("refuses a missing result before the deadline", () => {
    const evidence = buildExpiryEvidence(input({ headBlock: 300_004n }));
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("prematurely-missing");
    expect(
      evidence.checks.find(
        (check) => check.name === "missing result is not premature",
      )?.ok,
    ).toBe(false);
  });

  it("refuses an entity that is still readable past the deadline", () => {
    const evidence = buildExpiryEvidence(
      input({ headBlock: 300_100n, lookup: { state: "live" } }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("unexpectedly-live");
    expect(evidence.lookupError).toBeNull();
  });

  it("calls a still-live entity inside its window merely not-yet-expired", () => {
    const evidence = buildExpiryEvidence(
      input({ headBlock: 300_002n, lookup: { state: "live" } }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("not-yet-expired");
  });

  it("distinguishes an entity that vanished before its deadline", () => {
    const evidence = buildExpiryEvidence(input({ headBlock: 300_001n }));
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("prematurely-missing");
    expect(
      evidence.checks.find(
        (check) => check.name === "missing result is not premature",
      )?.detail,
    ).toContain("has not been reached");
  });

  it("does not let a transport failure attest expiry", () => {
    const evidence = buildExpiryEvidence(
      input({
        headBlock: 300_100n,
        lookup: { state: "transport", error: "RequestError: fetch failed" },
      }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("transport-failure");
    expect(
      evidence.checks.find(
        (check) => check.name === "lookup was not a transport failure",
      )?.ok,
    ).toBe(false);
  });

  it("refuses a missing result when the deadline was never established", () => {
    const evidence = buildExpiryEvidence(
      input({
        txHash: null,
        receipt: undefined,
        entityCreated: undefined,
        expiresAtBlock: null,
      }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("expiry-unknown");
    expect(
      evidence.checks.find((check) => check.name === "expiry block known")?.ok,
    ).toBe(false);
  });

  it("accepts an explicit --expires-at without a creation receipt", () => {
    const evidence = buildExpiryEvidence(
      input({ txHash: null, receipt: undefined, entityCreated: undefined }),
    );
    expect(evidence.verdict).toBe("expected-expired");
    expect(evidence.verified).toBe(true);
    expect(evidence.createdAtBlock).toBeNull();
    expect(evidence.createdAtFromEvent).toBe(false);
    expect(evidence.owner).toBeNull();
  });

  it("cannot call an expiry proven when the creation receipt reverted", () => {
    const evidence = buildExpiryEvidence(
      input({ receipt: { ...receipt, status: "reverted" } }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("creation-unproven");
    expect(
      evidence.checks.find(
        (check) => check.name === "creation receipt succeeded",
      )?.ok,
    ).toBe(false);
  });

  it("cannot call an expiry proven when the creation receipt is unreadable", () => {
    const evidence = buildExpiryEvidence(
      input({ receipt: undefined, entityCreated: undefined }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.verdict).toBe("creation-unproven");
    expect(
      evidence.checks.find((check) => check.name === "creation receipt read")
        ?.ok,
    ).toBe(false);
  });

  it("rejects an EntityCreated event for another key", () => {
    const evidence = buildExpiryEvidence(
      input({
        entityCreated: { ...created, entityKey: `0x${"cd".repeat(32)}` },
      }),
    );
    expect(evidence.verified).toBe(false);
    expect(
      evidence.checks.find(
        (check) => check.name === "EntityCreated matches this key",
      )?.ok,
    ).toBe(false);
  });

  it("carries the experiment id from the record and stays null without it", () => {
    expect(buildExpiryEvidence(input()).experimentId).toBeNull();
  });

  it("never reports verified when any single check fails", () => {
    const broken = buildExpiryEvidence(input({ headBlock: 300_000n }));
    expect(broken.checks.some((check) => !check.ok)).toBe(true);
    expect(broken.verified).toBe(false);
  });
});

describe("classifyExpiryLookup", () => {
  it("recognises the SDK missing error by name", () => {
    const error = new Error("anything");
    error.name = "NoEntityFoundError";
    expect(classifyExpiryLookup(error).state).toBe("missing");
  });

  it("recognises the documented message", () => {
    expect(
      classifyExpiryLookup(
        new Error(
          `No live entity with key ${KEY}. It was never created, or it has been deleted or has expired.`,
        ),
      ).state,
    ).toBe("missing");
  });

  it("classifies timeouts and rate limits as transport", () => {
    expect(
      classifyExpiryLookup(new Error("HttpRequestError: timeout")).state,
    ).toBe("transport");
    expect(classifyExpiryLookup(new Error("429 ANON_COST_LIMITED")).state).toBe(
      "transport",
    );
    expect(classifyExpiryLookup(new Error("ECONNRESET")).state).toBe(
      "transport",
    );
  });

  it("classifies a schema mismatch as malformed", () => {
    const error = new Error(
      "SchemaMismatchError: entity … does not match the schema",
    );
    expect(classifyExpiryLookup(error).state).toBe("malformed");
  });

  it("does not guess for anything else", () => {
    expect(classifyExpiryLookup(new Error("boom")).state).toBe("unreadable");
    expect(classifyExpiryLookup("not an error").state).toBe("unreadable");
  });
});
