#!/usr/bin/env node
/**
 * Real-browser check of the Arkiv POC (Phase 14).
 *
 * Drives headless Chrome over CDP (no browser-automation dependency), loads the
 * POC with ?selftest=1 so the page itself performs a live, read-only Rabdi
 * probe through the real SDK, then inspects the UI and the requests the page
 * made. It asserts the POC never sends a transaction, never fabricates a write,
 * and renders the correct wallet/network states when no wallet is installed.
 *
 * Exit codes: 0 all checks passed, 1 browser driver error, 4 the page never
 * reached the expected state, 5 a check failed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter((value) => typeof value === "string" && value.length > 0);

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:5173/?selftest=1",
    timeoutMs: 240_000,
    port: 9490,
    label: "run",
    mode: "self-test",
    retries: 2,
    out: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === "--url" && next !== undefined) options.url = next;
    if (argv[index] === "--timeout" && next !== undefined) {
      options.timeoutMs = Number.parseInt(next, 10);
    }
    if (argv[index] === "--port" && next !== undefined) {
      options.port = Number.parseInt(next, 10);
    }
    if (argv[index] === "--label" && next !== undefined) options.label = next;
    if (argv[index] === "--mode" && next !== undefined) options.mode = next;
    if (argv[index] === "--retries" && next !== undefined) {
      options.retries = Number.parseInt(next, 10);
    }
    if (argv[index] === "--out" && next !== undefined) options.out = next;
  }
  return options;
}

class Cdp {
  #socket;
  #pending = new Map();
  #listeners = new Map();
  #nextId = 0;
  requests = [];

  static async connect(port) {
    const target = await Cdp.waitForPage(port);
    const cdp = new Cdp();
    cdp.#socket = new WebSocket(target.webSocketDebuggerUrl);
    cdp.#socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const resolve = cdp.#pending.get(message.id);
        if (resolve !== undefined) {
          cdp.#pending.delete(message.id);
          resolve(message);
        }
        return;
      }
      for (const listener of cdp.#listeners.get(message.method) ?? []) {
        listener(message.params);
      }
    };
    await new Promise((resolve, reject) => {
      cdp.#socket.onopen = resolve;
      cdp.#socket.onerror = () => reject(new Error("CDP socket failed"));
    });
    return cdp;
  }

  static async waitForPage(port) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((target) => target.type === "page");
        if (page !== undefined) return page;
      } catch {
        // DevTools endpoint is not ready yet.
      }
      await sleep(250);
    }
    throw new Error("Chrome DevTools endpoint did not become available.");
  }

  on(method, listener) {
    const current = this.#listeners.get(method) ?? [];
    current.push(listener);
    this.#listeners.set(method, current);
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails !== undefined) {
      throw new Error(
        `page evaluation failed: ${response.result.exceptionDetails.text ?? "unknown"}`,
      );
    }
    return response.result?.result?.value;
  }

  close() {
    this.#socket.close();
  }
}

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome or Edge executable found. Set CHROME_PATH.");
}

async function waitForSelfTest(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let status;
    try {
      status = await cdp.evaluate("window.__blocklabArkivSelfTestStatus ?? null");
    } catch (error) {
      console.error(`poll error: ${error.message}`);
      status = undefined;
    }
    if (process.env.ARKIV_CHECK_DEBUG === "1") console.error(`poll status: ${String(status)}`);
    if (status === "done" || status === "error") return status;
    await sleep(500);
  }
  return undefined;
}

/**
 * Injects a deliberately MOCK EIP-1193 wallet (no signing, no transaction) to
 * exercise the real UI state machine against a wrong network and a user
 * rejection. Nothing here produces a transaction hash or claims a write.
 */
function mockWalletScript(mode) {
  const chainId = mode === "wallet-mismatch" ? "0x1" : "0x76edaf";
  return `(() => {
    const accounts = ["0x1111111111111111111111111111111111111111"];
    const reject = (message) => Object.assign(new Error(message), { code: 4001 });
    window.__blocklabMockWalletCalls = [];
    window.ethereum = {
      isBlocklabMockWallet: true,
      on: () => {},
      removeListener: () => {},
      request: async ({ method }) => {
        window.__blocklabMockWalletCalls.push(method);
        if (method === "eth_chainId") return ${JSON.stringify(chainId)};
        if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
        if (method === "wallet_revokePermissions") return null;
        if (method === "wallet_switchEthereumChain") {
          throw reject("User rejected the network switch (mock wallet)");
        }
        if (method === "eth_blockNumber") return "0x10";
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_getTransactionCount") return "0x0";
        if (method === "eth_call") return "0x";
        if (method === "eth_sendTransaction" || method === "eth_sendRawTransaction") {
          throw reject("User rejected the transaction (mock wallet: nothing was signed)");
        }
        throw Object.assign(new Error("mock wallet: unsupported " + method), { code: -32601 });
      },
    };
  })();`;
}

