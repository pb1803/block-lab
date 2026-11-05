/**
 * Real Arkiv gateway for the POC. This module is the ONLY place the
 * `@arkiv-network/sdk` is imported, keeping the SDK out of the shared
 * `@blocklab/arkiv-metadata` contract and the Node-side packages.
 *
 * The gateway signs nothing itself: writes go through
 * `walletClient.createEntity`, whose viem `writeContract` call ends in the
 * connected wallet's `eth_sendTransaction`. `createEntity` resolves only after
 * the receipt is mined, so the caller must never turn its return into a
 * "submitted but unconfirmed" claim — it is a confirmation result.
 */

import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { custom, hexToBytes, http } from "viem";
import { ARKIV_ACCESS_KEY } from "./config.js";
import {
  experimentSchema,
  experimentValues,
} from "./entity/experiment-schema.js";
import type { ArchivedRecord } from "./status.js";
import type { Eip1193Provider } from "./wallet.js";

export type PublishResult = {
  readonly entityKey: Hex;
  readonly txHash: Hex;
  readonly expiresAtBlock: bigint;
};

export type ExperimentLookup = {
  readonly entityKey: Hex | null;
};

/** The write/read surface the workflow drives. */
export interface ArkivGateway {
  /** Finds an entity by its experimentId index, or null when none exists. */
  findExperiment(experimentId: string): Promise<ExperimentLookup>;
  /** Signs and sends one create; resolves only once the receipt is mined. */
  publishExperiment(metadata: ExperimentMetadata): Promise<PublishResult>;
  /** Reads an entity back, including its payload and system metadata. */
  readExperiment(entityKey: Hex): Promise<ArchivedRecord>;
}

export type RabdiGatewayOptions = {
  readonly provider: Eip1193Provider;
  readonly address: Address;
  readonly accessKey?: string;
};

export function createRabdiGateway(options: RabdiGatewayOptions): ArkivGateway {
  const accessKey = options.accessKey ?? ARKIV_ACCESS_KEY;
  const chain = rabdi({ accessKey });
  // Bounded, non-retrying reads: the public endpoint rate-limits (HTTP 429 with
  // a long Retry-After), so a throttled duplicate check must fail fast and
  // loudly instead of leaving the preflight spinning.
  const publicClient = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: 12_000 }),
  });
  const walletClient = createWalletClient({
    chain,
    transport: custom(options.provider),
    account: options.address,
  });

  return {
    async findExperiment(experimentId) {
      const page = await publicClient
        .select({ $key: true })
        .from(experimentSchema)
        .where(eq("experimentId", experimentId))
        .limit(5)
        .fetch();
      const entity = page.entities[0];
      if (entity === undefined || entity.$key === undefined)
        return { entityKey: null };
      return { entityKey: entity.$key };
    },

    async publishExperiment(metadata) {
      const result = await walletClient.createEntity(
        experimentSchema,
        experimentValues(metadata),
        { expiration: ExpirationTime.fromDays(metadata.expiryDays) },
      );
      return {
        entityKey: result.entityKey,
        txHash: result.txHash,
        expiresAtBlock: result.expiresAt,
      };
    },

    async readExperiment(entityKey) {
      const row = await publicClient.getEntity(entityKey, experimentSchema);
      return archivedRecordFromRow(row);
    },
  };
}

/**
 * Maps a `FullRow` of `experimentSchema` onto the read-only `ArchivedRecord`.
 * Kept pure so malformed responses can be unit-tested without a network.
 */
export function archivedRecordFromRow(row: {
  readonly $key: Hex;
  readonly $owner: Address;
  readonly $creator: Address;
  readonly $createdAt: bigint;
  readonly $updatedAt: bigint;
  readonly $expiresAt: bigint;
  readonly $creationFlags:
    | { readonly readonly: boolean; readonly permissionlessExtension: boolean }
    | undefined;
  readonly payload: { readonly type: "bytes"; readonly value: Hex };
}): ArchivedRecord {
  return {
    entityKey: row.$key,
    owner: row.$owner,
    creator: row.$creator,
    createdAtBlock: row.$createdAt,
    updatedAtBlock: row.$updatedAt,
    expiresAtBlock: row.$expiresAt,
    readonlyFlag: row.$creationFlags?.readonly ?? false,
    payloadJson: decodePayloadHex(row.payload.value),
  };
}

/**
 * Decodes the `payload` bytes attribute back to the canonical JSON. A payload
 * that is not UTF-8 JSON is a malformed response, never a silent blank.
 */
export function decodePayloadHex(value: Hex): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(value));
  } catch {
    throw new Error("malformed response: payload is not valid UTF-8");
  }
  try {
    JSON.parse(text);
  } catch {
    throw new Error("malformed response: payload is not valid JSON");
  }
  return text;
}
