/**
 * ARK-05 ownership logic, pure and DOM-free.
 *
 * Arkiv's model, as established from the installed SDK (see
 * `docs/arkiv-ark05.md` for the evidence and file references):
 *
 * - `owner` and `creator` are separate system attributes (`$owner`, `$creator`).
 *   `creator` is fixed at creation; `owner` is mutable.
 * - Ownership moves with the `TransferOwnership` operation (tag 4), payload
 *   `(bytes32 entityKey, address newOwner)` — it carries no expiry and no
 *   attributes, so a transfer changes the owner and nothing else.
 * - The current owner must sign: the engine reverts `NotOwner(entityKey,
 *   caller, owner)` otherwise.
 * - The recipient does not accept: there is no accept step in the SDK, only the
 *   guards `TransferToZeroAddress` and `TransferToSelf`.
 * - ReadOnly entities are still transferable; only their attributes are frozen.
 *
 * Everything here is a pure function so the rules are testable without a chain,
 * a DOM or a wallet.
 */
import type { Address, Hex } from "viem";
import { getAddress, isAddress, zeroAddress } from "viem";
import type { StudioError, WalletState } from "./types.js";

/** The ownership-relevant view of one entity, read from the gateway. */
export type OwnershipSnapshot = {
  readonly entityKey: Hex;
  readonly owner: Address;
  readonly creator: Address;
  readonly expiresAtBlock: bigint;
  /** The exact payload bytes (hex), so an unchanged payload can be proven unchanged. */
  readonly payloadHex: string;
};

export type TransferPhase =
  | "idle" // nothing entered
  | "preview" // previewed against a live read; nothing sent
  | "submitting" // wallet prompt requested
  | "confirming" // signed, waiting for the receipt
  | "confirmed" // receipt-backed transfer
  | "failed";

export type TransferState = {
  readonly phase: TransferPhase;
  readonly entityKey: Hex | undefined;
  readonly newOwner: Address | undefined;
  /** Ownership read immediately before the send; compared against the read-back. */
  readonly before: OwnershipSnapshot | undefined;
  readonly txHash: Hex | undefined;
  readonly after: OwnershipSnapshot | undefined;
  /** Post-confirmation comparison of before against after. */
  readonly readBack: ReadBackVerdict | undefined;
  readonly error: StudioError | undefined;
};

export type Check = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

export type ReadBackVerdict = {
  readonly ok: boolean;
  readonly checks: readonly Check[];
};

/** Normalises a user-typed address, or null when it is not one. */
export function normalizeAddress(input: string): Address | null {
  const trimmed = input.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  return getAddress(trimmed);
}

export function isZeroAddress(address: Address): boolean {
  return address.toLowerCase() === zeroAddress;
}

/**
 * Address equality that ignores case. The wallet supplies lowercase accounts
 * while a record reports the checksummed form, so a raw `===` marks the owner as
 * a stranger.
 */
export function sameAddress(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return a !== null && b !== null && a === b;
}

/**
 * Whether the connected account may transfer this entity, and why not. The
 * engine enforces this too (`NotOwner`); checking first turns a wasted wallet
 * popup into a plain explanation.
 */
export function ownershipRole(
  snapshot: Pick<OwnershipSnapshot, "owner" | "creator">,
  signer: Address | undefined,
): {
  readonly isOwner: boolean;
  readonly isCreator: boolean;
  readonly summary: string;
} {
  const isOwner = sameAddress(signer, snapshot.owner);
  const isCreator = sameAddress(signer, snapshot.creator);
  if (signer === undefined) {
    return { isOwner, isCreator, summary: "No account connected." };
  }
  if (isOwner && isCreator) {
    return {
      isOwner,
      isCreator,
      summary: "You are the owner and the creator, so you can transfer.",
    };
  }
  if (isOwner) {
    return {
      isOwner,
      isCreator,
      summary:
        "You are the owner but not the creator: the owner alone can transfer, so you can.",
    };
  }
  return {
    isOwner,
    isCreator,
    summary: isCreator
      ? "You created this entity but are no longer its owner, so you cannot transfer it."
      : "You are neither the owner nor the creator, so you cannot transfer it.",
  };
}

