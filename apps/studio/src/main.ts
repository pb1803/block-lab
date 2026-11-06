/**
 * Studio app entry for the Arkiv experiment-history feature.
 *
 * Responsibilities kept here (and only here):
 * - resolve the wallet: detect, connect, explicit network switch, disconnect;
 * - keep one gateway per connected account (the controller reads it lazily);
 * - translate pasted JSON into validated records through the shared contract;
 * - attach the controller to the DOM panel.
 *
 * No transaction is ever sent without a click on the publish button, and no
 * private key is ever read: signing happens inside the wallet.
 */
import "./style.css";
import {
  metadataToPayloadBytes,
  validateExperimentMetadata,
} from "@blocklab/arkiv-metadata";
import { createStudioAgentClient } from "./agent.js";
import { ARKIV_ACCESS_KEY, RABDI_CHAIN_ID_HEX } from "./arkiv/config.js";
import { ArkivController } from "./arkiv/controller.js";
import { mountArkivCompare, mountStudioArkiv } from "./arkiv/dom.js";
import { type ArkivGateway, createRabdiGateway } from "./arkiv/gateway.js";
import type { ArkivRecord } from "./arkiv/types.js";
import {
  attachWalletEvents,
  classifyError,
  connectWallet,
  getProvider,
  hasEip1193Provider,
  switchToRabdi,
} from "./arkiv/wallet.js";
import { mountStudioShell, routeFromHash } from "./shell.js";
import { createThemeController } from "./theme.js";

const root = document.querySelector<HTMLElement>("#studio-root");

if (root === null) {
  throw new Error("Studio markup is missing #studio-root.");
}

const agent = createStudioAgentClient();
const theme = createThemeController({ root: document.documentElement });
const shell = mountStudioShell(root, routeFromHash(window.location.hash), {
  agent,
  theme,
});
const walletError = document.createElement("div");
walletError.className = "wallet-error";
walletError.setAttribute("role", "alert");
walletError.hidden = true;
shell.history.prepend(walletError);
const panel = shell.history.querySelector<HTMLElement>("#studio-arkiv");
const comparePanel = shell.compare;
if (panel === null) {
  throw new Error("Studio shell is missing the Arkiv history mount point.");
}
let gateway: ArkivGateway | null =
  ARKIV_ACCESS_KEY === ""
    ? null
    : createRabdiGateway({ accessKey: ARKIV_ACCESS_KEY });

/** Detaches the previous wallet listeners before attaching new ones. */
let detachWalletEvents: (() => void) | undefined;

const controller = new ArkivController({ gateway: () => gateway });
controller.subscribe((state) => shell.setArkivState(state));
shell.setArkivState(controller.state);

function showWalletError(error: unknown): void {
  const classified = classifyError(error);
  walletError.textContent = `[${classified.category}] ${classified.message}`;
  walletError.hidden = false;
}

function clearWalletError(): void {
  walletError.textContent = "";
  walletError.hidden = true;
}

function rebuildGateway(
  provider: ReturnType<typeof getProvider>,
  address: string,
): void {
  if (provider === undefined || ARKIV_ACCESS_KEY === "") {
    gateway = null;
    return;
  }
  gateway = createRabdiGateway({
    provider,
    address: address as `0x${string}`,
    accessKey: ARKIV_ACCESS_KEY,
  });
}

function detectWallet(): void {
  clearWalletError();
  if (!hasEip1193Provider()) {
    controller.walletMissing();
    return;
  }
  const provider = getProvider();
  if (provider === undefined) {
    controller.walletMissing();
    return;
  }
  void refreshWallet(provider);
}

async function refreshWallet(
  provider: NonNullable<ReturnType<typeof getProvider>>,
): Promise<void> {
  try {
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as unknown;
    const account =
      Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : null;
    if (account === null) {
      controller.walletDisconnected();
      return;
    }
    const chainId = (await provider.request({
      method: "eth_chainId",
    })) as unknown;
    if (typeof chainId !== "string") {
      controller.walletDisconnected();
      return;
    }
    rebuildGateway(provider, account);
    controller.walletConnected(
      account as `0x${string}`,
      chainId.toLowerCase() as `0x${string}`,
    );
  } catch (error) {
    showWalletError(error);
    controller.walletDisconnected();
  }
}

