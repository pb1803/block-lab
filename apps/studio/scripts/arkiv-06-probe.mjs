#!/usr/bin/env node
/**
 * ARK-06 expiry probe: one short-lived entity, watched from birth to death.
 *
 * Purpose. Arkiv expiry is silent (no event) and a dead key reads exactly like a
 * key that never existed, so the only way to *observe* expiry is to create an
 * entity with a known lifetime, capture it while alive, and read it again after
 * the chain passes its `expiresAt` block. This script does exactly one create,
 * never retries it, and records every read block by block.
 *
 * Dry-run is the default. Without `--live` this script can not broadcast a
 * transaction: it runs the preflight, validates the expiry and payload, prints
 * the predicted entity key, and exercises the poller loop for a few read-only
 * ticks against a key that does not exist. `--live` is the explicit, separate
 * arm for the single authorized run.
 *
 * It never prints a private key, an access key, or anything else from the
 * environment; the signer is derived from ARKIV_PRIVATE_KEY (already in
 * apps/arkiv-poc/.env.local) only when `--live`.
 *
 * Usage:
 *   node --env-file=../arkiv-poc/.env.local scripts/arkiv-06-probe.mjs
 *     [--dry-run]                    # default; cannot broadcast
 *     [--live]                       # arm: exactly one createEntity
 *     [--lifetime-blocks 5]          # lifetime in blocks (default 5)
 *     [--max-blocks 300]             # poller cap after the create (default 300)
 *     [--poll-interval-ms 1500]      # poll cadence (default 1500)
 *     [--json]
 *
 * Exit:
 *   0 dry-run completed cleanly, or live run observed the expiry boundary
 *   1 live run failed (create reverted, poller missed the boundary, …)
 *   2 blocked by preflight (duplicate id, wrong chain, no funds, no key)
 *   3 nothing was created in live mode (no transaction was sent)
 *   4 infrastructure failure
 */
import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  NO_SALT,
  predictEntityKey,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  metadataToPayloadBytes,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import { experimentSchema, experimentValues } from "../src/arkiv/schema.ts";

const RABDI_CHAIN_ID = 7_794_095;
const EXPLORER = "https://rabdi.explorer.arkiv.network";
const EXPERIMENT_ID = "ark06-expiry-001";
/** Fixed so the payload bytes are reproducible across a run (and pastable). */
const STARTED_AT_MS = 1_735_000_000_000;
const EVIDENCE_REF = "evidence/ark06-expiry-001/plan.md";
const UNTOUCHED_ENTITIES = [
  "0x1d7b6bf841deab1a003cc7c1fa407b97e7e27fb6de276dc287b8e2e0551bb31a",
  "0x9038f929ac92b25eb383fa6648290d631c18e5c9976a51fffc9f964adeecbcb7",
  "0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb",
];

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    live: false,
    lifetimeBlocks: 5,
    maxBlocks: 300,
    pollIntervalMs: 1500,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--live") {
      args.live = true;
      args.dryRun = false;
    } else if (flag === "--lifetime-blocks") {
      args.lifetimeBlocks = Number(value);
      if (!Number.isInteger(args.lifetimeBlocks) || args.lifetimeBlocks < 1) {
        blocked(`--lifetime-blocks must be a positive integer, got "${value}".`);
      }
    } else if (flag === "--max-blocks") {
      args.maxBlocks = Number(value);
      if (!Number.isInteger(args.maxBlocks) || args.maxBlocks < 1) {
        blocked(`--max-blocks must be a positive integer, got "${value}".`);
      }
    } else if (flag === "--poll-interval-ms") {
      args.pollIntervalMs = Number(value);
      if (!Number.isInteger(args.pollIntervalMs) || args.pollIntervalMs < 200) {
        blocked(
          `--poll-interval-ms must be an integer of at least 200, got "${value}".`,
        );
      }
    } else if (flag === "--json") args.json = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const accessKey =
  process.env.ARKIV_ACCESS_KEY ?? process.env.VITE_ARKIV_ACCESS_KEY ?? "";
