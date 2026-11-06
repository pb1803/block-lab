import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  compareOwnership,
  isZeroAddress,
  normalizeAddress,
  type OwnershipSnapshot,
  ownershipRole,
  transferBlockReason,
  transferCaveats,
  transferPreviewRows,
} from "./ownership.js";

const OWNER = "0xD431714db82331B07697Ea4675334C3AF6d2EBE9" as Address;
const OTHER = "0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759" as Address;
const KEY = `0x${"ab".repeat(32)}` as Hex;

const snapshot = (
  over: Partial<OwnershipSnapshot> = {},
): OwnershipSnapshot => ({
  entityKey: KEY,
  owner: OWNER,
  creator: OWNER,
  expiresAtBlock: 900n,
  payloadHex: "0x7b7d",
  ...over,
});

const connected = (address: Address = OWNER) => ({
  status: "connected" as const,
  address,
  chainIdHex: "0x76edaf" as Hex,
});

describe("normalizeAddress / isZeroAddress", () => {
  it("checksums a valid address and rejects junk", () => {
    expect(normalizeAddress(OWNER.toLowerCase())).toBe(OWNER);
    expect(normalizeAddress("  0xabc  ")).toBeNull();
    expect(normalizeAddress("")).toBeNull();
  });

  it("recognises the zero address", () => {
    expect(isZeroAddress(`0x${"0".repeat(40)}` as Address)).toBe(true);
    expect(isZeroAddress(OWNER)).toBe(false);
  });
});

describe("ownershipRole", () => {
  it("separates owner from creator", () => {
    expect(ownershipRole(snapshot(), OWNER)).toMatchObject({
      isOwner: true,
      isCreator: true,
    });
    const creatorOnly = ownershipRole(snapshot({ owner: OTHER }), OWNER);
    expect(creatorOnly.isOwner).toBe(false);
    expect(creatorOnly.isCreator).toBe(true);
    expect(creatorOnly.summary).toMatch(/no longer its owner/);
    // An owner who did not create it can still transfer — ownership is what counts.
    expect(ownershipRole(snapshot({ creator: OTHER }), OWNER).isOwner).toBe(
      true,
    );
    expect(ownershipRole(snapshot({ owner: OTHER }), OTHER).isOwner).toBe(true);
  });

  it("recognises the owner through a lowercased wallet account", () => {
    // MetaMask reports accounts lowercased; the chain reports them checksummed.
    const role = ownershipRole(snapshot(), OWNER.toLowerCase() as Address);
    expect(role.isOwner).toBe(true);
    expect(role.isCreator).toBe(true);
    // Mixed case in either direction must not register as a different address.
    expect(
      ownershipRole(snapshot({ owner: OWNER.toLowerCase() as Address }), OWNER)
        .isOwner,
    ).toBe(true);
    // ... and a genuinely different address still must.
    expect(
      ownershipRole(snapshot({ owner: OTHER.toLowerCase() as Address }), OWNER)
        .isOwner,
    ).toBe(false);
  });

  it("says so when nothing is connected", () => {
    expect(ownershipRole(snapshot(), undefined).summary).toMatch(/No account/);
  });
});

