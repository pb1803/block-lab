/// <reference types="vite/client" />

interface Window {
  /** Injected EIP-1193 wallet. Studio only ever calls user-approved methods. */
  ethereum?: unknown;
}