if (accessKey === "") {
  blocked(
    "no Arkiv access key. Run with --env-file=../arkiv-poc/.env.local; nothing was broadcast.",
  );
}

// The private key is read only under `--live` and is never printed or logged.
const privateKey = process.env.ARKIV_PRIVATE_KEY ?? "";
let signerAddress = null;
if (args.live) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    blocked(
      "ARKIV_PRIVATE_KEY is missing or malformed. Nothing was broadcast; check apps/arkiv-poc/.env.local.",
    );
  }
  signerAddress = privateKeyToAccount(privateKey).address;
}

const chain = rabdi({ accessKey });
const publicClient = createPublicClient({
  chain,
  transport: http(undefined, { retryCount: 0, timeout: 15_000 }),
});

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : ` — ${detail}`}`,
  );
}
function finish(exitCode, jsonPayload) {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(jsonPayload, null, 2)}\n`);
  }
  process.exitCode = exitCode;
}

// ── the record ─────────────────────────────────────────────────────────────
function buildMetadata() {
  const digest = createHash("sha256")
    .update(`BLOCKLAB ARK-06 expiry probe ${EXPERIMENT_ID}`, "utf8")
    .digest("hex");
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: EXPERIMENT_ID,
    experimentType: "expiry-probe",
    scenarioName: "entity expiry transition on rabdi",
    targetChainId: RABDI_CHAIN_ID,
    // The result is unknown at creation and the entity dies before it can be
    // written back, so the record is honestly unfinished.
    status: "running",
    startedAtMs: STARTED_AT_MS,
    requestCount: 0,
    succeededCount: 0,
    failedCount: 0,
    rpcFailureCount: 0,
    evidenceDigest: digest,
    evidenceRef: EVIDENCE_REF,
    // The shared contract speaks whole days; the real lifetime is `lifetimeBlocks`
    // blocks and is recorded by the entity's own $expiresAt. Never treat this as
    // the true lifetime.
    expiryDays: 1,
  });
  if (!result.ok) {
    throw new Error(
      result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "),
    );
  }
  return result.metadata;
}

const metadata = buildMetadata();
const payloadBytes = metadataToPayloadBytes(metadata);
console.log(
  `record: ${EXPERIMENT_ID}, status ${metadata.status}, payload ${payloadBytes.length} bytes ` +
    `SHA-256 ${createHash("sha256").update(payloadBytes).digest("hex")}`,
);
console.log(`lifetime: ${args.lifetimeBlocks} block(s) ≈ ${args.lifetimeBlocks * 2} s`);

// ── read-only preflight (never signs) ──────────────────────────────────────
let head;
try {
  head = await publicClient.getBlockNumber();
} catch (error) {
  blocked(`the head block is unavailable (${error.message}). Nothing was broadcast.`);
}
check(
  "chain id",
  (await publicClient.getChainId()) === RABDI_CHAIN_ID,
  String(RABDI_CHAIN_ID),
);
check("head block readable", head > 0n, String(head));

// Expiry parameters, validated without signing: the duration must land in
// `minLifetime` (never `expiresAt`), must resolve strictly after the head, and
// must stay inside the chain cap (`src/consts.ts`: 7 884 000 blocks).
const expiry = ExpirationTime.fromBlocks(args.lifetimeBlocks);
const expiryTarget = head + BigInt(args.lifetimeBlocks);
check(
  "lifetime lands in minLifetime, not expiresAt",
  expiry.minLifetime === BigInt(args.lifetimeBlocks) && expiry.expiresAt === 0n,
  `minLifetime ${expiry.minLifetime}, expiresAt ${expiry.expiresAt}`,
);
check(
  "expiry resolves after the head (dead-on-arrival guard)",
  expiryTarget > head,
  `target ${expiryTarget} vs head ${head}`,
);
check(
  "lifetime within the chain maximum",
  args.lifetimeBlocks <= 7_884_000,
  `${args.lifetimeBlocks} <= 7884000 blocks`,
);

