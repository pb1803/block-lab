#!/usr/bin/env node
/**
 * ARK-07 real-wallet driver: a genuine MetaMask publication through Studio.
 *
 * What this script does NOT do: it never creates, imports, reads or stores a
 * private key or seed phrase, and it never clicks MetaMask's approval button.
 * The signature is a real human click in the real wallet; everything else
 * (detection, chain gating, record paste, the publish click, receipt wait,
 * independent read-back) is driven here.
 *
 * It refuses to run against anything that is not MetaMask (`isMetaMask`), so the
 * labelled mock wallet used by `scripts/studio-arkiv-check.mjs` can never be
 * mistaken for a real publication.
 *
 * Prerequisites (all human actions):
 *   1. The Studio dev server:  pnpm --filter @blocklab/studio dev
 *      with `apps/studio/.env.local` carrying VITE_ARKIV_ACCESS_KEY.
 *   2. Chrome fully closed, then started with a debug port so this driver can
 *      attach to YOUR profile (MetaMask stays unlocked):
 *        "C:\Program Files\Google\Chrome\Application\chrome.exe" \
 *          --remote-debugging-port=9229 \
 *          --user-data-dir="C:\Users\<you>\AppData\Local\Google\Chrome\User Data" \
 *          --profile-directory=Default
 *   3. MetaMask unlocked, with the account funded with tGLM on Rabdi.
 *   4. The read-only preflight is green:
 *        node --env-file=apps/arkiv-poc/.env.local \
 *          apps/studio/scripts/studio-arkiv-preflight.mjs
 *
 * Usage:
 *   node --env-file=apps/arkiv-poc/.env.local apps/studio/scripts/studio-arkiv-live.mjs \
 *     --port 9229 --url http://localhost:5178/ [--arm-publish] [--timeout 600]
 *
 * Without `--arm-publish` the driver stops at the approval card and waits for
 * you to click Studio's Publish button. With it, the driver clicks Publish once
 * (still requiring your MetaMask confirmation).
 *
 * Exit: 0 verified, 1 failure, 2 blocked before signing (wrong wallet, wrong
 * chain, no gas, duplicate, preflight unknown), 4 infrastructure.
 */
import { createHash } from "node:crypto";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http } from "viem";
import {
  metadataToPayloadBytes,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import { experimentSchema } from "../src/arkiv/schema.ts";
import { buildRecord, EXPERIMENT_ID } from "./studio-mm-001-record.mjs";

const RABDI_CHAIN_ID = 7_794_095;
const EXPLORER = "https://rabdi.explorer.arkiv.network";

function parseArgs(argv) {
  const args = {
    port: 9229,
    url: "http://localhost:5178/",
    timeoutSec: 600,
    armPublish: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--port") args.port = Number(value);
    else if (flag === "--url") args.url = value;
    else if (flag === "--timeout") args.timeoutSec = Number(value);
    else if (flag === "--arm-publish") args.armPublish = true;
  }
  return args;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(2);
}
function failed(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

class Cdp {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #exceptions = [];

  constructor(socket) {
    this.#socket = socket;
  }

  static async attach(port, url) {
    let page;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        page =
          list.find((entry) => entry.type === "page" && entry.url === url) ??
          list.find((entry) => entry.type === "page");
        if (page !== undefined) break;
      } catch {
        // endpoint not ready yet
      }
      await wait(200);
    }
    if (page === undefined) {
      console.error(
        `No debuggable page on port ${port}. Start Chrome with --remote-debugging-port=${port} ` +
          "and keep at least one tab open.",
      );
      process.exit(4);
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const cdp = new Cdp(socket);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && cdp.#pending.has(message.id)) {
        cdp.#pending.get(message.id).resolve(message);
        cdp.#pending.delete(message.id);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        cdp.#exceptions.push(
          message.params?.exceptionDetails?.exception?.description ??
            message.params?.exceptionDetails?.text ??
            "unknown exception",
        );
      }
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve) => {
      this.#pending.set(id, { resolve });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = response.result?.exceptionDetails;
    if (exception !== undefined) {
      throw new Error(exception.exception?.description ?? exception.text ?? "evaluate failed");
    }
    return response.result?.result?.value;
  }

  exceptions() {
    return this.#exceptions;
  }

  close() {
    this.#socket.close();
  }
}

async function waitFor(cdp, expression, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await cdp.evaluate(expression);
      if (await predicate(last)) return last;
    } catch (error) {
      last = String(error);
    }
    await wait(400);
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

