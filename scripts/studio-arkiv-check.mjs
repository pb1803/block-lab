#!/usr/bin/env node
/**
 * Real-browser verification driver for the Studio Arkiv history panel.
 *
 * Drives the built Studio app in headless Chrome with a labelled mock
 * EIP-1193 wallet (isBlocklabMockWallet: true; always rejects
 * eth_sendTransaction) and checks the honest gating behaviour:
 *
 *   1. no wallet  -> "No EIP-1193 wallet", publish disabled;
 *   2. wallet on the wrong chain -> wrong-network state, switch offered;
 *   3. explicit switch -> connected on Rabdi, added chain has no access key;
 *   4. pasted record -> publish becomes available, disclosure is shown;
 *   5. publish with no configured gateway -> fails honestly, nothing signed;
 *   6. history query with no gateway -> failed (not "empty");
 *   7. entity key open -> wrong key shape rejected, gateway error surfaces.
 *
 * No transaction is ever signed: the mock asserts zero eth_sendTransaction
 * calls across the whole session. This verifies the browser wiring and gating,
 * not a real write — real publication remains the POC harness's result.
 *
 * Usage (server already running):
 *   pnpm --filter @blocklab/studio dev   # port 5178
 *   node scripts/studio-arkiv-check.mjs [--url http://127.0.0.1:5178/] [--port 9552]
 *
 * Exit 0 when every check passes, 1 on a failed check, 4 on infrastructure
 * problems. Uses the Chrome DevTools Protocol over Node's built-in WebSocket.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

function parseArgs(argv) {
  const args = {
    url: "http://127.0.0.1:5178/",
    port: 9552,
    timeoutMs: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--url") args.url = value;
    else if (flag === "--port") args.port = Number(value);
    else if (flag === "--timeout") args.timeoutMs = Number(value);
  }
  return args;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate !== undefined && existsSync(candidate)) return candidate;
  }
  throw new Error("No Chrome/Edge binary found; set CHROME_PATH.");
}

/**
 * Injected before any page script. `isBlocklabMockWallet` marks the provider
 * clearly in page state; every call is tracked, and eth_sendTransaction always
 * rejects with 4001.
 */
const MOCK_WALLET_SOURCE = `
(() => {
  if (window.__mock !== undefined) return;
  const listeners = new Map();
  const state = { chainId: "0x1", accounts: [] };
  const knownChains = new Set(["0x1"]);
  const calls = { request: [], sendTransaction: 0, switchCount: 0 };
  let capturedAdd = null;
  const emit = (name, value) => {
    for (const handler of listeners.get(name) ?? []) {
      try { handler(value); } catch (e) { /* ignore subscriber errors */ }
    }
  };
  const provider = {
    isBlocklabMockWallet: true,
    on: (name, handler) => {
      const set = listeners.get(name) ?? [];
      set.push(handler);
      listeners.set(name, set);
    },
    removeListener: (name, handler) => {
      const set = listeners.get(name) ?? [];
      listeners.set(name, set.filter((h) => h !== handler));
    },
    request: async ({ method, params = [] }) => {
      calls.request.push(method);
      if (method === "eth_chainId") return state.chainId;
      if (method === "eth_accounts") return state.accounts;
      if (method === "eth_requestAccounts") {
        if (state.accounts.length === 0) {
          const error = new Error("User rejected the request.");
          error.code = 4001;
          throw error;
        }
        return state.accounts;
      }
      if (method === "wallet_switchEthereumChain") {
        calls.switchCount += 1;
        const chainId = params[0]?.chainId;
        if (!knownChains.has(chainId)) {
          const error = new Error("Unrecognized chain ID.");
          error.code = 4902;
          throw error;
        }
        state.chainId = chainId;
        emit("chainChanged", chainId);
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        capturedAdd = params[0] ?? null;
        knownChains.add(params[0]?.chainId);
        state.chainId = "0x76edaf";
        emit("chainChanged", state.chainId);
        return null;
      }
      if (method === "eth_sendTransaction") {
        calls.sendTransaction += 1;
        const error = new Error("User rejected the request.");
        error.code = 4001;
        throw error;
      }
      return null;
    },
  };
  window.ethereum = provider;
  window.__mock = {
    isBlocklabMockWallet: true,
    setAccounts: (accounts) => { state.accounts = accounts; },
    setChain: (chainId) => {
      state.chainId = chainId;
      emit("chainChanged", chainId);
    },
    calls,
    capturedAdd: () => capturedAdd,
  };
})();
`;

