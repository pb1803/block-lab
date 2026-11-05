/// <reference types="vite/client" />

interface Window {
  /** EIP-1193 wallet provider, when the user has one installed. */
  ethereum?: unknown;
  /** Self-test probe, available only when the POC is served with ?selftest=1. */
  __blocklabArkivSelfTest?: unknown;
  __blocklabArkivSelfTestStatus?: "running" | "done" | "error" | undefined;
  __blocklabArkivSelfTestProgress?: string | undefined;
}
