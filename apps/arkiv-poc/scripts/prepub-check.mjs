#!/usr/bin/env node
/**
 * BLOCKLAB — Arkiv pre-publication verification (READ-ONLY).
 *
 * Runs the eight checks that must pass before the first real `blocklab.experiment`
 * publication. It never signs, never sends a transaction, never writes to the
 * chain, and never prints the private key or the access key.
 *
 *   node --env-file=.env.local scripts/prepub-check.mjs
 *
 * Exit code 0 = every check passed; 1 = at least one failed; 2 = the script
 * could not run (missing .env.local, missing signer).
 *
 * Notes on what is read from where:
 * - keys and addresses: `apps/arkiv-poc/.env.local` (git-ignored)
 * - chain reads: Rabdi RPC, authenticated with the access key in the URL path
 * - duplicate preflight: the same shared helper the UI and the write harness use
 * - funding transaction: a bounded backward scan of recent blocks, because the
 *   chain serves state at the head only (no historical `eth_getBalance`) and the
 *   explorer index lists Arkiv entity transactions, not native value transfers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(APP_DIR, "..", "..");
const ENV_PATH = resolve(APP_DIR, ".env.local");
const EXPECTED_SIGNER = "0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759";
const EXPERIMENT_ID = "poc-write-001";
const FUNDING_SCAN_BLOCKS = 4_000;
const MAX_GAS = 2n ** 24n; // SDK MAX_TRANSACTION_GAS
const GAS_HEADROOM_PERCENT = 25n; // SDK GAS_HEADROOM_PERCENT
const OBSERVED_CREATE_GAS = 26_250n; // measured on this create path earlier

const checks = [];
function record(number, name, ok, detail) {
  checks.push({ number, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${number}. ${name}: ${detail}`);
}

if (!existsSync(ENV_PATH)) {
  console.error(`No ${ENV_PATH}; nothing to verify.`);
  process.exit(2);
}

/** Parses KEY=VALUE lines without exposing values. */
function readEnv() {
  const out = new Map();
  for (const raw of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return out;
}
const env = readEnv();

const privateKey = env.get("ARKIV_PRIVATE_KEY") ?? "";
const accessKey = env.get("ARKIV_ACCESS_KEY") ?? "";
const viteAccessKey = env.get("VITE_ARKIV_ACCESS_KEY") ?? "";
const tglm = (wei) => `${(Number(wei) / 1e18).toFixed(6)} tGLM`;

// ---------------------------------------------------------------- 3. signer
let signer = "";
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  record(3, "signer derivation", false, "ARKIV_PRIVATE_KEY is missing or not 0x + 64 hex");
} else {
  try {
    signer = privateKeyToAccount(privateKey).address;
    record(
      3,
      "signer derivation",
      signer.toLowerCase() === EXPECTED_SIGNER.toLowerCase(),
      `derived ${signer} (expected ${EXPECTED_SIGNER})`,
    );
  } catch (error) {
    record(3, "signer derivation", false, String(error));
  }
}

// --------------------------------------------------------- 5. access keys
{
  const bothSet = accessKey !== "" && viteAccessKey !== "";
  const equal = bothSet && accessKey === viteAccessKey;
  const distinctFromSigner = bothSet && accessKey !== privateKey;
  const ok = bothSet && equal && distinctFromSigner;
  record(
    5,
    "access keys configured",
    ok,
    ok
      ? `both set and equal (${accessKey.length} chars), distinct from the private key; values not printed`
      : `bothSet=${bothSet} equal=${equal} distinctFromSigner=${distinctFromSigner}; values not printed`,
  );
}

// --------------------------------------------------------------- 4. secrets
{
  const git = (...args) =>
    execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let ignored = false;
  let tracked = false;
  let staged = [];
  try {
    ignored = git("check-ignore", "-q", ENV_PATH) === "" && git("check-ignore", ENV_PATH) !== "";
  } catch {
    ignored = false;
  }
  try {
    git("ls-files", "--error-unmatch", ENV_PATH);
    tracked = true;
  } catch {
    tracked = false;
  }
  try {
    staged = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
  } catch {
    staged = [];
  }
  const stagedEnv = staged.filter((f) => /(^|\/)\.env(\..*)?$/.test(f));
  const stagedSecretShape = stagedEnv.filter((f) => !f.endsWith(".env.example"));
  const ok = ignored && !tracked && stagedSecretShape.length === 0;
  record(
    4,
    ".env.local ignored, nothing secret staged",
    ok,
    `ignored=${ignored} tracked=${tracked} stagedEnvFiles=${stagedSecretShape.length === 0 ? "none" : stagedSecretShape.join(",")}`,
  );
}

// ----------------------- shared query code (loaded once, reads only)
const { experimentSchema } = await import(
  pathToFileURL(resolve(APP_DIR, "src/entity/experiment-schema.ts")).href
);
const { findExistingExperimentKey } = await import(
  pathToFileURL(resolve(APP_DIR, "src/repository.ts")).href
);

