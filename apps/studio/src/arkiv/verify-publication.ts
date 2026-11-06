/**
 * Independent publication verification.
 *
 * This module turns "the wallet said success" into facts that a second process
 * can check: the on-chain payload bytes, their SHA-256, byte-identity with the
 * canonical record, revalidation against the shared contract, ownership, expiry
 * and (when the transaction is known) the mined receipt and actual gas.
 *
 * It is pure apart from Web Crypto, imports no Arkiv SDK, and never infers a
 * fact it was not given: a missing receipt, an unknown signer or a payload that
 * does not decode all make `verified` false rather than being smoothed over.
 */
import {
  type ExperimentMetadata,
  metadataToPayloadBytes,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import { bytesToHex, hexToBytes } from "viem";

/** The subset of an entity row this module needs; compatible with the SDK row. */
export type VerificationRow = {
  readonly $key: string;
  readonly $owner: string;
  readonly $creator: string;
  readonly $createdAt: bigint;
  readonly $updatedAt: bigint;
  readonly $expiresAt: bigint;
  readonly payload:
    | { readonly type: "bytes"; readonly value: string }
    | undefined;
};

export type ReceiptFacts = {
  readonly status: "success" | "reverted";
  readonly blockNumber: number;
  readonly gasUsed: number;
  /** Effective gas price in wei, as a decimal string (exact). */
  readonly effectiveGasPriceWei: string;
};

export type VerificationInput = {
  readonly experimentId: string;
  readonly network: {
    readonly name: string;
    readonly chainId: number;
    readonly chainIdHex: string;
  };
  readonly signer: string;
  readonly entityKey: string;
  readonly row: VerificationRow;
  /** The record that was meant to be published, when it is known. */
  readonly canonical?: ExperimentMetadata | undefined;
  readonly receipt?: ReceiptFacts | undefined;
  /** Entity key found by an `experimentId` query after the fact, if queried. */
  readonly foundByExperimentId?: string | null | undefined;
  readonly txHash?: string | undefined;
  readonly explorerBase?: string | undefined;
};

export type VerificationCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

export type PublicationEvidence = {
  readonly kind: "blocklab.arkiv-publication";
  readonly experimentId: string;
  readonly network: {
    readonly name: string;
    readonly chainId: number;
    readonly chainIdHex: string;
  };
  readonly txHash: string | null;
  readonly receiptStatus: string | null;
  readonly blockNumber: number | null;
  readonly entityKey: string;
  readonly owner: string;
  readonly creator: string;
  readonly signer: string;
  readonly ownerEqualsCreator: boolean;
  readonly ownerEqualsSigner: boolean;
  readonly createdAtBlock: number;
  readonly updatedAtBlock: number;
  readonly expiresAtBlock: number;
  readonly lifetimeBlocks: number;
  readonly payloadBytes: number;
  readonly payloadSha256: string | null;
  readonly payloadDecodesAsRecord: boolean;
  readonly byteIdenticalToCanonical: boolean | null;
  readonly revalidatesAgainstSharedSchema: boolean;
  readonly findableByExperimentId: boolean | null;
  readonly gas: {
    readonly gasUsed: number | null;
    readonly effectiveGasPriceWei: string | null;
    readonly costWei: string | null;
    readonly costTglm: number | null;
  };
  readonly explorer: string | null;
  readonly checks: readonly VerificationCheck[];
  readonly verified: boolean;
};

/**
 * Decodes a `0x`-prefixed hex string strictly: a missing prefix, odd length,
 * non-hex characters or an empty body are errors, never silently truncated or
 * empty bytes (an empty payload cannot be a record).
 */
export function decodeHexStrict(value: string): Uint8Array {
  if (
    !/^0x[0-9a-fA-F]+$/.test(value) ||
    value.length % 2 !== 0 ||
    value.length <= 2
  ) {
    throw new Error("payload is not well-formed 0x-prefixed hex");
  }
  return hexToBytes(value as `0x${string}`);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest)).slice(2);
}

const SUCCESS_STATUS: readonly string[] = ["success", "0x1", "1"];

/**
 * Builds the evidence block for one publication. `verified` is true only when
 * every check that could be evaluated passed and none was skipped for a reason
 * that matters (missing receipt, missing payload, unknown signer).
 */