let existing = null;
try {
  const page = await publicClient
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", EXPERIMENT_ID))
    .limit(1)
    .fetch();
  existing = page.entities[0]?.$key ?? null;
} catch (error) {
  blocked(
    `the duplicate query failed (${error.message}). The duplicate state is unknown, so nothing may be broadcast.`,
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
check(
  "explorer reachable",
  explorerStatus > 0 && explorerStatus < 400,
  `HTTP ${explorerStatus}`,
);

// Signer/balance gates (the address is derived without printing anything).
if (args.live) {
  const balance = await publicClient.getBalance({ address: signerAddress });
  check(
    "signer funded",
    balance >= 10_000_000_000_000n, // 0.01 tGLM
    `${(Number(balance) / 1e18).toFixed(6)} tGLM`,
  );
} else {
  check("signer check", true, "skipped in dry-run (no private key read)");
}

const preflightOk = checks.every((entry) => entry.ok);
console.log(
  `\n${preflightOk ? "READY" : "NOT READY"}: ${checks.filter((e) => e.ok).length}/${checks.length} checks passed.`,
);
if (!preflightOk) {
  finish(2, {
    ok: false,
    stage: "preflight",
    experimentId: EXPERIMENT_ID,
    head: Number(head),
    existingEntityKey: existing,
    checks,
  });
  process.exit(2);
}

// ── predicted key: keccak256(chainId ‖ ARKIV ‖ owner ‖ entityNonce ‖ salt) ──
// NO_SALT plus the current entity nonce make the key knowable before the create,
// so the poller can be armed before the transaction is even broadcast.
let predictedKey = null;
let entityNonce = null;
if (args.live) {
  try {
    entityNonce = await publicClient.getEntityNonce(signerAddress);
    predictedKey = predictEntityKey({
      owner: signerAddress,
      nonce: entityNonce,
      salt: NO_SALT,
      chainId: RABDI_CHAIN_ID,
    });
  } catch (error) {
    blocked(`could not predict the entity key (${error.message}).`);
  }
  console.log(`predicted key (entity nonce ${entityNonce}): ${predictedKey}`);
} else {
  console.log(
    "dry-run: no key prediction (no signer); the poller runs against a placeholder key.",
  );
}
// ── poller ──────────────────────────────────────────────────────────────────
// Armed before the create so no early block is missed. One read per tick, block
// tagged, so a boundary sample carries its own block number.
const samples = [];
let stopRequested = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOnce(key) {
  const block = await publicClient.getBlockNumber();
  const started = Date.now();
  try {
    const row = await publicClient.getEntity(key, experimentSchema);
    samples.push({
      block: Number(block),
      latencyMs: Date.now() - started,
      state: "live",
      expiresAt: Number(row.$expiresAt),
      payloadSha256: createHash("sha256")
        .update(Buffer.from(row.payload.value.slice(2), "hex"))
        .digest("hex"),
    });
    return { state: "live", row };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state =
      error?.name === "NoEntityFoundError" || /no live entity/i.test(message)
        ? "missing"
        : /timeout|rate.?limit|429|ECONN|HttpRequestError/i.test(message)
          ? "transport"
          : "unreadable";
    samples.push({ block: Number(block), latencyMs: Date.now() - started, state, error: message });
    return { state, error: message };
  }
}

/**
 * Polls `key` until the boundary or a cap. Returns a summary. `key` may be null
 * in dry-run, where the loop only proves wiring for a few ticks.
 */
async function pollUntilBoundary(key, { capBlocks, pollIntervalMs }) {
  let boundary = null;
  let seenLive = false;
  let seenExpiresAt = null;
  let ticks = 0;
  while (ticks < capBlocks && !stopRequested) {
    const result = await readOnce(key);
    ticks += 1;
    if (result.state === "live") {
      seenLive = true;
      seenExpiresAt = result.row.$expiresAt;
    }
    if (seenLive && result.state === "missing") {
      boundary = { block: samples.at(-1).block, expiresAt: Number(seenExpiresAt) };
      break;
    }
    await sleep(pollIntervalMs);
  }
  return { boundary, seenLive, seenExpiresAt: seenExpiresAt === null ? null : Number(seenExpiresAt), ticks };
}

// ── live create: exactly one transaction, never retried ─────────────────────
let created = null;
if (args.live) {
  const walletClient = createWalletClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: 30_000 }),
    account: privateKeyToAccount(privateKey),
  });

  const beforeNonce = await publicClient
    .getEntityNonce(signerAddress)
    .catch(() => null);

  console.log("creating the probe entity once (signing with ARKIV_PRIVATE_KEY)…");
  try {
    created = await walletClient.createEntity(
      experimentSchema,
      experimentValues(metadata),
      {
        expiration: ExpirationTime.fromBlocks(args.lifetimeBlocks),
        // Fixed salt: the key is then predictable before signing, which is what lets
        // the poller be armed first. Costs nothing here — one create, no squatters.
        salt: NO_SALT,
      },
    );
  } catch (error) {
    // Uncertain outcome: never re-send. Reconcile by whether the entity nonce moved.
    const afterNonce = await publicClient
      .getEntityNonce(signerAddress)
      .catch(() => null);
    const landed =
      beforeNonce !== null && afterNonce !== null && afterNonce > beforeNonce;
    console.error(
      `CREATE FAILED (${error instanceof Error ? error.message : String(error)}). ` +
        `Entity nonce before/after: ${beforeNonce}/${afterNonce}. ` +
        (landed
          ? "The create may have landed despite the error — reconcile with the predicted key before doing anything else."
          : "Nothing appears to have been created. No retry was attempted."),
    );
    finish(1, {
      ok: false,
      stage: "create",
      experimentId: EXPERIMENT_ID,
      reconcile: landed ? "reconcile-by-predicted-key" : "no-create-evident",
    });
    process.exit(1);
  }
  console.log(`created: key ${created.entityKey}, tx ${created.txHash}, expiresAt ${created.expiresAt}`);
  if (created.entityKey !== predictedKey) {
    console.warn(
      `note: the actual key differs from the predicted key (${created.entityKey}). ` +
        "The nonce moved between prediction and signing; the poller follows the actual key.",
    );
  }
} else {
  console.log("dry-run: no transaction. The poller runs read-only against a placeholder key.");
}

