import { describe, expect, it, vi } from "vitest";
import { RABDI_CHAIN_ID_HEX } from "./config.js";
import {
  attachWalletEvents,
  classifyError,
  connectWallet,
  type Eip1193Provider,
  readChainId,
  switchToRabdi,
} from "./wallet.js";

describe("readChainId", () => {
  it("lowercases and returns the chain id", async () => {
    const provider = {
      request: async () => "0x76EDAF",
    } as unknown as Eip1193Provider;
    expect(await readChainId(provider)).toBe(RABDI_CHAIN_ID_HEX);
  });
});

describe("connectWallet", () => {
  it("returns the first account", async () => {
    const provider = {
      request: async () => ["0xa", "0xb"],
    } as unknown as Eip1193Provider;
    expect(await connectWallet(provider)).toBe("0xa");
  });

  it("throws when no account is returned", async () => {
    const provider = { request: async () => [] } as unknown as Eip1193Provider;
    await expect(connectWallet(provider)).rejects.toThrow(/no account/);
  });
});

describe("switchToRabdi", () => {
  it("treats a non-4902 switch failure as rejection", async () => {
    const calls: string[] = [];
    const provider = {
      request: async (args: { method: string }) => {
        calls.push(args.method);
        if (args.method === "wallet_switchEthereumChain") {
          throw { code: -32603 };
        }
        return null;
      },
    } as unknown as Eip1193Provider;
    const result = await switchToRabdi(provider);
    expect(result.outcome).toBe("rejected");
    expect(calls).toEqual(["wallet_switchEthereumChain"]);
  });

  it("adds then switches when the chain is unknown (4902), without an access key", async () => {
    const calls: string[] = [];
    let addParams: unknown;
    let switchCount = 0;
    const provider = {
      request: async (args: { method: string; params?: unknown[] }) => {
        calls.push(args.method);
        if (args.method === "wallet_switchEthereumChain") {
          switchCount += 1;
          if (switchCount === 1) throw { code: 4902 };
        }
        if (args.method === "wallet_addEthereumChain") addParams = args.params;
        return null;
      },
    } as unknown as Eip1193Provider;
    const result = await switchToRabdi(provider);
    expect(result.outcome).toBe("added");
    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
    const params = addParams as { chainId: string; rpcUrls: string[] }[];
    expect(params[0]?.chainId).toBe(RABDI_CHAIN_ID_HEX);
    // The access key lives in the RPC URL. A credential-shaped URL must never
    // be written into the wallet's global chain configuration.
    const rpc = params[0]?.rpcUrls[0] ?? "";
    expect(rpc.includes("@")).toBe(false);
  });
});

describe("attachWalletEvents", () => {
  it("subscribes, lowercases chain ids, and cleans up", () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const provider = {
      on: (event: string, handler: (value: unknown) => void) =>
        handlers.set(event, handler),
      removeListener: (event: string) => handlers.delete(event),
      request: async () => null,
    } as unknown as Eip1193Provider;
    const chainChanged = vi.fn();
    const accountsChanged = vi.fn();
    const off = attachWalletEvents(provider, { chainChanged, accountsChanged });
    handlers.get("chainChanged")?.("0x76EDAF");
    expect(chainChanged).toHaveBeenCalledWith(RABDI_CHAIN_ID_HEX);
    handlers.get("accountsChanged")?.(["0xa", "0xb"]);
    expect(accountsChanged).toHaveBeenCalledWith(["0xa", "0xb"]);
    handlers.get("accountsChanged")?.(["0xa", 42]);
    expect(accountsChanged).toHaveBeenLastCalledWith(["0xa"]);
    off();
    expect(handlers.size).toBe(0);
  });
});

describe("classifyError", () => {
  it("classifies wallet rejection, missing entity, network and expired errors", () => {
    const rejected = new Error("User rejected the request.");
    Object.assign(rejected, { code: 4001 });
    expect(classifyError(rejected).category).toBe("user-rejected");
    const missing = new Error("Entity never created");
    missing.name = "NoEntityFoundError";
    expect(classifyError(missing).category).toBe("missing");
    expect(classifyError(new Error("429 Too Many Requests")).category).toBe(
      "network",
    );
    expect(classifyError(new Error("entity has expired")).category).toBe(
      "expired",
    );
    expect(classifyError(new Error("boom")).category).toBe("sdk");
  });
});