async function waitForState(cdp, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await cdp.evaluate("window.__blocklabArkivState ?? null");
    if (state !== null && predicate(state)) return state;
    await sleep(300);
  }
  const last = await cdp.evaluate("window.__blocklabArkivState ?? null");
  throw new Error(
    `state never reached: ${label}; last state: ${JSON.stringify({
      wallet: last?.wallet?.status,
      publish: last?.publish?.status,
      publishError: last?.publish?.error,
    })}`,
  );
}

async function click(cdp, id) {
  await cdp.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`);
}

async function runWalletMode(cdp, options) {
  const mock = mockWalletScript(options.mode);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: mock });

  // The unauthenticated `arkiv_query` budget on the public endpoint is
  // exhausted (HTTP 429 ANON_COST_LIMITED), so the duplicate check cannot
  // reach the network. Stub only that read with an empty result so the wallet
  // rejection path can still be exercised. No write is stubbed or faked.
  if (options.mode === "wallet-reject") {
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*rpc.rabdi.db-chain.testnet.arkiv.network/*", requestStage: "Request" }],
    });
    cdp.on("Fetch.requestPaused", async (params) => {
      try {
        const postData = params.request.postData ?? "";
        if (postData.includes("arkiv_query")) {
          const idMatch = /"id"\s*:\s*(\d+)/.exec(postData);
          const id = idMatch === null ? 1 : Number(idMatch[1]);
          const body = Buffer.from(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: { data: [], blockNumber: "0x10" },
            }),
          ).toString("base64");
          await cdp.send("Fetch.fulfillRequest", {
            requestId: params.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "content-type", value: "application/json" },
              { name: "access-control-allow-origin", value: "*" },
            ],
            body,
          });
          return;
        }
        await cdp.send("Fetch.continueRequest", { requestId: params.requestId });
      } catch (error) {
        console.error(`fetch intercept failed: ${error.message}`);
      }
    });
  }
  await cdp.send("Page.navigate", { url: options.url.replace("?selftest=1", "") });

  await click(cdp, "connect");
  if (options.mode === "wallet-mismatch") {
    const state = await waitForState(cdp, (s) => s.wallet.status === "wrong-network", "wrong network");
    const ui = await cdp.evaluate(`(() => ({
      networkText: document.getElementById("network-status")?.textContent ?? "",
      switchHidden: document.getElementById("switch-network")?.hidden ?? null,
      publishDisabled: document.getElementById("publish")?.disabled ?? null,
      walletText: document.getElementById("wallet-status")?.textContent ?? "",
    }))()`);
    check(ui.networkText.includes("Wrong network"), `network text: ${ui.networkText}`);
    check(ui.switchHidden === false, "switch button is offered on the wrong network");
    check(ui.publishDisabled === true, "publish stays disabled on the wrong network");
    check(state.publish.entityKey === undefined, "no entity key exists on the wrong network");

    await click(cdp, "switch-network");
    await sleep(1_500);
    const after = await waitForState(cdp, () => true, "switch attempt");
    const text = await cdp.evaluate(`document.getElementById("wallet-status")?.textContent ?? ""`);
    check(text.includes("rejected"), `switch rejection surfaced: ${text}`);
    check(after.publish.status === "idle", "a rejected switch leaves publish idle");

    const writes = cdp.requests.filter((request) =>
      (request.postData ?? "").includes("eth_sendTransaction"),
    );
    check(writes.length === 0, `no transaction on a wrong network (${writes.length})`);
  } else if (options.mode === "wallet-reject") {
    const baseUrl = options.url.replace("?selftest=1", "");
    const maxAttempts = Math.max(1, options.retries + 1);
    let connected = undefined;
    let failed = undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        await cdp.send("Page.navigate", { url: `${baseUrl}?attempt=${attempt}` });
        await sleep(1_200);
      }
      const requestsBefore = cdp.requests.length;
      await click(cdp, "connect");
      connected = await waitForState(cdp, (s) => s.wallet.status === "connected", "connected");
      await cdp.evaluate(`(() => {
        const box = document.getElementById("confirm-public");
        box.checked = true;
        box.dispatchEvent(new Event("change"));
      })()`);
      await click(cdp, "publish");
      const settled = await waitForState(
        cdp,
        (s) =>
          s.publish.status === "failed" ||
          s.publish.status === "confirmed" ||
          s.publish.status === "existing",
        "publish to settle",
      );
      // The duplicate check is a real, rate-limited Rabdi read. A 429 is an
      // honest network failure, not a rejection; retry the read-only scenario.
      if (
        settled.publish.status === "failed" &&
        settled.publish.error?.category === "network" &&
        attempt < maxAttempts
      ) {
        console.error(`attempt ${attempt}: duplicate check was throttled, retrying`);
        await sleep(2_000);
        continue;
      }
      failed = settled;
      break;
    }
    if (failed === undefined || connected === undefined) {
      throw new Error("publish scenario never settled");
    }
    check(connected.wallet.chainIdHex === "0x76edaf", "wallet is on Rabdi");
    const ui = await cdp.evaluate(`(() => ({
      errorText: document.getElementById("error")?.textContent ?? "",
      publishText: document.getElementById("publish-status")?.textContent ?? "",
      resultHidden: document.getElementById("result-card")?.hidden ?? null,
      entityKey: document.getElementById("entity-key")?.textContent ?? "",
      txHash: document.getElementById("tx-hash")?.textContent ?? "",
    }))()`);
    const walletCalls = await cdp.evaluate("window.__blocklabMockWalletCalls ?? []");
    console.log(
      "rejected publish state:",
      JSON.stringify(
        {
          publishStatus: failed.publish.status,
          category: failed.publish.error?.category,
          entityKey: failed.publish.entityKey ?? null,
          txHash: failed.publish.txHash ?? null,
          walletCalls,
          ui: {
            entityKey: ui.entityKey,
            txHash: ui.txHash,
            resultHidden: ui.resultHidden,
            publishText: ui.publishText,
          },
        },
        null,
        2,
      ),
    );
    check(failed.publish.error?.category === "user-rejected", "error category is user-rejected");
    check(failed.publish.entityKey === undefined, "no entity key after a rejection");
    check(failed.publish.txHash === undefined, "no transaction hash after a rejection");
    check(ui.entityKey === "", "no entity key rendered");
    check(ui.txHash.includes("no transaction sent"), `tx hash line: ${ui.txHash}`);
    check(ui.resultHidden === true, "result card stays hidden");
    check(ui.errorText.includes("mock wallet"), `error names the mock wallet: ${ui.errorText}`);

    // The duplicate check is stubbed; the write itself stops at the signature
    // request and never produces a transaction.
    const sends = walletCalls.filter((call) => call === "eth_sendTransaction").length;
    check(sends === 1, `exactly one signature request reached the mock wallet (${sends})`);
  }

  const report = {
    tool: "arkiv-poc-check",
    mode: options.mode,
    label: options.label,
    mockWallet: true,
    duplicateCheckStubbed: options.mode === "wallet-reject",
    failures,
  };
  if (options.out !== undefined) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(options.out, JSON.stringify(report, null, 2));
  }
  if (failures.length > 0) {
    console.error("failed checks:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 5;
  }
  console.log(`
PASS: ${options.label} — ${options.mode} handled without any transaction.`);
  return 0;
}

async function main() {
const options = parseArgs(process.argv.slice(2));
const profile = await mkdtemp(join(tmpdir(), `blocklab-arkiv-poc-${options.label}-`));
const browser = findBrowser();
const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const cdp = await Cdp.connect(options.port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (params) => {
    cdp.requests.push({
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData ?? null,
    });
  });

  if (options.mode !== "self-test") {
    try {
      return await runWalletMode(cdp, options);
    } catch (error) {
      console.error(`wallet scenario did not complete: ${error.message}`);
      return 4;
    }
  }

  // The live probe may hit the public endpoint's rate limit; a reload is a
  // fresh read-only attempt, never a write.
  let status;
  let probe = null;
  let attempts = 0;
  const maxAttempts = Math.max(1, options.retries + 1);
  while (attempts < maxAttempts) {
    attempts += 1;
    const url = attempts === 1 ? options.url : `${options.url}&attempt=${attempts}`;
    await cdp.send("Page.navigate", { url });
    status = await waitForSelfTest(cdp, options.timeoutMs);
    probe =
      status === undefined
        ? null
        : await cdp.evaluate("window.__blocklabArkivSelfTest ?? null");
    if (status === "done" && probe?.ok === true) break;
    console.error(
      `attempt ${attempts}/${maxAttempts}: status=${String(status)} ` +
        `step=${String(probe?.step)} error=${String(probe?.error)}`,
    );
    if (attempts < maxAttempts) await sleep(1_500);
  }
  if (status === undefined) {
    console.error("page never reported a self-test result");
    return 4;
  }
  if (probe === null) {
    console.error("self-test result object missing");
    return 4;
  }

  const ui = await cdp.evaluate(`(() => {
    const text = (id) => document.getElementById(id)?.textContent ?? null;
    const attr = (id, name) => document.getElementById(id)?.getAttribute(name) ?? null;
    return {
      walletStatus: attr("wallet-status", "data-status"),
      walletText: text("wallet-status"),
      networkStatus: attr("network-status", "data-status"),
      publishDisabled: document.getElementById("publish")?.disabled ?? null,
      resultCardHidden: document.getElementById("result-card")?.hidden ?? null,
      rowCount: document.querySelectorAll("#record-rows tr").length,
      errorText: text("error"),
      bodyText: document.body.innerText,
    };
  })()`);

  console.log("self-test probe:", JSON.stringify(probe, null, 2));
  console.log("ui:", JSON.stringify(ui, null, 2));

  // Self-test facts on the live Rabdi network.
  if (probe.ok) {
    check(probe.chainId === 7_794_095, `chain id is Rabdi, got ${probe.chainId}`);
    check(/^\d+$/.test(probe.blockNumber ?? ""), "blockNumber is a number");
    check(probe.blockDurationSeconds === 2, `block duration is 2 s, got ${probe.blockDurationSeconds}`);
    check(probe.schemaTag === "blocklab.experiment", `schema tag, got ${probe.schemaTag}`);
  } else {
    check(false, `live probe errored: ${probe.error ?? "unknown"}`);
  }

  // UI honesty without a wallet.
  check(ui.walletStatus === "missing" || ui.walletText.includes("No wallet"), "wallet status shows missing");
  check(ui.publishDisabled === true, "publish stays disabled without a wallet");
  check(ui.resultCardHidden === true, "result card hidden until a write exists");
  check(typeof ui.rowCount === "number" && ui.rowCount >= 13, `record review rendered ${ui.rowCount} rows`);

  // A connect click must produce a clear local error, not an RPC call.
  await cdp.evaluate(`document.getElementById("connect").click()`);
  await sleep(600);
  const afterClick = await cdp.evaluate(
    `document.getElementById("wallet-status")?.textContent ?? null`,
  );
  check(
    afterClick?.includes("No EIP-1193 wallet") ?? false,
    `connect click reports missing wallet, got: ${afterClick}`,
  );

  // No transaction of any kind was requested.
  const writes = cdp.requests.filter((request) => {
    const body = request.postData ?? "";
    return (
      body.includes("eth_sendTransaction") ||
      body.includes("eth_sendRawTransaction") ||
      body.includes("wallet_addEthereumChain")
    );
  });
  check(writes.length === 0, `no transactions requested (found ${writes.length})`);
  const rpcCalls = cdp.requests.filter(
    (request) =>
      request.postData?.includes("eth_chainId") ||
      request.postData?.includes("eth_blockNumber") ||
      request.postData?.includes("arkiv_getBlockTiming") ||
      request.postData?.includes("arkiv_query"),
  );
  check(rpcCalls.length >= 3, `live read calls observed (${rpcCalls.length})`);

  // Secret hygiene on the rendered page.
  check(
    !/private[_-]?key\s*[:=]/i.test(ui.bodyText),
    "no private-key shape in rendered text",
  );
  check(
    !/rpc\.[a-z0-9-]+\.(com|net|org)[^)]*access/i.test(ui.bodyText),
    "no credential-bearing RPC URL in rendered text",
  );

  const report = {
    tool: "arkiv-poc-check",
    label: options.label,
    probe,
    attempts,
    ui,
    rpcCallCount: rpcCalls.length,
    writes,
    failures,
  };
  if (options.out !== undefined) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(options.out, JSON.stringify(report, null, 2));
  }
  cdp.close();

  if (failures.length > 0) {
    console.error("failed checks:");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 5;
  }
  console.log(`\nPASS: ${options.label} — live probe OK, no writes, honest states.`);
  process.exit(0);
} catch (error) {
  console.error(`driver error: ${error.message}`);
  return 1;
} finally {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
  await sleep(400);
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }).catch(() => {});
}
}

process.exit(await main());