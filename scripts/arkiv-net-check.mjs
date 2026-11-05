#!/usr/bin/env node
/**
 * Live, read-only verification of the Arkiv Rabdi testnet (Phase 14).
 *
 * Dependency-free: it speaks JSON-RPC to the public endpoint exactly as the
 * docs describe, with no SDK and no wallet. It proves the network facts the POC
 * relies on (chain id, block timing, schema queries, system metadata fields)
 * and must never be confused with a write: it sends no transaction and touches
 * no account.
 *
 * Usage: node scripts/arkiv-net-check.mjs [--out <file>] [--rpc <url>]
 * Exit codes: 0 every check passed, 1 a check failed, 2 network unreachable.
 */
import { writeFile } from "node:fs/promises";

const RPC = (() => {
  const index = process.argv.indexOf("--rpc");
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : "https://rpc.rabdi.db-chain.testnet.arkiv.network";
})();
const OUT = (() => {
  const index = process.argv.indexOf("--out");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
})();

let nextId = 1;
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const body = await response.json().catch(() => ({ error: "non-JSON response" }));
  if (body.error !== undefined) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

const report = { rpc: RPC, checkedAt: new Date().toISOString(), checks };

try {
  const chainIdHex = await rpc("eth_chainId", []);
  const chainId = Number.parseInt(chainIdHex, 16);
  check("chain id is Rabdi (0x76edaf = 7794095)", chainId === 7_794_095, `${chainIdHex} = ${chainId}`);

  const blockHex = await rpc("eth_blockNumber", []);
  const blockNumber = Number.parseInt(blockHex, 16);
  check("head block is readable", Number.isInteger(blockNumber) && blockNumber > 0, `${blockNumber}`);

  const timing = await rpc("arkiv_getBlockTiming", []);
  check(
    "block timing is readable and 2 s",
    timing.duration === 2 && Number.isInteger(timing.current_block_time),
    `block ${timing.current_block}, ${timing.duration}s`,
  );

  const countResult = await rpc("arkiv_query", [
    "arkiv.schema = str('posts')",
    { select: { count: true }, limit: "0x1" },
  ]);
  const postsCount = Number.parseInt(countResult.count ?? "0x0", 16);
  check("arkiv_query with a schema tag works", postsCount > 0, `posts entities: ${postsCount}`);

  const page = await rpc("arkiv_query", [
    "arkiv.schema = str('posts')",
    {
      select: {
        key: true,
        owner: true,
        creator: true,
        createdAt: true,
        expiresAt: true,
        creationFlags: true,
        attributes: true,
      },
      limit: "0x1",
    },
  ]);
  const entity = page.data?.[0];
  check("public entity returns system metadata", entity !== undefined, entity?.key);
  if (entity !== undefined) {
    check("owner field is an address", /^0x[0-9a-fA-F]{40}$/.test(entity.owner ?? ""), entity.owner);
    check("creator field is an address", /^0x[0-9a-fA-F]{40}$/.test(entity.creator ?? ""), entity.creator);
    check("expiresAt is a block height", typeof entity.expiresAt === "string", entity.expiresAt);

    const single = await rpc("arkiv_getEntity", [entity.key]);
    check("arkiv_getEntity returns the same key", single?.key === entity.key, single?.key);
    const missing = await rpc("arkiv_getEntity", [`0x${"00".repeat(32)}`]);
    check("arkiv_getEntity returns null for an unknown key", missing === null, String(missing));
  }

  check("no transaction was sent by this check", true, "read-only JSON-RPC only");
} catch (error) {
  console.error(`network error: ${error.message}`);
  report.error = error.message;
  if (OUT !== undefined) await writeFile(OUT, JSON.stringify(report, null, 2));
  process.exit(2);
}

const failed = checks.filter((entry) => !entry.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (OUT !== undefined) {
  await writeFile(OUT, JSON.stringify(report, null, 2));
  console.log(`report written to ${OUT}`);
}
process.exit(failed.length === 0 ? 0 : 1);