async function connect(): Promise<void> {
  clearWalletError();
  const provider = getProvider();
  if (provider === undefined) {
    controller.walletMissing();
    return;
  }
  try {
    const address = await connectWallet(provider);
    const chainId = (await provider.request({
      method: "eth_chainId",
    })) as unknown;
    if (typeof chainId !== "string")
      throw new Error("The wallet did not report a chain id.");
    rebuildGateway(provider, address);
    controller.walletConnected(address, chainId.toLowerCase() as `0x${string}`);
    detachWalletEvents?.();
    detachWalletEvents = attachWalletEvents(provider, {
      chainChanged: (value) => {
        controller.chainChanged(value);
        if (value === RABDI_CHAIN_ID_HEX) void refreshWallet(provider);
      },
      accountsChanged: (accounts) => {
        const next = accounts[0];
        if (next === undefined) {
          gateway = null;
          controller.walletDisconnected();
          return;
        }
        rebuildGateway(provider, next);
        void refreshWallet(provider);
      },
    });
  } catch (error) {
    showWalletError(error);
    controller.walletDisconnected();
  }
}

async function switchNetwork(): Promise<void> {
  clearWalletError();
  const provider = getProvider();
  if (provider === undefined) {
    controller.walletMissing();
    return;
  }
  const result = await switchToRabdi(provider);
  if (result.outcome === "rejected") {
    if (walletError !== null) {
      walletError.textContent =
        "The network switch was rejected in the wallet. Studio never switches networks without your click.";
    }
    return;
  }
  await refreshWallet(provider);
}

function loadLocalRecord(text: string): string | null {
  if (text.trim() === "") {
    controller.resetPublish();
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "not valid JSON.";
  }
  const result = validateExperimentMetadata(parsed);
  if (!result.ok) {
    return result.issues.map((issue) => `${issue.message}`).join("; ");
  }
  try {
    // Round-trip through the payload encoder: catches records that validate but
    // would not serialize deterministically.
    JSON.parse(
      new TextDecoder().decode(metadataToPayloadBytes(result.metadata)),
    );
  } catch {
    return "the record could not be encoded as a canonical payload.";
  }
  controller.loadRecord(result.metadata);
  return null;
}

function openByKey(key: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return "Expected a 32-byte entity key (0x followed by 64 hex characters).";
  }
  return null;
}

function readLocalForCompare(text: string) {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = validateExperimentMetadata(parsed);
    if (!result.ok) {
      return result.issues.map((issue) => `${issue.message}`).join("; ");
    }
    return [
      {
        kind: "local" as const,
        label: "local record",
        metadata: result.metadata,
      },
    ];
  } catch {
    return "not valid JSON.";
  }
}

async function readRecordForCompare(key: string): Promise<ArkivRecord> {
  const current = gateway;
  if (current === null) {
    throw new Error(
      "The Arkiv gateway is not configured (missing VITE_ARKIV_ACCESS_KEY).",
    );
  }
  return current.readRecord(key as `0x${string}`);
}

mountStudioArkiv(panel, controller, {
  wallet: {
    connect: () => void connect(),
    switchNetwork: () => void switchNetwork(),
    disconnect: () => {
      gateway = null;
      controller.walletDisconnected();
    },
    detect: () => detectWallet(),
  },
  loadLocalRecord,
  openByKey,
});

mountArkivCompare(comparePanel, {
  readRecord: (key) => readRecordForCompare(key),
  readLocal: readLocalForCompare,
});

// Initial paint: report a missing wallet or an already-authorized account.
detectWallet();

// A tiny debug surface for the browser verification script (same convention as
// the POC: a plain snapshot of the controller state, never a secret).
declare global {
  interface Window {
    __blocklabStudioArkiv?: {
      readonly read: () => unknown;
      readonly publish: () => Promise<void>;
      readonly search: (field: string, value: string) => Promise<void>;
      readonly open: (key: string) => Promise<void>;
    };
  }
}
window.__blocklabStudioArkiv = {
  read: () => controller.state,
  publish: () => controller.publish(),
  search: (field, value) =>
    controller.search(
      field === "experimentId" || field === "scenarioName" || field === "status"
        ? field
        : "experimentId",
      value,
    ),
  open: (key) => controller.openRecord(key as `0x${string}`),
};
