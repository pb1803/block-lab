import type { RpcTransport } from "@blocklab/browser-rpc";
import { createViemRoute } from "@blocklab/browser-rpc/viem";
import type { ViemProbeResult } from "@blocklab/studio/comparison";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type ViemProbe = ViemProbeResult;

/**
 * Demonstrates the Viem adapter with the standard public-client interface. The
 * transport instance stays owned by the caller: this function never closes it,
 * so the same worker can serve the page and this probe.
 */
export async function runViemProbe(instance: RpcTransport): Promise<ViemProbe> {
  const route = createViemRoute(instance);
  const client = createPublicClient({
    chain: mainnet,
    transport: route.transport,
    cacheTime: 0,
  });

  try {
    const chainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber();
    const balance = await client.getBalance({ address: ZERO_ADDRESS });
    const call = await client.call({ to: ZERO_ADDRESS, data: "0x" });
    return {
      route: instance.route,
      ok: true,
      chainId,
      blockNumber: blockNumber.toString(),
      balanceWei: balance.toString(),
      callData: call.data ?? "0x",
    };
  } catch (error) {
    const category =
      error instanceof Error && "category" in error
        ? String((error as { category: unknown }).category)
        : undefined;
    return {
      route: instance.route,
      ok: false,
      ...(category === undefined ? {} : { errorCategory: category }),
      errorMessage:
        error instanceof Error ? error.message : "Viem request failed.",
    };
  }
}
