#!/usr/bin/env node
/**
 * Read-only pre-publication gate for the ARK-07 test record (`studio-mm-001`).
 *
 * It never signs and never writes. It answers: can a browser-wallet publication
 * proceed right now without creating a duplicate or failing on the network?
 *
 *   1. An Arkiv access key is configured (the public endpoint is 429-limited).
 *   2. The endpoint answers with the expected Rabdi chain id `7794095`.
 *   3. The head block is readable (the node is serving state).
 *   4. The duplicate preflight (same schema Studio writes with) finds no entity
 *      for `studio-mm-001`. If one exists, the id is already published and the
 *      run must not write again.
 *   5. The explorer host answers (evidence link will resolve later).
 *
 * The access key is never printed. Exit 0 = clear, 2 = blocked, 1 = failure.
 *
 * Usage:
 *   pnpm --filter @blocklab/studio exec node \
 *     --env-file=../arkiv-poc/.env.local scripts/studio-arkiv-preflight.mjs
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { experimentSchema } from "../src/arkiv/schema.ts";
import { EXPERIMENT_ID } from "./studio-mm-001-record.mjs";

const RABDI_CHAIN_ID = 7_794_095;
const EXPLORER = "https://rabdi.explorer.arkiv.network";
const ACCESS_KEY =
  process.env.ARKIV_ACCESS_KEY ?? process.env.VITE_ARKIV_ACCESS_KEY ?? "";

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}
function blocked(reason) {
  console.log(`\nBLOCKED: ${reason}`);
  process.exit(2);
}

if (ACCESS_KEY === "") {
  blocked(
    "no Arkiv access key in the environment. The public Rabdi endpoint rate-limits " +
      "anonymous queries (429 ANON_COST_LIMITED), so the duplicate preflight cannot run. " +
      "Nothing was signed. Run with --env-file=../arkiv-poc/.env.local.",
  );
}
check("access key configured", true, "value not printed");

const chain = rabdi({ accessKey: ACCESS_KEY });
const client = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 0, timeout: 15_000 }),
});

let chainId;
try {
  chainId = await client.getChainId();
} catch (error) {
  blocked(`the endpoint did not answer (${error instanceof Error ? error.message : String(error)}). Nothing was signed.`);
}
check("chain id", chainId === RABDI_CHAIN_ID, `${chainId} (expected ${RABDI_CHAIN_ID})`);

let head;
try {
  head = Number(await client.getBlockNumber());
} catch (error) {
  blocked(`head block unavailable (${error instanceof Error ? error.message : String(error)}). Nothing was signed.`);
}
check("head block readable", Number.isSafeInteger(head) && head > 0, String(head));

let existing = null;
try {
  const page = await client
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", EXPERIMENT_ID))
    .limit(1)
    .fetch();
  existing = page.entities[0]?.$key ?? null;
} catch (error) {
  blocked(
    `the duplicate preflight could not run (${error instanceof Error ? error.message : String(error)}). ` +
      "The duplicate state is unknown, so nothing may be signed.",
  );
}
check(
  `no entity for experimentId "${EXPERIMENT_ID}"`,
  existing === null,
  existing === null ? "clear to publish once" : `already published as ${existing}`,
);

let explorerStatus = 0;
try {
  const response = await fetch(EXPLORER, { method: "HEAD", redirect: "follow" });
  explorerStatus = response.status;
} catch {
  explorerStatus = 0;
}
check("explorer reachable", explorerStatus > 0 && explorerStatus < 400, `HTTP ${explorerStatus}`);

const allOk = checks.every((entry) => entry.ok);
console.log(`\n${allOk ? "READY" : "NOT READY"}: ${checks.filter((e) => e.ok).length}/${checks.length} checks passed.`);
console.log(JSON.stringify({ ok: allOk, experimentId: EXPERIMENT_ID, network: "rabdi", chainId: RABDI_CHAIN_ID, head, existingEntityKey: existing, checks }, null, 2));

if (!allOk) {
  if (existing !== null) {
    blocked(
      `experimentId "${EXPERIMENT_ID}" is already published as ${existing}. ` +
        "A second entity would be a duplicate; do not publish again.",
    );
  }
  process.exit(1);
}
process.exitCode = 0;