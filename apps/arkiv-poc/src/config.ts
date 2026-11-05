/**
 * Verified Rabdi network constants.
 *
 * Chain id and RPC host were confirmed live on 2026-11-05 with `eth_chainId`
 * (0x76edaf) and `eth_blockNumber` against the public endpoint, and match
 * `rabdi()` in `@arkiv-network/sdk@1.0.1` (`src/chains/rabdi.ts`).
 */
export const RABDI_CHAIN_ID = 7_794_095;
export const RABDI_CHAIN_ID_HEX = "0x76edaf" as const;
export const RABDI_NAME = "Rabdi";
export const RABDI_RPC_URL = "https://rpc.rabdi.db-chain.testnet.arkiv.network";
export const RABDI_EXPLORER_URL = "https://rabdi.explorer.arkiv.network";
export const RABDI_CURRENCY = {
  name: "Golem",
  symbol: "tGLM",
  decimals: 18,
} as const;

/** 2 s block time, per the Rabdi network reference. */
export const RABDI_BLOCK_TIME_MS = 2_000;

/**
 * Optional Arkiv RPC access key. It raises the rate limit on the public RPC; it
 * is not a signing key and never signs anything. An empty value is supported
 * and means the rate-limited public endpoint.
 *
 * It is read from the Vite environment (`.env.local`, git-ignored) and is never
 * written into a wallet's chain configuration.
 */
export const ARKIV_ACCESS_KEY: string =
  (import.meta.env?.VITE_ARKIV_ACCESS_KEY as string | undefined) ?? "";

export function isRabdiChainId(chainIdHex: string): boolean {
  return chainIdHex.toLowerCase() === RABDI_CHAIN_ID_HEX;
}
