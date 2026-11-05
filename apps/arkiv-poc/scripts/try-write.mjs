#!/usr/bin/env node
/**
 * Real Rabdi publication for the Phase 14 POC (verification harness only).
 *
 * The browser POC signs with the user's wallet. This script exists so the same
 * publication can be exercised headlessly, and it refuses to pretend:
 *
 *   1. It uses a dedicated testnet account: `ARKIV_PRIVATE_KEY` when set,
 *      otherwise a freshly generated key that is never printed or stored.
 *   2. It reads the account balance from Rabdi BEFORE signing anything.
 *   3. It runs the duplicate preflight BEFORE signing. A run whose experiment
 *      id already exists is reported as existing, with no new transaction.
 *   4. If the preflight cannot run (throttled/offline) the run stops: an unknown
 *      duplicate state is never treated as "no duplicate".
 *   5. After a write error it re-checks for the entity instead of re-signing, so
 *      an uncertain transaction result is never retried blindly.
 *   6. Only `createEntity` returning a mined receipt produces a tx hash/entity
 *      key. Nothing is simulated.
 *
 * Usage (credentials come from the git-ignored .env.local, never the shell):
 *   pnpm --filter @blocklab/arkiv-poc exec node --env-file=.env.local scripts/try-write.mjs
 *
 * Exit codes: 0 launched/verified (created or already existing), 1 an operation
 * failed, 2 blocked before signing (no funds / wrong network / no preflight).
 */
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";
// Node 22.18+/24 strips TypeScript types, so the exact POC modules are reused
// instead of being copied here.
import {
  experimentSchema,
  experimentValues,
} from "../src/entity/experiment-schema.ts";
import { findExistingExperimentKey } from "../src/repository.ts";

const EXPLORER = "https://rabdi.explorer.arkiv.network";
const RABDI_CHAIN_ID = 7_794_095;
const EXPERIMENT_ID = "poc-write-001";

/**
 * Both env names are accepted so one .env.local serves the browser build
 * (`VITE_ARKIV_ACCESS_KEY`) and this harness (`ARKIV_ACCESS_KEY`).
 */
const ACCESS_KEY =
  process.env.ARKIV_ACCESS_KEY ?? process.env.VITE_ARKIV_ACCESS_KEY ?? "";

function blocked(reason) {
  console.log(`BLOCKED: ${reason}`);
  process.exit(2);
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

const record = (() => {
  const now = Date.now();
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    // Stable id: a re-run must find this record instead of writing a duplicate.
    experimentId: EXPERIMENT_ID,
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout (write probe)",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: now - 30_000,
    completedAtMs: now,
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
    console.error(
      `metadata rejected: ${result.issues.map((issue) => issue.message).join("; ")}`,
    );
    process.exit(1);
  }
  return result.metadata;
})();

const chain = rabdi({ accessKey: ACCESS_KEY });
console.log(
  `access key: ${ACCESS_KEY === "" ? "none (public, rate-limited endpoint)" : "configured (value not printed)"}`,
);
// Bounded transport: a throttled or stalled node request fails instead of hanging.
const publicClient = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 1, timeout: 15_000 }),
});

const chainId = await publicClient.getChainId();
console.log(`chain id: ${chainId}`);
if (chainId !== RABDI_CHAIN_ID) blocked(`unexpected chain id ${chainId}`);