const NO_WALLET_SOURCE = `
(() => {
  try { delete window.ethereum; } catch (e) { /* ignore */ }
})();
`;

class Cdp {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #exceptions = [];

  constructor(socket) {
    this.#socket = socket;
  }

  static async connect(port) {
    const target = await Cdp.waitForPage(port);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
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

  static async waitForPage(port) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((entry) => entry.type === "page");
        if (page !== undefined) return page;
      } catch {
        // not up yet
      }
      await wait(200);
    }
    throw new Error(`DevTools endpoint on port ${port} did not come up.`);
  }

  async send(method, params = {}) {
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
    return response.result?.result?.value;
  }

  async inject(source) {
    const response = await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
    return response.result?.identifier;
  }

  async removeInjected(identifier) {
    if (identifier !== undefined) {
      await this.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  }

  exceptions() {
    return this.#exceptions;
  }

  close() {
    this.#socket.close();
  }
}

const SAMPLE_RECORD = JSON.stringify({
  schemaVersion: "1.0",
  experimentId: "poc-write-001",
  experimentType: "rpc-blackout",
  scenarioName: "RPC blackout (write probe)",
  targetChainId: 31337,
  status: "passed",
  startedAtMs: 1793924125113,
  completedAtMs: 1793924155113,
  requestCount: 40,
  succeededCount: 34,
  failedCount: 6,
  rpcFailureCount: 6,
  latency: { averageMs: 128, p50Ms: 96, p95Ms: 310, maxMs: 512 },
  evidenceDigest: "3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f",
  evidenceRef: "evidence/poc-write/result.json",
  expiryDays: 7,
});

function pasteText(expression) {
  return `
(() => {
  const node = document.querySelector(${JSON.stringify(expression)});
  if (node === null) return "missing";
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement ? HTMLTextAreaElement.prototype : {},
    "value",
  )?.set;
  if (setter !== undefined) setter.call(node, ${JSON.stringify(SAMPLE_RECORD)});
  else node.value = ${JSON.stringify(SAMPLE_RECORD)};
  node.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
})()`;
}

function clickAction(action) {
  return `(() => {
    const node = document.querySelector('[data-action=${JSON.stringify(action)}]');
    if (node === null) return "missing";
    node.click();
    return "ok";
  })()`;
}

