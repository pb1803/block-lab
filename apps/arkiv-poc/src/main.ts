import {
  ARKIV_ENTITY_TAG,
  type ExperimentMetadata,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { RABDI_CHAIN_ID_HEX } from "./config.js";
import { type ArkivGateway, createRabdiGateway } from "./gateway.js";
import { type NetworkProbeResult, probeLiveNetwork } from "./selftest.js";
import {
  type ArchivedRecord,
  publishBlockReason,
  type WorkflowState,
} from "./status.js";
import {
  connectWallet,
  type Eip1193Provider,
  getProvider,
  hasEip1193Provider,
  readChainId,
  type SwitchResult,
  switchToRabdi,
} from "./wallet.js";
import { ArkivPocWorkflow } from "./workflow.js";
import "./style.css";

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as T;
}

const els = {
  walletStatus: must<HTMLParagraphElement>("wallet-status"),
  connect: must<HTMLButtonElement>("connect"),
  disconnect: must<HTMLButtonElement>("disconnect"),
  networkStatus: must<HTMLParagraphElement>("network-status"),
  switchNetwork: must<HTMLButtonElement>("switch-network"),
  recordRows: must<HTMLTableSectionElement>("record-rows"),
  expiry: must<HTMLSelectElement>("expiry-days"),
  confirmPublic: must<HTMLInputElement>("confirm-public"),
  publish: must<HTMLButtonElement>("publish"),
  publishStatus: must<HTMLParagraphElement>("publish-status"),
  error: must<HTMLParagraphElement>("error"),
  resultCard: must<HTMLElement>("result-card"),
  entityKey: must<HTMLElement>("entity-key"),
  txHash: must<HTMLElement>("tx-hash"),
  expiryBlock: must<HTMLElement>("expiry-block"),
  alreadyPublished: must<HTMLElement>("already-published"),
  query: must<HTMLButtonElement>("query"),
  queryStatus: must<HTMLParagraphElement>("query-status"),
  recordJson: must<HTMLPreElement>("record-json"),
  probeCard: must<HTMLElement>("probe-card"),
  probeJson: must<HTMLPreElement>("probe-json"),
  scope: must<HTMLParagraphElement>("scope"),
};

els.scope.textContent =
  `Proof of concept for Arkiv schema "${ARKIV_ENTITY_TAG}" on the Rabdi testnet ` +
  `(chain id ${RABDI_CHAIN_ID_HEX}). Writes are wallet-signed and user-triggered.`;

