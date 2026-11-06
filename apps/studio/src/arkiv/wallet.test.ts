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

  // The observed ARK-07 failure: viem wraps the provider refusal and prints the
  // calldata, whose hex digits contain `5xx` and so used to classify as network.
  const viemAuthorizationError = () => {
    const cause = Object.assign(
      new Error(
        "The requested method and/or account has not been authorized by the user.",
      ),
      { code: 4100 },
    );
    const wrapper = new Error(
      "The requested method and/or account has not been authorized by the user.\n\n" +
        "Request Arguments:\n  from: 0xd431714db82331b07697ea4675334c3af6d2ebe9\n" +
        "  to: 0x4400000000000000000000000000000000000044\n  gas: 250902\n" +
        "  data: 0x4965004400000000000000000000000000000000000000000000000000000000",
      { cause },
    );
    wrapper.name = "TransactionExecutionError";
    return wrapper;
  };

  it("reports a 4100 refusal as unauthorized, not as a network failure", () => {
    const classified = classifyError(viemAuthorizationError());
    expect(classified.category).toBe("unauthorized");
    expect(classified.message).toMatch(/disconnect and connect/i);
  });

  it("reads a provider code given as a string", () => {
    const error = Object.assign(new Error("nope"), { code: "4100" });
    expect(classifyError(error).category).toBe("unauthorized");
  });

  it("maps a disconnected wallet (4900) to unauthorized", () => {
    const error = Object.assign(new Error("disconnected"), { code: 4900 });
    expect(classifyError(error).category).toBe("unauthorized");
  });

  it("maps an unsupported chain (4901) to wrong-network", () => {
    const error = Object.assign(new Error("chain"), { code: 4901 });
    expect(classifyError(error).category).toBe("wrong-network");
  });

  it("recognises the authorization wording without a code", () => {
    const error = new Error(
      "The requested method and/or account has not been authorized by the user.",
    );
    expect(classifyError(error).category).toBe("unauthorized");
  });

  it("still reports a genuine provider failure as network", () => {
    const cause = Object.assign(new Error("Internal JSON-RPC error."), {
      code: -32603,
    });
    const wrapper = new Error(
      "estimate gas failed\n  from: 0xd431714db82331b07697ea4675334c3af6d2ebe9",
      { cause },
    );
    expect(classifyError(wrapper).category).toBe("network");
  });
});
