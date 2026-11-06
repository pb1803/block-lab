/**
 * EIP-1193 wallet adapter for Studio. No private key ever leaves the wallet:
 * Studio only calls the user-approved methods below, and it never switches
 * networks except on an explicit click (`switchToRabdi`).
 *
 * The wallet adapter is the only module that touches `window.ethereum` and it
 * is testable with a fake EIP-1193 provider.
 */
import type { Address, Hex } from "viem";
import {
  RABDI_CHAIN_ID_HEX,
  RABDI_CURRENCY,
  RABDI_EXPLORER_URL,
  RABDI_NAME,
  RABDI_RPC_URL,
} from "./config.js";
import type { StudioError } from "./types.js";

/** The EIP-1193 surface Studio needs. */
export type Eip1193Provider = {
  readonly request: (args: {
    readonly method: string;
    readonly params?: unknown[];
  }) => Promise<unknown>;
  readonly on?: (
    eventName: string,
    handler: (...args: unknown[]) => void,
  ) => void;
  readonly removeListener?: (
    eventName: string,
    handler: (...args: unknown[]) => void,
  ) => void;
};

export type WalletEvents = {
  readonly chainChanged: (chainIdHex: Hex) => void;
  readonly accountsChanged: (accounts: readonly Address[]) => void;
};

export function hasEip1193Provider(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

export function getProvider(): Eip1193Provider | undefined {
  return window.ethereum as Eip1193Provider | undefined;
}

export async function readChainId(provider: Eip1193Provider): Promise<Hex> {
  const value = await provider.request({ method: "eth_chainId" });
  if (typeof value !== "string")
    throw new Error("eth_chainId returned a non-string");
  return value.toLowerCase() as Hex;
}

export async function connectWallet(
  provider: Eip1193Provider,
): Promise<Address> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("eth_requestAccounts returned no account");
  }
  return accounts[0] as Address;
}

export type SwitchResult =
  | { readonly outcome: "switched" }
  | { readonly outcome: "added" }
  | { readonly outcome: "rejected" };

/**
 * Explicitly switches the wallet to Rabdi. Called only from a user click.
 * The chain is added WITHOUT the access key: the key is app-only and is never
 * written into a wallet's global chain configuration.
 */
export async function switchToRabdi(
  provider: Eip1193Provider,
): Promise<SwitchResult> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: RABDI_CHAIN_ID_HEX }],
    });
    return { outcome: "switched" };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code !== 4902) {
      return { outcome: "rejected" };
    }
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: RABDI_CHAIN_ID_HEX,
            chainName: RABDI_NAME,
            nativeCurrency: RABDI_CURRENCY,
            rpcUrls: [RABDI_RPC_URL],
            blockExplorerUrls: [RABDI_EXPLORER_URL],
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: RABDI_CHAIN_ID_HEX }],
      });
      return { outcome: "added" };
    } catch {
      return { outcome: "rejected" };
    }
  }
}

export function attachWalletEvents(
  provider: Eip1193Provider,
  events: WalletEvents,
): () => void {
  const onChainChanged = (value: unknown) => {
    if (typeof value === "string")
      events.chainChanged(value.toLowerCase() as Hex);
  };
  const onAccountsChanged = (value: unknown) => {
    if (!Array.isArray(value)) return;
    events.accountsChanged(
      value.filter((entry): entry is Address => typeof entry === "string"),
    );
  };
  provider.on?.("chainChanged", onChainChanged);
  provider.on?.("accountsChanged", onAccountsChanged);
  return () => {
    provider.removeListener?.("chainChanged", onChainChanged);
    provider.removeListener?.("accountsChanged", onAccountsChanged);
  };
}

/**
 * Classifies an error thrown by the wallet or the Arkiv SDK. A wallet rejection
 * is never reported as a network failure or as a written entity.
 */
export function classifyError(error: unknown): StudioError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown; cause?: unknown }).code;
    if (code === 4001 || code === "4001") {
      return {
        category: "user-rejected",
        message: "The transaction was rejected in the wallet.",
      };
    }
    const message = error.message;
    if (message.startsWith("User rejected")) {
      return { category: "user-rejected", message };
    }
    if (error.name === "NoEntityFoundError") {
      return {
        category: "missing",
        message:
          "No live entity with that key: it was never created, or it has been deleted or has expired.",
      };
    }
    if (
      /5\d{2}|429|timeout|fetch failed|request to .* failed|network|rate limit/i.test(
        message,
      )
    ) {
      return { category: "network", message };
    }
    if (/expired/i.test(message)) {
      return { category: "expired", message };
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) return classifyError(cause);
    return { category: "sdk", message };
  }
  return { category: "unknown", message: String(error) };
}