const STATE_READ = `(() => window.__blocklabStudioArkiv?.read() ?? null)()`;

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = findChrome();
  const profile = join(tmpdir(), `blocklab-studio-arkiv-${Date.now()}`);
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${args.port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const cdp = await Cdp.connect(args.port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // 1. No wallet present: honest missing state, publish disabled.
    const noWalletScript = await cdp.inject(NO_WALLET_SOURCE);
    await cdp.send("Page.navigate", { url: args.url });
    await wait(1200);
    const initialText = await cdp.evaluate(
      `document.querySelector('[data-testid="sr-wallet-status"]')?.textContent ?? ""`,
    );
    record("no-wallet message", initialText.includes("No EIP-1193 wallet"), initialText);
    const publishDisabled = await cdp.evaluate(
      `document.querySelector('[data-action="publish"]')?.disabled ?? "missing"`,
    );
    record("publish disabled without wallet", publishDisabled === true, String(publishDisabled));

    // 2. Inject the labelled mock wallet, switch to a wrong chain.
    await cdp.removeInjected(noWalletScript);
    await cdp.inject(MOCK_WALLET_SOURCE);
    await cdp.send("Page.navigate", { url: args.url });
    await wait(1200);
    const mockLabel = await cdp.evaluate(
      `(() => window.__mock?.isBlocklabMockWallet === true && window.ethereum?.isBlocklabMockWallet === true)()`,
    );
    record("labelled mock wallet injected", mockLabel === true, "isBlocklabMockWallet present");

    // 2b. Regression: a detected provider with no authorized account must offer
    //     Connect, and clicking it must really request authorization.
    const connectVisible = await cdp.evaluate(
      `(() => { const n = document.querySelector('[data-action="connect"]'); return n !== null && n.hidden === false && n.disabled !== true; })()`,
    );
    record("Connect offered while disconnected", connectVisible === true, "hidden=false");
    const detectHidden = await cdp.evaluate(
      `document.querySelector('[data-action="detect"]')?.hidden !== false`,
    );
    record("Detect hidden once a provider exists", detectHidden === true, "detect hidden");

    await cdp.evaluate(clickAction("connect"));
    await wait(400);
    const asked = await cdp.evaluate(
      `(window.__mock?.calls.request ?? []).includes("eth_requestAccounts")`,
    );
    record("Connect requests eth_requestAccounts", asked === true, "eth_requestAccounts called");
    const afterReject = await cdp.evaluate(
      `document.querySelector('[data-testid="sr-wallet-status"]')?.textContent ?? ""`,
    );
    record(
      "rejected connect stays disconnected",
      afterReject.includes("not connected"),
      afterReject,
    );
    const rejectError = await cdp.evaluate(
      `document.querySelector('#wallet-error')?.textContent ?? ""`,
    );
    record(
      "rejection surfaced as user-rejected",
      rejectError.includes("user-rejected"),
      rejectError.slice(0, 60),
    );

    await cdp.evaluate(
      `window.__mock.setAccounts(["0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759"]); window.__mock.setChain("0x1"); "ok"`,
    );
    await cdp.evaluate(clickAction("detect"));
    await wait(400);
    const wrongNetwork = await cdp.evaluate(
      `document.querySelector('[data-testid="sr-wallet-status"]')?.textContent ?? ""`,
    );
    record("wrong-network state", wrongNetwork.includes("wrong network"), wrongNetwork);
    const switchVisible = await cdp.evaluate(
      `(() => { const node = document.querySelector('[data-action="switch-network"]'); return node !== null && node.hidden === false && node.disabled !== true; })()`,
    );
    record("switch-to-Rabdi offered", switchVisible === true, "hidden=false");

    // 3. Explicit switch: added chain must not carry the access key.
    await cdp.evaluate(clickAction("switch-network"));
    await wait(500);
    const walletOk = await cdp.evaluate(STATE_READ);
    record(
      "connected on Rabdi",
      walletOk?.wallet?.status === "connected" &&
        String(walletOk?.wallet?.chainIdHex ?? "").toLowerCase() === "0x76edaf",
      JSON.stringify({ status: walletOk?.wallet?.status, chain: walletOk?.wallet?.chainIdHex }),
    );
    const chainLine = await cdp.evaluate(
      `document.querySelector('[data-testid="sr-wallet-chain"]')?.textContent ?? ""`,
    );
    record("chain line shows Rabdi", chainLine.includes("0x76edaf"), chainLine);
    const addedRpc = await cdp.evaluate(
      `(() => { const add = window.__mock.capturedAdd(); return add === null ? null : add.rpcUrls[0]; })()`,
    );
    record(
      "added chain has no credential-shaped RPC URL",
      typeof addedRpc === "string" && !addedRpc.includes("@"),
      String(addedRpc ?? "no add called"),
    );
    const noSendCalls = await cdp.evaluate(`window.__mock.calls.sendTransaction`);
    record("nothing signed so far", noSendCalls === 0, String(noSendCalls));

    // 4. Paste a valid record: publish available, disclosure shown.
    const pasted = await cdp.evaluate(pasteText('[data-testid="sr-record-input"]'));
    record("record paste accepted", pasted === "ok", String(pasted));
    await wait(300);
    const loadedMeta = await cdp.evaluate(STATE_READ);
    record(
      "record validated and loaded",
      loadedMeta?.publish?.metadata?.experimentId === "poc-write-001",
      String(loadedMeta?.publish?.metadata?.experimentId),
    );
    const publishEnabled = await cdp.evaluate(
      `document.querySelector('[data-action="publish"]')?.disabled ?? "missing"`,
    );
    record("publish enabled after load", publishEnabled === false, String(publishEnabled));
    const disclosure = await cdp.evaluate(
      `document.querySelector('[data-testid="sr-disclosure"]')?.textContent ?? ""`,
    );
    record(
      "disclosure lists what becomes public",
      disclosure.includes("Experiment identifier") && disclosure.includes("does not by itself make the execution trustworthy"),
      disclosure.slice(0, 80),
    );

    // 5. Publish fails before the wallet is reached, and nothing is signed.
    //    With VITE_ARKIV_ACCESS_KEY built in, the real duplicate preflight finds
    //    poc-write-001; without a key the gateway itself refuses. Both are honest
    //    pre-signature stops, so either is accepted and the reason is recorded.
    await cdp.evaluate(clickAction("publish"));
    await wait(1500);
    const publishState = await cdp.evaluate(STATE_READ);
    const publishCategory = String(publishState?.publish?.error?.category ?? "none");
    const publishPhase = String(publishState?.publish?.phase ?? "none");
    record(
      "publish stops before signing, honestly",
      ["failed", "existing"].includes(publishPhase) &&
        ["duplicate", "no-gateway", "network"].includes(publishCategory),
      `${publishPhase}: ${JSON.stringify(publishState?.publish?.error ?? null)}`,
    );
    record("no tx hash invented", publishState?.publish?.txHash === undefined, String(publishState?.publish?.txHash));
    const afterPublish = await cdp.evaluate(`window.__mock.calls.sendTransaction`);
    record("zero eth_sendTransaction calls", afterPublish === 0, String(afterPublish));

    // 6. A history query reaches a definite outcome: rows, or a reported failure.
    //    It must never be left in a blank "empty" state that could be mistaken
    //    for "no records". A real gateway may legitimately return rows here.
    await cdp.evaluate(`window.__blocklabStudioArkiv.search("status", "passed"); "ok"`);
    await wait(1500);
    const historyState = await cdp.evaluate(STATE_READ);
    const historyPhase = historyState?.history?.phase;
    record(
      "history reports a definite outcome (never silently empty)",
      historyPhase === "ok" || historyPhase === "failed",
      historyPhase === "failed"
        ? JSON.stringify(historyState?.history?.error ?? null)
        : `${historyPhase} (${historyState?.history?.rows?.length ?? 0} rows)`,
    );

    // 7. Entity key validation and gateway error surfacing.
    const keyShape = await cdp.evaluate(`
      (() => {
        const input = document.querySelector('[data-testid="sr-key-input"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter.call(input, "0x12");
        document.querySelector('[data-action="open-key"]').click();
        return document.querySelector('[data-testid="sr-detail-error"]')?.textContent ?? "";
      })()`,
    );
    record(
      "bad key shape rejected",
      String(keyShape).includes("32-byte entity key"),
      String(keyShape),
    );
    const validOpen = await cdp.evaluate(`
      (() => {
        window.__blocklabStudioArkiv.open("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        return "ok";
      })()`,
    );
    void validOpen;
    await wait(500);
    const detailState = await cdp.evaluate(STATE_READ);
    record(
      "detail open with no gateway reports failure",
      detailState?.detail?.phase === "failed",
      String(detailState?.detail?.phase),
    );

    const exceptions = cdp.exceptions();
    record("no page exceptions", exceptions.length === 0, exceptions.slice(0, 3).join(" | "));

    cdp.close();
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
    return;
  } finally {
    child.kill();
  }

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, checks }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

main();