/** The sample record the POC reviews and publishes. Not read from a live run. */
function createSampleRecord(expiryDays: number): ExperimentMetadata {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: "poc-sample-run-001",
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout (sample)",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: 1_790_000_000_000,
    completedAtMs: 1_790_000_030_000,
    requestCount: 40,
    succeededCount: 34,
    failedCount: 6,
    rpcFailureCount: 6,
    latency: { averageMs: 128, p50Ms: 96, p95Ms: 310, maxMs: 512 },
    evidenceDigest: "3f".repeat(32),
    evidenceRef: "evidence/poc-sample-run-001/result.json",
    expiryDays,
  });
  if (!result.ok) {
    throw new Error(
      `sample record rejected: ${result.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.metadata;
}

function selectedExpiryDays(): number {
  return Number.parseInt(els.expiry.value, 10);
}

let workflow = new ArkivPocWorkflow({ gateway: null });
let unsubscribe: (() => void) | undefined;
let walletError: string | undefined;
let lastQueriedEntity: Hex | undefined;

function setupWorkflow(gateway: ArkivGateway | null) {
  unsubscribe?.();
  workflow = new ArkivPocWorkflow({ gateway });
  unsubscribe = workflow.subscribe(render);
  workflow.loadRecord(createSampleRecord(selectedExpiryDays()));
}

function renderRecordRows(metadata: ExperimentMetadata) {
  const rows: [string, string][] = [
    ["Schema version", metadata.schemaVersion],
    ["Experiment id", metadata.experimentId],
    ["Experiment type", metadata.experimentType],
    ["Scenario", metadata.scenarioName],
    ["Target chain id", String(metadata.targetChainId)],
    ["Status", metadata.status],
    ["Started at (ms)", String(metadata.startedAtMs)],
    ["Completed at (ms)", String(metadata.completedAtMs ?? "—")],
    [
      "Requests / succeeded / failed",
      `${metadata.requestCount} / ${metadata.succeededCount} / ${metadata.failedCount}`,
    ],
    ["RPC failures", String(metadata.rpcFailureCount)],
    [
      "Latency avg / p50 / p95 / max",
      metadata.latency === undefined
        ? "—"
        : `${metadata.latency.averageMs} / ${metadata.latency.p50Ms} / ${metadata.latency.p95Ms} / ${metadata.latency.maxMs} ms`,
    ],
    ["Evidence digest (sha256)", metadata.evidenceDigest],
    ["Local evidence ref", metadata.evidenceRef ?? "—"],
    ["Requested lifetime", `${metadata.expiryDays} days`],
  ];
  els.recordRows.replaceChildren(
    ...rows.map(([label, value]) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = label;
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(th, td);
      return tr;
    }),
  );
}

function statusLine(element: HTMLElement, status: string, text: string) {
  element.dataset.status = status;
  element.textContent = text;
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function render(state: WorkflowState) {
  const wallet = state.wallet;
  const suffix = walletError === undefined ? "" : ` — ${walletError}`;
  if (wallet.status === "missing") {
    statusLine(
      els.walletStatus,
      "missing",
      `${walletError ?? "No wallet extension detected."}`,
    );
    els.disconnect.hidden = true;
  } else if (wallet.status === "disconnected") {
    statusLine(
      els.walletStatus,
      "disconnected",
      `${walletError ?? "Wallet not connected."}`,
    );
    els.disconnect.hidden = true;
  } else if (wallet.status === "wrong-network") {
    statusLine(
      els.walletStatus,
      "wrong-network",
      `Connected as ${shortAddress(wallet.address as Address)} — wrong network (${wallet.chainIdHex ?? "unknown"})${suffix}`,
    );
    els.disconnect.hidden = false;
  } else {
    statusLine(
      els.walletStatus,
      "connected",
      `Connected as ${shortAddress(wallet.address as Address)} (signing stays in your wallet)${suffix}`,
    );
    els.disconnect.hidden = false;
  }

  if (wallet.chainIdHex === undefined) {
    statusLine(els.networkStatus, "idle", "No chain reported yet.");
    els.switchNetwork.hidden = true;
  } else if (wallet.chainIdHex.toLowerCase() === RABDI_CHAIN_ID_HEX) {
    statusLine(
      els.networkStatus,
      "connected",
      `Rabdi detected (${wallet.chainIdHex}).`,
    );
    els.switchNetwork.hidden = true;
  } else {
    statusLine(
      els.networkStatus,
      "wrong-network",
      `Wrong network: ${wallet.chainIdHex}. A write would fail fast; switch to Rabdi.`,
    );
    els.switchNetwork.hidden = false;
  }

  const publish = state.publish;
  const publishText: Record<string, string> = {
    idle: "Not published.",
    preflight: "Checking for an existing record with this experiment id…",
    "awaiting-signature":
      "Waiting for wallet approval and on-chain confirmation (the SDK reports both together; nothing is shown as written until a receipt exists).",
    confirming: "Waiting for on-chain confirmation…",
    confirmed: "Confirmed in a block; the entity key comes from the receipt.",
    existing:
      "An entity with this experiment id already exists. No new transaction was sent.",
    failed: "Publish failed; nothing was written.",
  };
  statusLine(
    els.publishStatus,
    publish.status,
    publishText[publish.status] ?? publish.status,
  );

  const error = publish.error ?? state.query.error;
  els.error.hidden = error === undefined;
  els.error.textContent =
    error === undefined ? "" : `[${error.category}] ${error.message}`;

  const entityKey = publish.entityKey;
  els.resultCard.hidden = entityKey === undefined;
  els.entityKey.textContent = entityKey ?? "";
  els.txHash.textContent = publish.txHash ?? "— (no transaction sent)";
  els.expiryBlock.textContent =
    publish.expiresAtBlock === undefined
      ? "—"
      : publish.expiresAtBlock.toString();
  els.alreadyPublished.textContent = publish.alreadyPublished
    ? "yes (existing record)"
    : "no";

  const query = state.query;
  const queryText: Record<string, string> = {
    idle: "Not queried yet.",
    querying: "Querying the entity…",
    ok: "Entity retrieved from Arkiv.",
    missing: "No live entity with that key (deleted or expired).",
    failed: "Entity query failed.",
  };
  statusLine(
    els.queryStatus,
    query.status,
    queryText[query.status] ?? query.status,
  );
  renderRecord(query.record);

  const reason = publishBlockReason(state);
  els.publish.disabled = reason !== null || !els.confirmPublic.checked;
  els.query.disabled = entityKey === undefined || query.status === "querying";

  if (entityKey !== undefined && lastQueriedEntity !== entityKey) {
    lastQueriedEntity = entityKey;
    void workflow.queryEntity(entityKey);
  }

  (
    window as unknown as { __blocklabArkivState?: WorkflowState }
  ).__blocklabArkivState = state;
}

function renderRecord(record: ArchivedRecord | undefined) {
  els.recordJson.hidden = record === undefined;
  if (record === undefined) {
    els.recordJson.textContent = "";
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(record.payloadJson);
  } catch {
    payload = { error: "payload is not JSON" };
  }
  els.recordJson.textContent = JSON.stringify(
    {
      entityKey: record.entityKey,
      owner: record.owner,
      creator: record.creator,
      createdAtBlock: record.createdAtBlock.toString(),
      updatedAtBlock: record.updatedAtBlock.toString(),
      expiresAtBlock: record.expiresAtBlock.toString(),
      readonlyFlag: record.readonlyFlag,
      payload,
    },
    null,
    2,
  );
}

function attachProviderEvents(provider: Eip1193Provider) {
  provider.on?.("chainChanged", (value) => {
    if (typeof value === "string")
      workflow.chainChanged(value.toLowerCase() as Hex);
  });
  provider.on?.("accountsChanged", (value) => {
    void (async () => {
      if (!Array.isArray(value) || typeof value[0] !== "string") {
        lastQueriedEntity = undefined;
        setupWorkflow(null);
        workflow.walletDisconnected();
        return;
      }
      const address = value[0] as Address;
      let chainIdHex: Hex = "0x0";
      try {
        chainIdHex = await readChainId(provider);
      } catch {
        // leave the chain unknown rather than assume Rabdi
      }
      lastQueriedEntity = undefined;
      setupWorkflow(createRabdiGateway({ provider, address }));
      workflow.walletConnected(address, chainIdHex);
    })();
  });
}

async function connect() {
  const provider = getProvider();
  if (provider === undefined) {
    walletError =
      "No EIP-1193 wallet (window.ethereum) is available in this browser.";
    workflow.walletMissing();
    return;
  }
  try {
    const address = await connectWallet(provider);
    const chainIdHex = await readChainId(provider);
    walletError = undefined;
    attachProviderEvents(provider);
    lastQueriedEntity = undefined;
    setupWorkflow(createRabdiGateway({ provider, address }));
    workflow.walletConnected(address, chainIdHex);
  } catch (error) {
    walletError = `Connection rejected or failed: ${(error as Error).message ?? "unknown error"}`;
    render(workflow.state);
  }
}

async function disconnect() {
  const provider = getProvider();
  if (provider !== undefined) {
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Not every wallet supports revoking; the POC still drops local state.
    }
  }
  walletError = "Wallet connection dropped locally.";
  lastQueriedEntity = undefined;
  setupWorkflow(null);
  workflow.walletDisconnected();
}

async function switchNetwork() {
  const provider = getProvider();
  if (provider === undefined) return;
  const result: SwitchResult = await switchToRabdi(provider);
  if (result.outcome === "rejected") {
    walletError = "The wallet rejected the network switch or add request.";
    render(workflow.state);
    return;
  }
  walletError = undefined;
  const chainIdHex = await readChainId(provider);
  workflow.chainChanged(chainIdHex);
}

els.connect.addEventListener("click", () => void connect());
els.disconnect.addEventListener("click", () => void disconnect());
els.switchNetwork.addEventListener("click", () => void switchNetwork());
els.confirmPublic.addEventListener("change", () => render(workflow.state));
els.expiry.addEventListener("change", () => {
  workflow.loadRecord(createSampleRecord(selectedExpiryDays()));
});
els.publish.addEventListener("click", () => {
  if (!els.confirmPublic.checked) return;
  void workflow.publish();
});
els.query.addEventListener("click", () => {
  const key = workflow.state.publish.entityKey;
  if (key !== undefined) void workflow.queryEntity(key);
});

function renderProbe(probe: NetworkProbeResult) {
  els.probeCard.hidden = false;
  els.probeJson.textContent = JSON.stringify(probe, null, 2);
}

async function detectWallet() {
  const provider = getProvider();
  if (provider === undefined) {
    workflow.walletMissing();
    return;
  }
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    const chainIdHex = await readChainId(provider);
    attachProviderEvents(provider);
    if (Array.isArray(accounts) && typeof accounts[0] === "string") {
      setupWorkflow(
        createRabdiGateway({ provider, address: accounts[0] as Address }),
      );
      workflow.walletConnected(accounts[0] as Address, chainIdHex);
    } else {
      workflow.walletDisconnected();
      statusLine(
        els.networkStatus,
        "idle",
        "Wallet found but not connected yet.",
      );
    }
  } catch {
    workflow.walletDisconnected();
  }
}

async function runSelfTest() {
  window.__blocklabArkivSelfTestStatus = "running";
  try {
    const probe = await probeLiveNetwork({
      stepTimeoutMs: 15_000,
      onStep: (step) => {
        window.__blocklabArkivSelfTestProgress = step;
      },
    });
    window.__blocklabArkivSelfTest = {
      ok: true,
      walletAvailable: hasEip1193Provider(),
      ...probe,
    };
    window.__blocklabArkivSelfTestStatus = "done";
    renderProbe(probe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.__blocklabArkivSelfTest = {
      ok: false,
      walletAvailable: hasEip1193Provider(),
      step: window.__blocklabArkivSelfTestProgress,
      error: message,
    };
    window.__blocklabArkivSelfTestStatus = "error";
    els.probeCard.hidden = false;
    els.probeJson.textContent = JSON.stringify(
      { ok: false, error: message },
      null,
      2,
    );
  }
}

function boot() {
  renderRecordRows(createSampleRecord(selectedExpiryDays()));
  setupWorkflow(null);
  void detectWallet();
  const params = new URLSearchParams(window.location.search);
  if (params.get("selftest") === "1") void runSelfTest();
}

boot();
