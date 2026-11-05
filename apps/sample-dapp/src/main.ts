import { probeRpc, type RpcProbeResult } from "@blocklab/rpc-probe";
import "./style.css";

const status = document.querySelector<HTMLElement>("#status");
const retry = document.querySelector<HTMLButtonElement>("#retry");
const rpcUrl = import.meta.env.VITE_RPC_URL?.trim();
const expectedChainId = 31337;

function text(value: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = value;
  return element;
}

function renderLoading(): void {
  if (!status) return;
  status.replaceChildren(text("Connecting to the configured RPC endpoint…"));
}

function renderFailure(result: RpcProbeResult): void {
  if (!status) return;
  status.replaceChildren(
    text(
      `RPC error (${result.category ?? "unknown"}): ${result.errorMessage ?? "Request failed."}`,
    ),
    text("The configured endpoint was not included in the UI."),
  );
}

async function loadStatus(): Promise<void> {
  if (!status) return;
  renderLoading();
  if (!rpcUrl) {
    status.replaceChildren(
      text("RPC configuration is missing."),
      text("Set VITE_RPC_URL in apps/sample-dapp/.env.local and restart Vite."),
    );
    return;
  }
  const chain = await probeRpc({
    rpcUrl,
    method: "eth_chainId",
    expectedChainId,
  });
  if (!chain.success) {
    renderFailure(chain);
    return;
  }
  const block = await probeRpc({ rpcUrl, method: "eth_blockNumber" });
  if (!block.success) {
    renderFailure(block);
    return;
  }
  status.replaceChildren(
    text("RPC connection successful."),
    text(`Chain ID: ${chain.chainId}`),
    text(`Latest block: ${block.blockNumber}`),
    text(`Read latency: ${chain.latencyMs + block.latencyMs}ms`),
  );
}

retry?.addEventListener("click", () => {
  void loadStatus();
});

void loadStatus();
