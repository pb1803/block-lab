#!/usr/bin/env node
/**
 * Independent publication verification against Rabdi.
 *
 * Reads one entity by key (or by `experimentId`), then reports what the chain
 * actually stores: payload bytes, SHA-256, byte-identity with a canonical record,
 * revalidation against the shared contract, ownership, expiry blocks and — when
 * `--tx` is given — the mined receipt and the real gas cost.
 *
 * This is deliberately a separate process from Studio: a publication claim must
 * be checkable without trusting the app that made it.
 *
 * Usage:
 *   node --env-file=apps/arkiv-poc/.env.local apps/studio/scripts/verify-entity.mjs \
 *     --entity 0x…  |  --experiment-id studio-mm-001 \
 *     [--record path/to/record.json] [--signer 0x…] [--tx 0x…] \
 *     [--explorer https://rabdi.explorer.arkiv.network] [--json]
 *
 * Exit: 0 verified, 1 not verified, 2 blocked (no key / wrong chain / bad args),
 * 3 no entity with that id (nothing published).
 */
import { readFileSync } from "node:fs";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";
import { experimentSchema } from "../src/arkiv/schema.ts";
import { buildPublicationEvidence } from "../src/arkiv/verify-publication.ts";

const RABDI_CHAIN_ID = 7_794_095;
const EXPLORER = "https://rabdi.explorer.arkiv.network";

function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--entity") args.entity = value;
    else if (flag === "--experiment-id") args.experimentId = value;
    else if (flag === "--record") args.record = value;
    else if (flag === "--signer") args.signer = value;
    else if (flag === "--tx") args.tx = value;
    else if (flag === "--explorer") args.explorer = value;
    else if (flag === "--json") args.json = true;
  }
  return args;
}

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const accessKey = process.env.ARKIV_ACCESS_KEY ?? process.env.VITE_ARKIV_ACCESS_KEY ?? "";
if (accessKey === "") {
  blocked("no Arkiv access key. Run with --env-file=apps/arkiv-poc/.env.local.");
}
if (args.entity === undefined && args.experimentId === undefined) {
  blocked("pass --entity <0x…> or --experiment-id <id>.");
}

const client = createPublicClient({
  chain: rabdi({ accessKey }),
  transport: http(undefined, { retryCount: 0, timeout: 15_000 }),
});

const chainId = await client.getChainId().catch((error) => {
  blocked(`the endpoint did not answer (${error.message}).`);
});
if (chainId !== RABDI_CHAIN_ID) blocked(`unexpected chain id ${chainId}`);

let canonical;
if (args.record !== undefined) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(args.record, "utf8"));
  } catch (error) {
    blocked(`could not read ${args.record}: ${error.message}`);
  }
  const result = validateExperimentMetadata(parsed);
  if (!result.ok) {
    blocked(
      `the supplied record is not valid metadata: ${result.issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  canonical = result.metadata;
}

let entityKey = args.entity;
if (entityKey === undefined) {
  const page = await client
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", args.experimentId))
    .limit(1)
    .fetch()
    .catch((error) => {
      blocked(`the experimentId query failed (${error.message}).`);
    });
  entityKey = page.entities[0]?.$key;
  if (entityKey === undefined) {
    console.error(
      `NOT PUBLISHED: no entity carries experimentId "${args.experimentId}". Nothing to verify.`,
    );
    process.exit(3);
  }
  console.log(`found by experimentId "${args.experimentId}": ${entityKey}`);
}

const row = await client.getEntity(entityKey, experimentSchema).catch((error) => {
  console.error(`FAILED: the entity could not be read (${error.message}).`);
  process.exit(1);
});

let receipt;
if (args.tx !== undefined) {
  const raw = await client.getTransactionReceipt({ hash: args.tx }).catch((error) => {
    blocked(`the receipt for ${args.tx} is unavailable (${error.message}).`);
  });
  receipt = {
    status: raw.status === "success" ? "success" : "reverted",
    blockNumber: Number(raw.blockNumber),
    gasUsed: Number(raw.gasUsed),
    effectiveGasPriceWei: String(raw.effectiveGasPrice),
  };
}

const experimentId = canonical?.experimentId ?? row.experimentId?.value ?? "unknown";
const signer = args.signer ?? "";
const foundByExperimentId =
  args.experimentId === undefined
    ? undefined
    : (
        await client
          .select({ $key: true })
          .from(experimentSchema)
          .where(eq("experimentId", experimentId))
          .limit(1)
          .fetch()
          .catch(() => undefined)
      )?.entities[0]?.$key ?? null;

const evidence = await buildPublicationEvidence({
  experimentId: String(experimentId),
  network: { name: "rabdi", chainId: RABDI_CHAIN_ID, chainIdHex: "0x76edaf" },
  signer,
  entityKey,
  row: {
    $key: row.$key,
    $owner: row.$owner,
    $creator: row.$creator,
    $createdAt: row.$createdAt,
    $updatedAt: row.$updatedAt,
    $expiresAt: row.$expiresAt,
    payload: row.payload,
  },
  canonical,
  receipt,
  foundByExperimentId,
  txHash: args.tx,
  explorerBase: args.explorer ?? EXPLORER,
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} else {
  console.log(`\nentity ${evidence.entityKey}`);
  for (const check of evidence.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
  }
  if (signer === "") {
    console.log(
      "note: no --signer supplied, so owner==signer is not attested (reported as FAIL).",
    );
  }
  console.log(
    `\npayload ${evidence.payloadBytes} bytes, SHA-256 ${evidence.payloadSha256 ?? "unknown"}`,
  );
  if (evidence.gas.costTglm !== null) {
    console.log(
      `gas ${evidence.gas.gasUsed} × ${evidence.gas.effectiveGasPriceWei} wei = ${evidence.gas.costTglm} tGLM`,
    );
  }
  console.log(`explorer ${evidence.explorer ?? "n/a"}`);
  console.log(
    `\n${evidence.verified ? "VERIFIED" : "NOT VERIFIED"}: ${evidence.checks.filter((c) => c.ok).length}/${evidence.checks.length} checks passed.`,
  );
}

process.exit(evidence.verified ? 0 : 1);