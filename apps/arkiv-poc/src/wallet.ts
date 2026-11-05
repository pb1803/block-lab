import type { Address, Hex } from "viem";
import {
  RABDI_CHAIN_ID_HEX,
  RABDI_CURRENCY,
  RABDI_EXPLORER_URL,
  RABDI_NAME,
  RABDI_RPC_URL,
} from "./config.js";
import type { WorkflowError } from "./status.js";

/** The EIP-1193 surface the POC needs. */
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
 * Switches the wallet to Rabdi. Only called on an explicit user click. The
 * chain is added WITHOUT the access key (the access key is app-only and is
 * never written into a wallet's global config), matching the SDK's `rabdi()`
 * contract and its browser-wallet guidance.
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

/**
 * Classifies an error thrown by a wallet or SDK call. A wallet rejection must
 * never be reported as a network failure or a written entity.
 */
export function classifyError(error: unknown): WorkflowError {
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
    if (
      /5\d{2}|429|timeout|fetch failed|request to .* failed|network/i.test(
        message,
      )
    ) {
      return { category: "network", message };
    }
    // The Arkiv SDK wraps node errors with a clear cause chain.
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) return classifyError(cause);
    return { category: "sdk", message };
  }
  return { category: "unknown", message: String(error) };
}