describe("transferBlockReason", () => {
  const base = { snapshot: snapshot(), newOwner: OTHER, currentBlock: 800n };

  it("blocks without a wallet, while disconnected and on the wrong network", () => {
    const missing = {
      status: "missing" as const,
      address: undefined,
      chainIdHex: undefined,
    };
    const disconnected = { ...missing, status: "disconnected" as const };
    const wrong = { ...connected(), status: "wrong-network" as const };
    expect(transferBlockReason({ ...base, wallet: missing })?.category).toBe(
      "wrong-network",
    );
    expect(
      transferBlockReason({ ...base, wallet: disconnected })?.message,
    ).toMatch(/Connect/);
    expect(transferBlockReason({ ...base, wallet: wrong })?.message).toMatch(
      /0x76edaf/,
    );
  });

  it("blocks when no entity is open", () => {
    expect(
      transferBlockReason({ ...base, wallet: connected(), snapshot: null })
        ?.message,
    ).toMatch(/Open an existing entity/);
  });

  it("blocks an expired entity", () => {
    expect(
      transferBlockReason({ ...base, wallet: connected(), currentBlock: 1000n })
        ?.category,
    ).toBe("expired");
  });

  it("blocks a wallet that is not the owner", () => {
    const reason = transferBlockReason({ ...base, wallet: connected(OTHER) });
    expect(reason?.message).toMatch(/not the owner/);
  });

  it("blocks a bad recipient, the zero address and the current owner", () => {
    expect(
      transferBlockReason({ ...base, wallet: connected(), newOwner: "0xnope" })
        ?.category,
    ).toBe("validation");
    expect(
      transferBlockReason({
        ...base,
        wallet: connected(),
        newOwner: `0x${"0".repeat(40)}`,
      })?.message,
    ).toMatch(/zero address/);
    expect(
      transferBlockReason({ ...base, wallet: connected(), newOwner: OWNER })
        ?.message,
    ).toMatch(/already the owner/);
  });

  it("accepts a lowercased signer and a lowercased recipient", () => {
    expect(
      transferBlockReason({
        ...base,
        wallet: connected(OWNER.toLowerCase() as Address),
        newOwner: OTHER.toLowerCase(),
      }),
    ).toBeNull();
    // Same owner in another case still counts as "already the owner".
    expect(
      transferBlockReason({
        ...base,
        wallet: connected(),
        newOwner: OWNER.toLowerCase(),
      })?.message,
    ).toMatch(/already the owner/);
  });

  it("allows the happy path", () => {
    expect(transferBlockReason({ ...base, wallet: connected() })).toBeNull();
  });
});

describe("transferPreviewRows / transferCaveats", () => {
  it("states what changes and what does not", () => {
    const rows = transferPreviewRows({
      snapshot: snapshot(),
      signer: OWNER,
      newOwner: OTHER,
    });
    const labels = rows.map((row) => row.label);
    expect(labels).toContain("Creator (unchanged)");
    expect(labels).toContain("Expiry (unchanged)");
    expect(rows.find((row) => row.label === "Owner after")?.value).toBe(OTHER);
    expect(
      rows.find((row) => row.label === "Signer (must be the owner)")?.value,
    ).toBe(OWNER);
  });

  it("marks an owner who is not the creator", () => {
    const rows = transferPreviewRows({
      snapshot: snapshot({ creator: OTHER }),
      signer: OWNER,
      newOwner: OTHER,
    });
    expect(rows.find((row) => row.label === "Your role")?.value).toBe(
      "owner (not creator)",
    );
  });

  it("says the recipient does not accept", () => {
    expect(transferCaveats().join(" ")).toMatch(/does not accept/);
  });
});

describe("compareOwnership", () => {
  it("passes a clean transfer", () => {
    const verdict = compareOwnership(
      snapshot(),
      snapshot({ owner: OTHER }),
      OTHER,
    );
    expect(verdict.ok).toBe(true);
  });

  it("fails when the owner did not move", () => {
    const verdict = compareOwnership(snapshot(), snapshot(), OTHER);
    expect(verdict.ok).toBe(false);
    expect(
      verdict.checks.find((check) => check.name.includes("actually changed"))
        ?.ok,
    ).toBe(false);
  });

  it("fails when the creator changed", () => {
    const verdict = compareOwnership(
      snapshot(),
      snapshot({ owner: OTHER, creator: OTHER }),
      OTHER,
    );
    expect(verdict.ok).toBe(false);
    expect(
      verdict.checks.find((check) => check.name.includes("creator"))?.ok,
    ).toBe(false);
  });

  it("fails when the expiry or payload changed", () => {
    expect(
      compareOwnership(
        snapshot(),
        snapshot({ owner: OTHER, expiresAtBlock: 1n }),
        OTHER,
      ).ok,
    ).toBe(false);
    expect(
      compareOwnership(
        snapshot(),
        snapshot({ owner: OTHER, payloadHex: "0x00" }),
        OTHER,
      ).ok,
    ).toBe(false);
  });
});