export async function buildPublicationEvidence(
  input: VerificationInput,
): Promise<PublicationEvidence> {
  const checks: VerificationCheck[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const hex = input.row.payload?.value;
  let payloadBytes = 0;
  let payloadSha256: string | null = null;
  let payloadText: string | null = null;
  let decodes = false;
  let revalidates = false;
  let byteIdentical: boolean | null = null;
  let payloadExperimentId: string | null = null;

  if (hex === undefined) {
    add("payload present", false, "the entity carries no payload attribute");
  } else {
    const bytes = decodeHexStrict(hex);
    payloadBytes = bytes.length;
    payloadSha256 = await sha256Hex(bytes);
    add(
      "payload present",
      true,
      `${payloadBytes} bytes, SHA-256 ${payloadSha256}`,
    );
    try {
      payloadText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      add("payload decodes as UTF-8", true, "decoded");
    } catch {
      add("payload decodes as UTF-8", false, "not valid UTF-8");
    }
    if (payloadText !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
        decodes = true;
        add("payload decodes as JSON", true, "parsed");
      } catch {
        add("payload decodes as JSON", false, "not valid JSON");
      }
      if (parsed !== undefined) {
        const result = validateExperimentMetadata(parsed);
        if (result.ok) {
          revalidates = true;
          payloadExperimentId = result.metadata.experimentId;
          add(
            "revalidates against the shared contract",
            payloadExperimentId === input.experimentId,
            payloadExperimentId === input.experimentId
              ? `experimentId "${payloadExperimentId}"`
              : `payload experimentId "${payloadExperimentId}" does not match "${input.experimentId}"`,
          );
        } else {
          add(
            "revalidates against the shared contract",
            false,
            result.issues
              .map((issue) => `${issue.field}: ${issue.message}`)
              .join("; "),
          );
        }
      }
    }

    if (input.canonical !== undefined) {
      const canonicalBytes = metadataToPayloadBytes(input.canonical);
      byteIdentical =
        canonicalBytes.length === bytes.length &&
        canonicalBytes.every((byte, index) => byte === bytes[index]);
      add(
        "byte-identical to the canonical record",
        byteIdentical,
        byteIdentical
          ? `${canonicalBytes.length} bytes match`
          : `canonical ${canonicalBytes.length} bytes vs on-chain ${bytes.length} bytes`,
      );
    } else {
      add(
        "byte-identical to the canonical record",
        false,
        "no canonical record supplied, so byte identity is unknown",
      );
    }
  }

  const owner = input.row.$owner;
  const creator = input.row.$creator;
  const ownerEqualsCreator = owner.toLowerCase() === creator.toLowerCase();
  const ownerEqualsSigner = owner.toLowerCase() === input.signer.toLowerCase();
  add("owner == creator", ownerEqualsCreator, `${owner} vs ${creator}`);
  add("owner == signer", ownerEqualsSigner, `${owner} vs ${input.signer}`);
  add(
    "entity key matches the published key",
    input.row.$key.toLowerCase() === input.entityKey.toLowerCase(),
    `${input.row.$key} vs ${input.entityKey}`,
  );

  const createdAtBlock = Number(input.row.$createdAt);
  const updatedAtBlock = Number(input.row.$updatedAt);
  const expiresAtBlock = Number(input.row.$expiresAt);
  const lifetimeBlocks = expiresAtBlock - createdAtBlock;
  add(
    "expiry after creation",
    Number.isSafeInteger(lifetimeBlocks) && lifetimeBlocks > 0,
    `${lifetimeBlocks} blocks (${createdAtBlock} → ${expiresAtBlock})`,
  );

  const receiptStatus =
    input.receipt === undefined ? null : input.receipt.status;
  const receiptOk =
    input.receipt !== undefined &&
    SUCCESS_STATUS.includes(String(input.receipt.status));
  add(
    "mined receipt succeeded",
    receiptOk,
    input.receipt === undefined
      ? "no receipt supplied, so the transaction outcome is unknown"
      : `status ${String(input.receipt.status)} at block ${input.receipt.blockNumber}`,
  );

  const findable =
    input.foundByExperimentId === undefined ||
    input.foundByExperimentId === null
      ? null
      : input.foundByExperimentId.toLowerCase() ===
        input.entityKey.toLowerCase();
  if (findable !== null) {
    add(
      "findable by experimentId",
      findable,
      `${input.foundByExperimentId} vs ${input.entityKey}`,
    );
  }

  const gasUsed = input.receipt === undefined ? null : input.receipt.gasUsed;
  const effectiveGasPriceWei =
    input.receipt === undefined ? null : input.receipt.effectiveGasPriceWei;
  const costWei =
    gasUsed === null || effectiveGasPriceWei === null
      ? null
      : (BigInt(gasUsed) * BigInt(effectiveGasPriceWei)).toString();

  const evidence: PublicationEvidence = {
    kind: "blocklab.arkiv-publication",
    experimentId: input.experimentId,
    network: input.network,
    txHash: input.txHash ?? null,
    receiptStatus: receiptStatus === null ? null : String(receiptStatus),
    blockNumber: input.receipt === undefined ? null : input.receipt.blockNumber,
    entityKey: String(input.row.$key),
    owner,
    creator,
    signer: input.signer,
    ownerEqualsCreator,
    ownerEqualsSigner,
    createdAtBlock,
    updatedAtBlock,
    expiresAtBlock,
    lifetimeBlocks,
    payloadBytes,
    payloadSha256,
    payloadDecodesAsRecord: decodes && revalidates,
    byteIdenticalToCanonical: byteIdentical,
    revalidatesAgainstSharedSchema: revalidates,
    findableByExperimentId: findable,
    gas: {
      gasUsed,
      effectiveGasPriceWei,
      costWei,
      costTglm: costWei === null ? null : Number(BigInt(costWei)) / 1e18,
    },
    explorer:
      input.explorerBase === undefined
        ? null
        : `${input.explorerBase.replace(/\/+$/, "")}/entity/${input.entityKey}`,
    checks,
    verified: checks.every((check) => check.ok),
  };
  return evidence;
}

/** True when the payload bytes are exactly the canonical encoding of `record`. */
export function payloadMatchesRecord(
  payloadHex: string,
  record: ExperimentMetadata,
): boolean {
  const onChain = decodeHexStrict(payloadHex);
  const canonical = metadataToPayloadBytes(record);
  return (
    onChain.length === canonical.length &&
    canonical.every((byte, index) => byte === onChain[index])
  );
}