// ── poll across the boundary ────────────────────────────────────────────────
const targetKey = created?.entityKey ?? predictedKey ?? `0x${"00".repeat(32)}`;
const dryCap = args.dryRun ? 3 : args.maxBlocks;
console.log(
  args.dryRun
    ? `dry-run: starting the poller for up to ${dryCap} read-only ticks…`
    : `poller armed before the create; watching ${targetKey} for up to ${dryCap} blocks…`,
);

// Interrupt: stop polling cleanly and let the exit code tell the story.
process.on("SIGINT", () => {
  stopRequested = true;
  console.error("\ninterrupted — polling stopped; no further transaction is sent.");
  process.exitCode = 130;
});

const summary = await pollUntilBoundary(targetKey, {
  capBlocks: dryCap,
  pollIntervalMs: args.pollIntervalMs,
});

for (const sample of samples) {
  console.log(
    `sample block ${sample.block} state ${sample.state}` +
      (sample.expiresAt !== undefined ? ` expiresAt ${sample.expiresAt}` : "") +
      (sample.payloadSha256 !== undefined ? ` payload ${sample.payloadSha256}` : "") +
      ` (${sample.latencyMs} ms)`,
  );
}

// ── post-run read-backs and untouched checks ────────────────────────────────
const post = {};
if (args.live) {
  const createdExpiresAt = created.expiresAt;
  const landingBlock = created.expiresAt - BigInt(args.lifetimeBlocks);

  if (summary.seenLive) {
    const liveSample = samples.find((sample) => sample.state === "live");
    post.activeObservation = {
      block: liveSample.block,
      expiresAt: liveSample.expiresAt,
      payloadSha256: liveSample.payloadSha256,
    };
    console.log(
      `active state observed at block ${liveSample.block}: expiresAt ${liveSample.expiresAt}, ` +
        `payload SHA-256 ${liveSample.payloadSha256}`,
    );
  } else {
    console.error("no active-state observation: the entity was never seen live. The experiment cannot pass.");
  }

  if (summary.boundary !== null) {
    console.log(
      `boundary observed: last live block < ${summary.boundary.block} == expiresAt ${summary.boundary.expiresAt}`,
    );
    post.boundary = summary.boundary;
  } else if (summary.seenLive && Number(await publicClient.getBlockNumber()) >= Number(createdExpiresAt)) {
    // The loop ended (cap) without a direct missing sample but the deadline passed.
    const late = await readOnce(targetKey);
    console.log(
      late.state === "missing"
        ? `cap hit; post-cap read at head ${samples.at(-1).block} is missing (expired).`
        : `cap hit; post-cap read at head ${samples.at(-1).block} is ${late.state} — not expired.`,
    );
    post.boundary = {
      block: samples.at(-1).block,
      expiresAt: Number(createdExpiresAt),
      capReached: true,
    };
  } else {
    console.log("poller cap reached before the boundary; extend --max-blocks if needed.");
  }

  // Expiry resolution rule: expiresAt == landingBlock + lifetime.
  post.resolutionRule =
    Number(created.expiresAt) === Number(landingBlock) + args.lifetimeBlocks
      ? "satisfied"
      : "violated";
  console.log(
    `expiry resolution: expiresAt ${created.expiresAt} == landing ${landingBlock} + ${args.lifetimeBlocks} → ${post.resolutionRule}`,
  );

  // Duplicate id must read clear again now that the entity is gone.
  const dup = await publicClient
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", EXPERIMENT_ID))
    .limit(1)
    .fetch()
    .catch(() => null);
  post.duplicateNowClear = dup === null || (dup.entities[0]?.$key ?? null) === null;
  console.log(
    `duplicate query now: ${post.duplicateNowClear ? "clear (id reusable, do not republish)" : "still finds the id"}`,
  );

  // The three pre-existing entities must be untouched.
  post.untouched = [];
  for (const key of UNTOUCHED_ENTITIES) {
    const row = await publicClient.getEntity(key, experimentSchema).catch(() => null);
    const status =
      row === null
        ? "unreadable"
        : `live, expiresAt ${Number(row.$expiresAt)}, payload ${createHash("sha256")
            .update(Buffer.from(row.payload.value.slice(2), "hex"))
            .digest("hex")}`;
    post.untouched.push({ key, status });
    console.log(`untouched check ${key}: ${status}`);
  }

  post.independentVerifyCommand = [
    "node --env-file=../arkiv-poc/.env.local scripts/verify-entity.mjs",
    `--entity ${created.entityKey}`,
    `--tx ${created.txHash}`,
    "--expect-expired",
  ].join(" ");
  console.log(`independent post-expiry verification:\n  ${post.independentVerifyCommand}`);
}

const success =
  args.dryRun ||
  (summary.seenLive &&
    (summary.boundary !== null || post.boundary?.capReached === true));

if (args.live) {
  if (created === null) {
    finish(3, { ok: false, stage: "create", reason: "no transaction was sent" });
    process.exit(3);
  }
  if (success && post.boundary !== undefined) {
    console.log(`\nEXPIRY BOUNDARY OBSERVED: expired at/after block ${post.boundary.expiresAt} (head sample ${post.boundary.block}).`);
  } else {
    console.log(`\nNOT COMPLETE: ${summary.seenLive ? "no boundary observed" : "no active state observed"}.`);
  }
} else {
  console.log("\ndry-run complete: preflight, expiry validation, payload and poller wiring all exercised. Nothing was broadcast.");
}

finish(success ? 0 : 1, {
  ok: success,
  stage: args.dryRun ? "dry-run" : "live",
  experimentId: EXPERIMENT_ID,
  lifetimeBlocks: args.lifetimeBlocks,
  head: Number(head),
  entityKey: created?.entityKey ?? predictedKey ?? null,
  txHash: created?.txHash ?? null,
  samples,
  post: post ?? undefined,
});
