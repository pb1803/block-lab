/**
 * Independent expiry verification.
 *
 * The counterpart of `buildPublicationEvidence` for a *dead* entity. Expiry is
 * silent on Arkiv: an expired key reads exactly like one that never existed, so
 * a missing entity alone proves nothing. This module only ever calls something
 * "verified as expired" when ALL of these hold at once:
 *
 *   1. the lookup returned the SDK's documented missing result (a positive
 *      `null` from `arkiv_getEntity`, mapped to `NoEntityFoundError`) — never a
 *      transport error, never a malformed response;
 *   2. the chain head is at or past the entity's expiry block;
 *   3. the expiry block is known — either decoded from the `EntityCreated` event
 *      on the creation receipt, or supplied explicitly with `--expires-at` — and
 *      the creation receipt (when the tx is given) proves the entity existed.
 *
 * A query that failed is never reported as expiry. A missing result *before* the
 * deadline is "premature" and is not verified. An entity still readable after the
 * deadline is "unexpectedly live" and is not verified.
 *
 * Pure apart from nothing: no SDK imports, no I/O, fully unit-testable.
 */
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";

export type ExpiryLookupState =
  /** `NoEntityFoundError` — the documented missing/expired result. */
  | "missing"
  /** The entity is still readable. */
  | "live"
  /** RPC / network / timeout — the lookup never got a usable answer. */
  | "transport"
  /** Schema mismatch or an otherwise unusable row. */
  | "malformed"
  /** Any other error. */
  | "unreadable";

export type ExpiryLookup =
  | { readonly state: "missing"; readonly error: string }
  | { readonly state: "live" }
  | { readonly state: "transport"; readonly error: string }
  | { readonly state: "malformed"; readonly error: string }
  | { readonly state: "unreadable"; readonly error: string };

export type ReceiptFacts = {
  readonly status: "success" | "reverted";
  readonly blockNumber: number;
  readonly gasUsed: number;
  /** Effective gas price in wei, as a decimal string (exact). */
  readonly effectiveGasPriceWei: string;
};

/** The `EntityCreated` event, decoded from the creation receipt when `--tx` is given. */
export type EntityCreatedFacts = {
  readonly entityKey: string;
  readonly owner: string;
  /** The block the engine recorded the entity expiring at. */
  readonly expiresAt: bigint;
  readonly creationFlags: number;
};

export type ExpiryVerificationInput = {
  readonly entityKey: string;
  readonly txHash: string | null;
  readonly receipt: ReceiptFacts | undefined;
  /** Decoded `EntityCreated` from the create receipt, when `--tx` was given. */
  readonly entityCreated: EntityCreatedFacts | undefined;
  /**
   * The entity's expiry block. Resolved in this order: the `EntityCreated` event
   * on the receipt, then `--expires-at`. `null` means it is unknown, in which
   * case expiry can never be verified.
   */
  readonly expiresAtBlock: bigint | null;
  readonly headBlock: bigint;
  readonly lookup: ExpiryLookup;
  readonly network: {
    readonly name: string;
    readonly chainId: number;
    readonly chainIdHex: string;
  };
  /** The canonical record, when supplied; kept for provenance in the evidence. */
  readonly canonical?: ExperimentMetadata | undefined;
  readonly explorerBase?: string | undefined;
};

export type ExpiryVerificationCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

export type ExpiryVerdict =
  /** Missing at/past the deadline, with a successful creation behind it. */
  | "expected-expired"
  /** Still inside the window and still readable — normal, nothing wrong. */
  | "not-yet-expired"
  /** Gone before its own deadline — died early. */
  | "prematurely-missing"
  /** Readable past its deadline — died late, or the deadline is wrong. */
  | "unexpectedly-live"
  /** The lookup never answered: a failed query proves nothing. */
  | "transport-failure"
  /** The lookup answered with an unusable row. */
  | "malformed"
  /** Neither a receipt nor --expires-at established the deadline. */
  | "expiry-unknown"
  /** A tx was supplied but its creation never proved to succeed. */
  | "creation-unproven"
  /** Any other error. */
  | "unreadable";

export type ExpiryEvidence = {
  readonly kind: "blocklab.arkiv-expiry";
  readonly experimentId: string | null;
  readonly network: {
    readonly name: string;
    readonly chainId: number;
    readonly chainIdHex: string;
  };
  readonly entityKey: string;
  readonly txHash: string | null;
  readonly receiptStatus: string | null;
  readonly createdAtBlock: number | null;
  readonly expiresAtBlock: number | null;
  readonly headBlock: number;
  readonly owner: string | null;
  readonly createdAtFromEvent: boolean;
  readonly lookupState: ExpiryLookupState;
  readonly lookupError: string | null;
  readonly verdict: ExpiryVerdict;
  readonly checks: readonly ExpiryVerificationCheck[];
  readonly verified: boolean;
};

/**
 * Builds the expiry evidence block. `verified` is true only when the expiry is
 * positively confirmed: documented missing result, head at/past the deadline,
 * deadline known, and (when a receipt was supplied) a successful creation.
 */
