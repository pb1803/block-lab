/**
 * Verified Rabdi network constants for the Studio Arkiv history feature.
 *
 * The values are transcribed from the POC (`apps/arkiv-poc/src/config.ts`) and
 * were confirmed live on the Rabdi testnet: chain id `7794095`/`0x76edaf`,
 * 2 s blocks, `tGLM`, explorer `rabdi.explorer.arkiv.network`.
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
 * Optional Arkiv RPC access key (rate limit only; it never signs anything).
 *
 * Read from the Vite environment (`VITE_ARKIV_ACCESS_KEY` in the git-ignored
 * `.env.local`). It is never rendered, never logged, and never written into a
 * wallet's chain configuration. An empty value means the public, heavily
 * rate-limited endpoint.
 */
export const ARKIV_ACCESS_KEY: string =
  (import.meta.env?.VITE_ARKIV_ACCESS_KEY as string | undefined) ?? "";

export function isRabdiChainId(chainIdHex: string): boolean {
  return chainIdHex.toLowerCase() === RABDI_CHAIN_ID_HEX;
}

/** The attribute a history search filters on; all are indexed in the schema. */
export const HISTORY_SEARCH_FIELDS = [
  "experimentId",
  "scenarioName",
  "status",
] as const;

export type HistorySearchField = (typeof HISTORY_SEARCH_FIELDS)[number];

/** Maximum rows a history query returns, bounded so the UI never pages forever. */
export const HISTORY_LIMIT = 20;