// Studio state carries bigints (expiry block), which CDP cannot return by value,
// so it is serialised with a bigint-to-string replacer.
const STATE =
  "(() => { const s = window.__blocklabStudioArkiv?.read() ?? null;" +
  " return s === null ? null : JSON.stringify(s, (k, v) => typeof v === 'bigint' ? v.toString() : v); })()";

/** Parses a serialised Studio state, or null when it is not usable yet. */
function stateOf(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Stable JSON (sorted keys) for exact structural comparison. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clickAction(action) {
  return `(() => {
    const node = document.querySelector('[data-action="${action}"]');
    if (node === null) return "missing";
    if (node.disabled === true || node.hidden === true) return "unavailable";
    node.click();
    return "clicked";
  })()`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const accessKey = process.env.ARKIV_ACCESS_KEY ?? process.env.VITE_ARKIV_ACCESS_KEY ?? "";
  if (accessKey === "") {
    blocked(
      "no Arkiv access key. Re-run with --env-file=apps/arkiv-poc/.env.local so the " +
        "gateway, preflight and independent read-back can reach Rabdi.",
    );
  }

  const record = buildRecord();
  const canonicalBytes = metadataToPayloadBytes(record);
  const canonicalJson = new TextDecoder().decode(canonicalBytes);
  const payloadSha256 = createHash("sha256").update(canonicalBytes).digest("hex");

  const cdp = await Cdp.attach(args.port, args.url);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: args.url });

  // 1. The wallet must be real MetaMask. Anything else stops here.
  const walletKind = await waitFor(
    cdp,
    `(() => {
      const eth = window.ethereum;
      if (!eth) return "none";
      return JSON.stringify({ isMetaMask: eth.isMetaMask === true, multi: Array.isArray(eth.providers) });
    })()`,
    (value) => value !== "none",
    20_000,
    "an injected EIP-1193 provider",
  ).catch(() => "none");
  if (walletKind === "none") {
    blocked(
      "no window.ethereum. MetaMask is not available in this page: open Studio in the " +
        "Chrome instance that has MetaMask enabled and unlocked. No transaction was sent.",
    );
  }
  const wallet = JSON.parse(walletKind);
  if (wallet.isMetaMask !== true) {
    blocked(
      "window.ethereum does not identify as MetaMask (`isMetaMask` is not true). This " +
        "driver only attests a real MetaMask wallet; the mock used by studio-arkiv-check.mjs " +
        "is deliberately refused here. No transaction was sent.",
    );
  }
  console.log("wallet: MetaMask detected");

  // 2. Connect (a first-time MetaMask approval popup is yours to accept).
  let state = stateOf(
    await waitFor(cdp, STATE, (value) => stateOf(value) !== null, 20_000, "Studio state"),
  );
  if (state?.wallet?.status === "disconnected" || state?.wallet?.status === "missing") {
    const result = await cdp.evaluate(clickAction("connect"));
    console.log(`connect click: ${result}`);
  }
  await waitFor(
    cdp,
    STATE,
    (value) =>
      stateOf(value)?.wallet?.status === "connected" ||
      stateOf(value)?.wallet?.status === "wrong-network",
    120_000,
    "the wallet connection (approve the MetaMask popup if it appears)",
  ).catch((error) => {
    console.error(String(error.message));
    blocked("the wallet did not report a connected account. Nothing was signed.");
  });
  state = stateOf(await cdp.evaluate(STATE));

  // 3. Chain gating: Studio offers the switch; it never switches silently.
  if (state.wallet.status === "wrong-network") {
    console.log(`wrong network (${state.wallet.chainIdHex}); requesting an explicit switch`);
    const result = await cdp.evaluate(clickAction("switch-network"));
    console.log(`switch click: ${result}`);
    // A switch may also raise a MetaMask popup; it is still the human's click.
    await waitFor(
      cdp,
      STATE,
      (value) =>
        stateOf(value)?.wallet?.status === "connected" &&
        String(stateOf(value)?.wallet?.chainIdHex).toLowerCase() === "0x76edaf",
      120_000,
      "the wallet to be on Rabdi 0x76edaf (approve the switch in MetaMask if asked)",
    ).catch(() => {
      blocked("the wallet is not on Rabdi 0x76edaf. No transaction was sent.");
    });
    state = stateOf(await cdp.evaluate(STATE));
  }
  const chainHex = String(state.wallet.chainIdHex).toLowerCase();
  if (chainHex !== "0x76edaf") {
    blocked(`unexpected chain ${chainHex}. No transaction was sent.`);
  }
  const signer = String(state.wallet.address);
  console.log(`connected account: ${signer}`);
  console.log(`chain: ${chainHex} (Rabdi ${RABDI_CHAIN_ID})`);

  // 4. Gas check before any interaction that could sign.
  const balanceHex = await cdp.evaluate(
    `(() => window.ethereum.request({ method: "eth_getBalance", params: [${JSON.stringify(signer)}, "latest"] }))()`,
  );
  const balanceWei = BigInt(balanceHex);
  const balanceTglm = Number(balanceWei) / 1e18;
  console.log(`balance: ${balanceTglm} tGLM`);
  if (balanceWei === 0n) {
    blocked(
      `the connected account ${signer} has 0 tGLM on Rabdi, so it cannot pay for the write. ` +
        "Fund it at https://hub.arkiv.network/faucet (Rabdi, tGLM). Nothing was signed.",
    );
  }

  // 5. Duplicate preflight (read-only, same schema Studio writes with).
  const publicClient = createPublicClient({
    chain: rabdi({ accessKey }),
    transport: http(undefined, { retryCount: 0, timeout: 15_000 }),
  });
  const page = await publicClient
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", EXPERIMENT_ID))
    .limit(1)
    .fetch();
  const existingKey = page.entities[0]?.$key ?? null;
  if (existingKey !== null) {
    console.log(`already published: ${existingKey}`);
    blocked(
      `experimentId "${EXPERIMENT_ID}" already exists as ${existingKey}. Refusing to ` +
        "create a duplicate; nothing was signed. Use a new test id for a new run.",
    );
  }
  console.log(`preflight: no entity for experimentId "${EXPERIMENT_ID}"`);

  // 6. Paste the canonical record and check it was accepted as-is.
  const docJson = JSON.stringify(record);
  await cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="sr-record-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(node, ${JSON.stringify(docJson)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);
  const acceptedJson = await waitFor(
    cdp,
    STATE,
    (value) => stateOf(value)?.publish?.metadata?.experimentId === EXPERIMENT_ID,
    15_000,
    "the record to be validated by Studio",
  );
  const accepted = stateOf(acceptedJson).publish.metadata;
  if (stableJson(accepted) !== stableJson(JSON.parse(canonicalJson))) {
    failed(
      "Studio's validated record differs from the canonical record. Refusing to publish; " +
        "nothing was signed.",
    );
  }
  console.log(`record accepted: ${EXPERIMENT_ID} (payload sha256 ${payloadSha256})`);

  // 7. Approval card. This is the only place a human decision is required twice:
  //    clicking Publish (or --arm-publish) and confirming in MetaMask.
  console.log("\n--- approval card ---------------------------------------------------");
  console.log(`  experiment id : ${EXPERIMENT_ID}`);
  console.log("  scenario      : Studio wallet-signed publication test");
  console.log(`  signer        : ${signer} (MetaMask)`);
  console.log(`  network       : Rabdi ${chainHex}`);
  console.log(`  lifetime      : ${record.expiryDays} days`);
  console.log(`  digest        : ${record.evidenceDigest}`);
  console.log(`  payload sha256: ${payloadSha256}`);
  console.log("  publishes exactly one compact, validated record; evidence stays local.");
  console.log("---------------------------------------------------------------------\n");

  if (args.armPublish) {
    const result = await cdp.evaluate(clickAction("publish"));
    console.log(`publish click: ${result}`);
    if (result !== "clicked") {
      blocked(
        `Studio's publish button is not available (${result}), so nothing was clicked. ` +
          "Nothing was signed.",
      );
    }
  } else {
    console.log("Waiting for you to click Studio's Publish button (no automatic publishing).");
  }

  // 8. Wait for confirmation. Any failure is reported as-is; nothing is retried.
  let confirmed;
  try {
    confirmed = await waitFor(
      cdp,
      STATE,
      (value) =>
        stateOf(value)?.publish?.phase === "confirmed" ||
        stateOf(value)?.publish?.phase === "existing" ||
        stateOf(value)?.publish?.phase === "failed",
      args.timeoutSec * 1000,
      "the publish result (confirm in MetaMask, then wait for the receipt)",
    );
  } catch (error) {
    // Uncertain outcome: check for the entity before saying anything.
    const after = await publicClient
      .select({ $key: true })
      .from(experimentSchema)
      .where(eq("experimentId", EXPERIMENT_ID))
      .limit(1)
      .fetch()
      .catch(() => undefined);
    const afterKey = after?.entities[0]?.$key ?? null;
    console.error(String(error.message));
    if (afterKey !== null) {
      console.error(
        `The write may still have landed: entity ${afterKey} exists. Not re-signing.`,
      );
    } else {
      console.error("No entity exists for this id; nothing was written. Not retrying.");
    }
    process.exit(1);
  }

  const publish = stateOf(confirmed).publish;
  if (publish.phase === "failed") {
    // Never retry blindly: report the failure and check the entity once.
    const after = await publicClient
      .select({ $key: true })
      .from(experimentSchema)
      .where(eq("experimentId", EXPERIMENT_ID))
      .limit(1)
      .fetch()
      .catch(() => undefined);
    const afterKey = after?.entities[0]?.$key ?? null;
    console.error(`publish failed: ${JSON.stringify(publish.error ?? null)}`);
    if (afterKey !== null) {
      console.error(
        `An entity now exists at ${afterKey} despite the error; nothing was re-signed. ` +
          "Verify it before trying again.",
      );
    } else {
      console.error("No entity exists; nothing was written. Not retrying.");
    }
    process.exit(1);
  }

  const entityKey = String(publish.entityKey);
  const txHash = publish.txHash === undefined ? null : String(publish.txHash);
  console.log(`phase: ${publish.phase}`);
  console.log(`entity key: ${entityKey}`);
  if (txHash !== null) console.log(`tx hash: ${txHash}`);

  // 9. Independent read-back in this separate process (not via Studio's state).
  const row = await publicClient.getEntity(entityKey, experimentSchema);
  const onChainBytes =
    row.payload?.value === undefined
      ? new Uint8Array()
      : Buffer.from(String(row.payload.value).slice(2), "hex");
  const byteIdentical =
    onChainBytes.length === canonicalBytes.length &&
    Buffer.from(canonicalBytes).equals(onChainBytes);
  const storedJson = byteIdentical ? new TextDecoder().decode(onChainBytes) : null;
  let revalidated = false;
  if (storedJson !== null) {
    try {
      revalidated = validateExperimentMetadata(JSON.parse(storedJson)).ok;
    } catch {
      revalidated = false;
    }
  }
  const owner = String(row.$owner);
  const creator = String(row.$creator);

  let receipt = null;
  if (txHash !== null) {
    receipt = await publicClient
      .getTransactionReceipt({ hash: txHash })
      .catch(() => null);
  }
  const gasUsed = receipt === null ? null : Number(receipt.gasUsed);
  const gasPrice = receipt === null ? null : Number(receipt.effectiveGasPrice);
  const gasCostWei = gasUsed !== null && gasPrice !== null ? gasUsed * gasPrice : null;

  const findAgain = await publicClient
    .select({ $key: true })
    .from(experimentSchema)
    .where(eq("experimentId", EXPERIMENT_ID))
    .limit(1)
    .fetch()
    .catch(() => undefined);

  const evidence = {
    kind: "blocklab.arkiv-publication",
    experimentId: EXPERIMENT_ID,
    network: { name: "rabdi", chainId: RABDI_CHAIN_ID, chainIdHex: "0x76edaf" },
    wallet: { provider: "MetaMask", address: signer },
    txHash,
    receiptStatus: receipt === null ? null : receipt.status,
    blockNumber: receipt === null ? null : Number(receipt.blockNumber),
    entityKey,
    owner,
    creator,
    ownerEqualsCreator: owner.toLowerCase() === creator.toLowerCase(),
    ownerEqualsSigner: owner.toLowerCase() === signer.toLowerCase(),
    createdAtBlock: Number(row.$createdAt),
    updatedAtBlock: Number(row.$updatedAt),
    expiresAtBlock: Number(row.$expiresAt),
    payloadSha256,
    payloadBytes: onChainBytes.length,
    byteIdenticalToSubmitted: byteIdentical,
    revalidatesAgainstSharedSchema: revalidated,
    findableByExperimentId: (findAgain?.entities[0]?.$key ?? null) === entityKey,
    explorer: `${EXPLORER}/entity/${entityKey}`,
    gas: {
      gasUsed,
      effectiveGasPriceWei: gasPrice,
      costWei: gasCostWei,
      costTglm: gasCostWei === null ? null : gasCostWei / 1e18,
    },
    studioReadBack: publish.readBack ?? null,
    verified:
      byteIdentical &&
      revalidated &&
      owner.toLowerCase() === signer.toLowerCase() &&
      receipt !== null &&
      receipt.status === "success",
  };

  console.log("\n--- independent read-back verification ------------------------------");
  console.log(JSON.stringify(evidence, null, 2));
  const exceptions = cdp.exceptions();
  if (exceptions.length > 0) {
    console.log(`page exceptions: ${exceptions.slice(0, 3).join(" | ")}`);
  }
  cdp.close();

  if (evidence.verified) {
    console.log("\nVERIFIED: one MetaMask-signed Arkiv publication, read back and byte-compared.");
    process.exitCode = 0;
  } else {
    console.error("\nNOT VERIFIED: the read-back did not fully match. Nothing is claimed.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});