export function buildExpiryEvidence(
  input: ExpiryVerificationInput,
): ExpiryEvidence {
  const checks: ExpiryVerificationCheck[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const { lookup, expiresAtBlock, headBlock, receipt, entityCreated } = input;

  // ── provenance: did the entity ever exist? ────────────────────────────────
  const receiptOk =
    receipt !== undefined && ["success", "0x1", "1"].includes(receipt.status);
  if (input.txHash !== undefined && input.txHash !== null) {
    if (receipt === undefined) {
      add(
        "creation receipt read",
        false,
        "the tx was given but its receipt could not be read",
      );
    } else {
      add(
        "creation receipt succeeded",
        receiptOk,
        `status ${receipt.status} at block ${receipt.blockNumber}`,
      );
    }
  }

  if (entityCreated !== undefined) {
    const matches =
      entityCreated.entityKey.toLowerCase() === input.entityKey.toLowerCase();
    add(
      "EntityCreated matches this key",
      matches,
      matches
        ? `${entityCreated.entityKey} at block ${entityCreated.expiresAt}`
        : `${entityCreated.entityKey} vs ${input.entityKey}`,
    );
  } else {
    // Without a tx there is no event to decode; the caller then attests the deadline
    // with --expires-at, and that is the weaker provenance the detail reports.
    const attested = expiresAtBlock !== null;
    add(
      "existence attested",
      attested,
      attested
        ? "no --tx supplied; the deadline comes from --expires-at, not the creation event"
        : "neither a creation receipt nor --expires-at, so nothing attests the entity existed",
    );
  }

  // ── the deadline ──────────────────────────────────────────────────────────
  if (expiresAtBlock === null) {
    add(
      "expiry block known",
      false,
      "no EntityCreated event and no --expires-at supplied, so the deadline is unknown",
    );
  } else {
    add(
      "expiry block known",
      true,
      entityCreated !== undefined
        ? `from the EntityCreated event: ${expiresAtBlock}`
        : `from --expires-at: ${expiresAtBlock}`,
    );
    add(
      "head is at or past the expiry block",
      headBlock >= expiresAtBlock,
      `head ${headBlock} vs expiry ${expiresAtBlock}`,
    );
  }

  // ── the missing result ────────────────────────────────────────────────────
  switch (lookup.state) {
    case "missing":
      add(
        "lookup returned the documented missing result",
        true,
        `NoEntityFoundError: ${lookup.error}`,
      );
      break;
    case "live":
      add(
        "lookup returned the documented missing result",
        false,
        "the entity is still readable, so it has not expired",
      );
      break;
    case "transport":
      add(
        "lookup returned the documented missing result",
        false,
        `the lookup failed on transport: ${lookup.error}`,
      );
      break;
    case "malformed":
      add(
        "lookup returned the documented missing result",
        false,
        `the lookup failed on a malformed response: ${lookup.error}`,
      );
      break;
    case "unreadable":
      add(
        "lookup returned the documented missing result",
        false,
        `the lookup failed for another reason: ${lookup.error}`,
      );
      break;
  }

  const missing = lookup.state === "missing";
  const pastDeadline = expiresAtBlock !== null && headBlock >= expiresAtBlock;
  add(
    "missing result is not premature",
    missing && pastDeadline,
    missing && pastDeadline
      ? `missing at/past block ${expiresAtBlock}`
      : missing
        ? `missing at head ${headBlock}, but the deadline ${expiresAtBlock} has not been reached`
        : "the entity was not reported missing",
  );
  add(
    "lookup was not a transport failure",
    lookup.state !== "transport",
    lookup.state === "transport"
      ? "a transport failure cannot attest expiry"
      : "the lookup produced a usable result",
  );

  // ── verdict ───────────────────────────────────────────────────────────────
  let verdict: ExpiryVerdict;
  if (lookup.state === "transport") verdict = "transport-failure";
  else if (lookup.state === "malformed") verdict = "malformed";
  else if (lookup.state === "unreadable") verdict = "unreadable";
  else if (expiresAtBlock === null) verdict = "expiry-unknown";
  else if (!pastDeadline)
    verdict =
      lookup.state === "live" ? "not-yet-expired" : "prematurely-missing";
  else if (lookup.state === "live") verdict = "unexpectedly-live";
  else {
    // Missing at/past the deadline: only provenance stands between this and a
    // verified expiry. A supplied tx whose receipt was not read or not successful
    // leaves existence unproven; with no tx the caller attests it via --expires-at.
    const unproven =
      input.txHash !== null && input.txHash !== undefined && !receiptOk;
    verdict = unproven ? "creation-unproven" : "expected-expired";
  }

  const verified = checks.every((check) => check.ok);

  return {
    kind: "blocklab.arkiv-expiry",
    experimentId: input.canonical?.experimentId ?? null,
    network: input.network,
    entityKey: input.entityKey,
    txHash: input.txHash,
    receiptStatus: receipt === undefined ? null : receipt.status,
    createdAtBlock:
      receiptOk && receipt !== undefined ? receipt.blockNumber : null,
    expiresAtBlock: expiresAtBlock === null ? null : Number(expiresAtBlock),
    headBlock: Number(headBlock),
    owner: entityCreated?.owner ?? null,
    createdAtFromEvent: entityCreated !== undefined,
    lookupState: lookup.state,
    lookupError: lookup.state === "live" ? null : lookup.error,
    verdict,
    checks,
    verified,
  };
}

/**
 * Matches an SDK/viem error against the documented missing result.
 *
 * The RPC returns `null` for a dead key and `getEntity` maps that to
 * `NoEntityFoundError`. Anything else (a request error, a timeout, a schema
 * mismatch) is *not* the missing signal.
 */
export function classifyExpiryLookup(error: unknown): ExpiryLookup {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (
    name === "NoEntityFoundError" ||
    /no live entity/i.test(message) ||
    /expired|never created|deleted or has expired/i.test(message)
  ) {
    return { state: "missing", error: message };
  }
  if (
    /InvalidParamsRpcError|HttpRequestError|RequestError|timeout|rate.?limit|429|ECONN|network error/i.test(
      message,
    )
  ) {
    return { state: "transport", error: message };
  }
  if (
    /SchemaMismatchError|schema mismatch|does not match the schema/i.test(
      message,
    )
  ) {
    return { state: "malformed", error: message };
  }
  return { state: "unreadable", error: message };
}