// ------------------------------------------------------- chain client / 6
const chain = rabdi({ accessKey });
const client = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 0, timeout: 15_000 }),
});
const rpcUrl = chain.rpcUrls.default.http[0]; // contains the access key; never printed

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}
const hexBlock = (n) => `0x${n.toString(16)}`;

let head = 0;
try {
  const chainId = await client.getChainId();
  head = Number(await client.getBlockNumber());
  const rounds = [];
  for (let i = 1; i <= 3; i += 1) {
    const page = await client.select({ $key: true }).from(experimentSchema).limit(1).fetch();
    rounds.push(page.entities.length);
  }
  record(
    6,
    "authenticated RPC connectivity",
    chainId === 7794095,
    `chain ${chainId} (expected 7794095), head block ${head}, arkiv_query 3/3 rounds ok (no 429/401)`,
  );
} catch (error) {
  record(6, "authenticated RPC connectivity", false, String(error));
}

// ---------------------------------------------------------------- 2. balance
let balanceWei = 0n;
try {
  const raw = await rpc("eth_getBalance", [EXPECTED_SIGNER, "latest"]);
  balanceWei = BigInt(raw);
  record(2, "live signer balance", balanceWei > 0n, `${tglm(balanceWei)} (${balanceWei} wei)`);
} catch (error) {
  record(2, "live signer balance", false, String(error));
}

// ------------------------------------------------------- 1. funding transfer
try {
  if (head === 0) throw new Error("chain head unknown; connectivity check failed");
  const wanted = EXPECTED_SIGNER.toLowerCase();
  const first = Math.max(0, head - FUNDING_SCAN_BLOCKS);
  let found = null;
  for (let cursor = head; cursor > first && found === null; cursor -= 8) {
    const numbers = [];
    for (let n = cursor; n > first && numbers.length < 8; n -= 1) numbers.push(n);
    const blocks = await Promise.all(numbers.map((n) => rpc("eth_getBlockByNumber", [hexBlock(n), true])));
    for (const block of blocks) {
      if (!block) continue;
      const hit = (block.transactions ?? []).find((tx) => tx?.to?.toLowerCase?.() === wanted);
      if (hit) {
        found = { block, tx: hit };
        break;
      }
    }
  }
  if (found === null) {
    record(1, "funding transaction", false, `no incoming transfer in the last ${FUNDING_SCAN_BLOCKS} blocks`);
  } else {
    const { block, tx } = found;
    const receipt = await rpc("eth_getTransactionReceipt", [tx.hash]);
    const date = new Date(Number(block.timestamp) * 1000).toISOString();
    const value = BigInt(tx.value ?? "0x0");
    const coversBalance = value === balanceWei;
    const succeeded = receipt?.status === "0x1";
    record(
      1,
      "funding transaction",
      value > 0n && succeeded,
      `block ${Number(block.number)} (${date}) tx ${tx.hash} from ${tx.from} value ${tglm(value)}${coversBalance ? " = full balance (single deposit)" : " (balance also has other movements)"} status ${succeeded ? "success" : "FAILED"}, gas used ${receipt ? Number(BigInt(receipt.gasUsed)) : "?"}`,
    );
  }
} catch (error) {
  record(1, "funding transaction", false, String(error));
}

// ------------------------------------------------------ 7. duplicate check
try {
  const existing = await findExistingExperimentKey(client, experimentSchema, EXPERIMENT_ID);
  record(
    7,
    "duplicate preflight",
    existing === null,
    existing === null
      ? `experimentId "${EXPERIMENT_ID}": no existing entity, safe to create`
      : `experimentId "${EXPERIMENT_ID}" already exists at ${existing}; do not re-sign`,
  );
} catch (error) {
  record(7, "duplicate preflight", false, `check could not run (treat as unknown, do not sign): ${String(error)}`);
}

// ------------------------------------------------------------- 8. funds
try {
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  const realisticGas = (OBSERVED_CREATE_GAS * (100n + GAS_HEADROOM_PERCENT)) / 100n;
  const realisticCostWei = realisticGas * gasPrice;
  const worstCostWei = MAX_GAS * gasPrice;
  const ok = balanceWei >= worstCostWei;
  record(
    8,
    "funds sufficient for one publication",
    ok,
    `gas price ${gasPrice} wei; realistic ~${realisticGas} gas = ${tglm(realisticCostWei)}; SDK worst-case cap ${tglm(worstCostWei)}; balance ${tglm(balanceWei)} (${ok ? "covers the worst case" : "does NOT cover the worst case"})`,
  );
} catch (error) {
  record(8, "funds sufficient for one publication", false, String(error));
}

// ------------------------------------------------------------------ summary
const passed = checks.filter((c) => c.ok).length;
const failed = checks.length - passed;
console.log(`\nSUMMARY ${passed}/${checks.length} checks passed${failed === 0 ? " — ready to publish on explicit approval" : " — publication not safe"}.`);
if (failed > 0) {
  for (const c of checks.filter((entry) => !entry.ok)) console.log(`  BLOCKED ${c.number}. ${c.name}: ${c.detail}`);
  process.exit(1);
}