async function reportExisting(entityKey) {
  console.log(`already published: entity key ${entityKey}`);
  try {
    const row = await publicClient.getEntity(entityKey, experimentSchema);
    console.log(
      JSON.stringify(
        {
          entityKey: row.$key,
          owner: row.$owner,
          creator: row.$creator,
          createdAtBlock: row.$createdAt.toString(),
          expiresAtBlock: row.$expiresAt.toString(),
          experimentId: row.experimentId?.value,
          status: row.status?.value,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(`read-back failed: ${describeError(error)}`);
    process.exit(1);
  }
  process.exit(0);
}

// 1. Duplicate preflight, before any signing.
let existingKey;
try {
  existingKey = await findExistingExperimentKey(publicClient, experimentSchema, EXPERIMENT_ID);
} catch (error) {
  blocked(
    `the duplicate preflight could not run (${describeError(error)}), so the ` +
      "duplicate state is unknown. Nothing was signed. Re-run later or configure " +
      "an Arkiv access key (https://hub.arkiv.network/access-keys).",
  );
}
if (existingKey !== null) await reportExisting(existingKey);
console.log(`preflight: no entity with experimentId "${EXPERIMENT_ID}"`);

// 2. Balance check, still before signing.
const privateKey = process.env.ARKIV_PRIVATE_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(privateKey);
console.log(
  `signer: ${account.address} (${process.env.ARKIV_PRIVATE_KEY ? "from .env.local, value not printed" : "freshly generated, not persisted"})`,
);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`balance: ${balance} wei (${Number(balance) / 1e18} tGLM)`);
if (balance === 0n) {
  blocked(
    `the signer has no tGLM on Rabdi, so no transaction can be paid for. ` +
      `Fund ${account.address} at https://hub.arkiv.network/faucet (Rabdi, tGLM). ` +
      "Nothing was signed and no entity was written.",
  );
}

// 3. Exactly one wallet-signed publication.
const walletClient = createWalletClient({ chain, transport: http(), account });
console.log(`writing entity through schema "${experimentSchema.name}"…`);

let created;
try {
  created = await walletClient.createEntity(
    experimentSchema,
    experimentValues(record),
    { expiration: ExpirationTime.fromDays(record.expiryDays) },
  );
} catch (error) {
  console.error(`write failed: ${describeError(error)}`);
  // Uncertain outcome: check whether the entity exists now, and never re-sign
  // in the same run. A later run is safe because the preflight above refuses
  // to write a duplicate.
  try {
    const after = await findExistingExperimentKey(publicClient, experimentSchema, EXPERIMENT_ID);
    if (after !== null) {
      console.log(
        `the write may still have landed: entity ${after} now exists. Not re-signing.`,
      );
      await reportExisting(after);
    }
    console.log("no entity with this experimentId exists; nothing was written.");
  } catch (checkError) {
    console.log(
      `post-failure duplicate check could not run: ${describeError(checkError)}`,
    );
  }
  process.exit(1);
}

console.log(`tx hash: ${created.txHash}`);
console.log(`entity key: ${created.entityKey}`);
console.log(`expires at block: ${created.expiresAt}`);
console.log(`explorer: ${EXPLORER}/tx/${created.txHash}`);

// 4. Read the entity back and verify it against what was submitted.
const row = await publicClient.getEntity(created.entityKey, experimentSchema);
const onChain = {
  entityKey: row.$key,
  owner: row.$owner,
  creator: row.$creator,
  createdAtBlock: row.$createdAt.toString(),
  updatedAtBlock: row.$updatedAt.toString(),
  expiresAtBlock: row.$expiresAt.toString(),
  creationFlags: row.$creationFlags,
  experimentId: row.experimentId?.value,
  experimentType: row.experimentType?.value,
  scenarioName: row.scenarioName?.value,
  status: row.status?.value,
  targetChainId: row.targetChainId?.value?.toString(),
  startedAtMs: row.startedAtMs?.value?.toString(),
  payloadBytes: row.payload?.value?.length ?? 0,
};
console.log("read-back:");
console.log(JSON.stringify(onChain, null, 2));

const mismatches = [];
if (row.$key !== created.entityKey) mismatches.push("entity key");
if (row.experimentId?.value !== record.experimentId)
  mismatches.push("experimentId");
if (row.experimentType?.value !== record.experimentType)
  mismatches.push("experimentType");
if (row.scenarioName?.value !== record.scenarioName)
  mismatches.push("scenarioName");
if (row.status?.value !== record.status) mismatches.push("status");
if (row.targetChainId?.value !== BigInt(record.targetChainId))
  mismatches.push("targetChainId");
if (row.startedAtMs?.value !== BigInt(record.startedAtMs))
  mismatches.push("startedAtMs");
if (mismatches.length > 0) {
  console.error(`read-back mismatch: ${mismatches.join(", ")}`);
  process.exit(1);
}
console.log("verified: created entity is queryable by key and matches the submitted record");
process.exit(0);