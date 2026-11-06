/**
 * The Studio gateway: the only module that imports `@arkiv-network/sdk`.
 *
 * Reads use a bounded, non-retrying public client (the public endpoint
 * rate-limits hard). Writes go through `walletClient.createEntity`, whose viem
 * call ends in the connected wallet's `eth_sendTransaction`; the user approves
 * it there. Studio never sees a private key.
 *
 * The gateway resolves `publishExperiment` only after the receipt is mined, so
 * callers must treat its result as a confirmation, never as "submitted".
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
import { custom, http } from "viem";
import { ARKIV_ACCESS_KEY, type HistorySearchField } from "./config.js";
import { arkivRecordFromRow, type RawEntityRow } from "./record.js";
import { experimentSchema, experimentValues } from "./schema.js";
import type { ArkivRecord, RecordSummary } from "./types.js";
import type { Eip1193Provider } from "./wallet.js";

export type PublishResult = {
  readonly entityKey: Hex;
  readonly txHash: Hex;
  readonly expiresAtBlock: bigint;
};

export type ExperimentLookup = {
  readonly entityKey: Hex | null;
};

/** The read/write surface the Studio controllers drive. */
export interface ArkivGateway {
  /** Finds an entity by its indexed experimentId, or null when none exists. */
  findExperiment(experimentId: string): Promise<ExperimentLookup>;
  /** Signs and sends exactly one create; resolves once the receipt is mined. */
  publishExperiment(metadata: ExperimentMetadata): Promise<PublishResult>;
  /** Reads one entity by key. Throws `NoEntityFoundError` when missing/expired. */
  readRecord(entityKey: Hex): Promise<ArkivRecord>;
  /** Query the history by an indexed attribute. Throws on a malformed row. */
  queryBy(
    field: HistorySearchField,
    value: string,
    limit: number,
  ): Promise<readonly RecordSummary[]>;
  /** Current head block, for expiry display. */
  currentBlock(): Promise<bigint>;
}

export type RabdiGatewayOptions = {
  readonly provider?: Eip1193Provider;
  readonly address?: Address;
  readonly accessKey?: string;
};

export function createRabdiGateway(
  options: RabdiGatewayOptions = {},
): ArkivGateway {
  const accessKey = options.accessKey ?? ARKIV_ACCESS_KEY;
  const chain = rabdi({ accessKey });
  const publicClient = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: 12_000 }),
  });

  const walletClient =
    options.provider === undefined || options.address === undefined
      ? undefined
      : createWalletClient({
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
        .limit(1)
        .fetch();
      return { entityKey: page.entities[0]?.$key ?? null };
    },

    async publishExperiment(metadata) {
      if (walletClient === undefined) {
        throw new Error(
          "No connected wallet: a publish needs an EIP-1193 account.",
        );
      }
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

    async readRecord(entityKey) {
      const row = await publicClient.getEntity(entityKey, experimentSchema);
      const decoded = arkivRecordFromRow(row as unknown as RawEntityRow);
      if (!decoded.ok) {
        throw new MalformedRecordError(decoded.error.message);
      }
      return decoded.record;
    },

    async queryBy(field, value, limit) {
      const page = await publicClient
        .select({
          $key: true,
          experimentId: true,
          scenarioName: true,
          status: true,
          startedAtMs: true,
        })
        .from(experimentSchema)
        .where(whereFor(field, value))
        .limit(limit)
        .fetch();
      return page.entities.map((row) =>
        summaryFromRow(row as unknown as SummaryRow),
      );
    },

    async currentBlock() {
      return BigInt(await publicClient.getBlockNumber());
    },
  };
}

/**
 * A record that reads back but is not a valid BLOCKLAB payload. Kept distinct
 * from RPC errors so the UI can say "malformed record" instead of "unavailable".
 */
export class MalformedRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedRecordError";
  }
}

type SummaryRow = {
  readonly $key?: Hex;
  readonly experimentId?: { readonly value?: string } | undefined;
  readonly scenarioName?: { readonly value?: string } | undefined;
  readonly status?: { readonly value?: string } | undefined;
  readonly startedAtMs?: { readonly value?: bigint } | undefined;
};

/**
 * Maps a query row onto the discovery summary. A row without a key or the
 * indexed discovery fields is malformed; it is rejected rather than shown with
 * substitute values.
 */
export function summaryFromRow(row: SummaryRow): RecordSummary {
  const key = row.$key;
  const experimentId = row.experimentId?.value;
  const scenarioName = row.scenarioName?.value;
  const status = row.status?.value;
  const startedAtMs = row.startedAtMs?.value;
  if (
    key === undefined ||
    experimentId === undefined ||
    scenarioName === undefined ||
    status === undefined ||
    startedAtMs === undefined
  ) {
    throw new MalformedRecordError(
      "A history row is missing its key or indexed discovery attributes.",
    );
  }
  return {
    entityKey: key,
    experimentId,
    scenarioName,
    status,
    startedAtMs: Number(startedAtMs),
  };
}

function whereFor(field: HistorySearchField, value: string) {
  switch (field) {
    case "experimentId":
      return eq("experimentId", value);
    case "scenarioName":
      return eq("scenarioName", value);
    case "status":
      return eq("status", value);
  }
}
