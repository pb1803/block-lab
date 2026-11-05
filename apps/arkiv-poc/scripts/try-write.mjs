#!/usr/bin/env node
/**
 * Real Rabdi write attempt for the Phase 14 POC (verification harness only).
 *
 * The browser POC signs with the user's wallet. This script exists so the real
 * write path can be exercised headlessly, and it refuses to pretend:
 *
 *   1. It uses a dedicated testnet account — `ARKIV_PRIVATE_KEY` when set,
 *      otherwise a freshly generated key that is never printed or stored.
 *   2. It reads the account balance from Rabdi BEFORE signing anything.
 *   3. With a zero balance it stops and reports the exact blocker; it does not
 *      "simulate" a successful write and it does not sign a transaction.
 *   4. Only a funded account reaches `createEntity`, whose result (tx hash,
 *      entity key, expiry block) comes from the mined receipt.
 *
 * Usage: pnpm --filter @blocklab/arkiv-poc exec node scripts/try-write.mjs
 * Exit codes: 0 write + read-back verified, 1 an operation failed, 2 blocked
 * before signing (no funds / wrong network).
 */
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";
// Node 22.18+/24 strips TypeScript types, so the exact POC schema is reused
// instead of being copied here.
import { experimentSchema, experimentValues } from "../src/entity/experiment-schema.ts";

const ACCESS_KEY = process.env.ARKIV_ACCESS_KEY ?? "";
const EXPLORER = "https://rabdi.explorer.arkiv.network";
const RABDI_CHAIN_ID = 7_794_095;

function blocked(reason) {
  console.log(`BLOCKED: ${reason}`);
  process.exit(2);
}

const record = (() => {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: `poc-write-${Date.now()}`,
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout (write probe)",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: Date.now() - 30_000,
    completedAtMs: Date.now(),
    requestCount: 40,
    succeededCount: 34,
    failedCount: 6,
    rpcFailureCount: 6,
    latency: { averageMs: 128, p50Ms: 96, p95Ms: 310, maxMs: 512 },
    evidenceDigest: "3f".repeat(32),
    evidenceRef: "evidence/poc-write/result.json",
    expiryDays: 7,
  });
  if (!result.ok) {
    console.error(`metadata rejected: ${result.issues.map((issue) => issue.message).join("; ")}`);
    process.exit(1);
  }
  return result.metadata;
})();

const chain = rabdi({ accessKey: ACCESS_KEY });
const publicClient = createPublicClient({ chain, transport: http() });

const chainId = await publicClient.getChainId();
console.log(`chain id: ${chainId}`);
if (chainId !== RABDI_CHAIN_ID) blocked(`unexpected chain id ${chainId}`);

const privateKey = process.env.ARKIV_PRIVATE_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(privateKey);
console.log(`signer: ${account.address} (${process.env.ARKIV_PRIVATE_KEY ? "from ARKIV_PRIVATE_KEY" : "freshly generated, not persisted"})`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`balance: ${balance} wei (${Number(balance) / 1e18} tGLM)`);
if (balance === 0n) {
  blocked(
    "the signer has no tGLM on Rabdi, so no transaction can be paid for. " +
      "The faucet (https://hub.arkiv.network/faucet) requires a wallet connection and is not " +
      "scriptable from this environment. Nothing was signed and no entity was written.",
  );
}

const walletClient = createWalletClient({ chain, transport: http(), account });
console.log(`writing entity through schema "${experimentSchema.name}"…`);

let created;
try {
  created = await walletClient.createEntity(experimentSchema, experimentValues(record), {
    expiration: ExpirationTime.fromDays(record.expiryDays),
  });
} catch (error) {
  console.error(`write failed: ${error.message}`);
  process.exit(1);
}

console.log(`tx hash: ${created.txHash}`);
console.log(`entity key: ${created.entityKey}`);
console.log(`expires at block: ${created.expiresAt}`);
console.log(`explorer: ${EXPLORER}/tx/${created.txHash}`);

const row = await publicClient.getEntity(created.entityKey, experimentSchema);
console.log("read-back:");
console.log(
  JSON.stringify(
    {
      entityKey: row.$key,
      owner: row.$owner,
      creator: row.$creator,
      createdAtBlock: row.$createdAt.toString(),
      updatedAtBlock: row.$updatedAt.toString(),
      expiresAtBlock: row.$expiresAt.toString(),
      creationFlags: row.$creationFlags,
      experimentId: row.experimentId?.value,
      status: row.status?.value,
      payloadBytes: row.payload?.value?.length ?? 0,
    },
    null,
    2,
  ),
);

if (row.$key !== created.entityKey) {
  console.error("read-back key does not match the created key");
  process.exit(1);
}
console.log("verified: created entity is queryable by key");
process.exit(0);