/** A reason a transfer cannot proceed, or null when it can. */
export function transferBlockReason(input: {
  readonly wallet: WalletState;
  readonly snapshot: OwnershipSnapshot | null;
  readonly newOwner: string;
  readonly currentBlock: bigint | null;
}): StudioError | null {
  const { wallet, snapshot } = input;
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
      message:
        "Switch the wallet to Rabdi (chain id 0x76edaf) first. No network is switched silently.",
    };
  }
  if (snapshot === null) {
    return {
      category: "validation",
      message: "Open an existing entity first; a transfer needs one.",
    };
  }
  if (
    input.currentBlock !== null &&
    snapshot.expiresAtBlock <= input.currentBlock
  ) {
    return {
      category: "expired",
      message: `The entity expired at block ${snapshot.expiresAtBlock} (head is ${input.currentBlock}), so it can no longer be transferred.`,
    };
  }
  if (!ownershipRole(snapshot, wallet.address).isOwner) {
    return {
      // Not a network problem: the connected account is simply not the owner.
      category: "validation",
      message: `The connected account ${wallet.address} is not the owner ${snapshot.owner}. A transfer must be signed by the current owner.`,
    };
  }
  const newOwner = normalizeAddress(input.newOwner);
  if (newOwner === null) {
    return {
      category: "validation",
      message: "Enter the recipient address as a 0x-prefixed 20-byte address.",
    };
  }
  if (isZeroAddress(newOwner)) {
    return {
      category: "validation",
      message: "The zero address cannot receive an entity.",
    };
  }
  if (sameAddress(newOwner, snapshot.owner)) {
    return {
      category: "validation",
      message: "The recipient is already the owner.",
    };
  }
  return null;
}

/**
 * What the confirmation shows before anything is signed. Deliberately states
 * what does *not* change, because a transfer is easy to misread as "hand over
 * the record to be edited".
 */
export function transferPreviewRows(input: {
  readonly snapshot: OwnershipSnapshot;
  readonly signer: Address;
  readonly newOwner: Address;
}): readonly { readonly label: string; readonly value: string }[] {
  const role = ownershipRole(input.snapshot, input.signer);
  return [
    { label: "Entity", value: input.snapshot.entityKey },
    { label: "Creator (unchanged)", value: input.snapshot.creator },
    { label: "Owner now", value: input.snapshot.owner },
    { label: "Owner after", value: input.newOwner },
    { label: "Signer (must be the owner)", value: input.signer },
    {
      label: "Your role",
      value: role.isCreator ? "owner and creator" : "owner (not creator)",
    },
    {
      label: "Expiry (unchanged)",
      value: `block ${input.snapshot.expiresAtBlock}`,
    },
    {
      label: "Payload (unchanged)",
      value: `${(input.snapshot.payloadHex.length - 2) / 2} bytes retained`,
    },
  ];
}

/** Facts about a transfer that surprise people, shown with the preview. */
export function transferCaveats(): readonly string[] {
  return [
    "The creator stays the original account for the entity's whole life; only the owner changes.",
    "The recipient does not accept: the transfer completes as soon as it is mined.",
    "Once transferred, your account is no longer the owner and cannot transfer it again or patch it (unless it was created read-only).",
    "The expiry and the payload are untouched; the entity stays readable by everyone either way.",
  ];
}

/**
 * Compares the ownership read before the send with the read afterwards. Every
 * check must pass; a mismatch is reported as one, never smoothed over.
 */
export function compareOwnership(
  before: OwnershipSnapshot,
  after: OwnershipSnapshot,
  expectedNewOwner: Address,
): ReadBackVerdict {
  const checks: Check[] = [
    {
      name: "the entity is still the same entity",
      ok: before.entityKey === after.entityKey,
      detail: after.entityKey,
    },
    {
      name: "the owner is now the intended recipient",
      ok: sameAddress(after.owner, expectedNewOwner),
      detail: `${after.owner} (expected ${expectedNewOwner})`,
    },
    {
      name: "the owner actually changed",
      ok: !sameAddress(after.owner, before.owner),
      detail: `was ${before.owner}`,
    },
    {
      name: "the creator did not change",
      ok: sameAddress(after.creator, before.creator),
      detail: after.creator,
    },
    {
      name: "the expiry did not change",
      ok: after.expiresAtBlock === before.expiresAtBlock,
      detail: `block ${after.expiresAtBlock}`,
    },
    {
      name: "the payload did not change",
      ok: after.payloadHex === before.payloadHex,
      detail: `${(after.payloadHex.length - 2) / 2} bytes`,
    },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
