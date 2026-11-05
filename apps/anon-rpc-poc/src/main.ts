import {
  AnonRpcSession,
  type RpcObservation,
  SUPPORTED_METHODS,
} from "./harness.js";
import "./style.css";

const endpoint = import.meta.env.VITE_ANON_RPC_ENDPOINT?.trim();
const workerAddress =
  import.meta.env.VITE_ANON_RPC_WORKER_ADDRESS?.trim() ??
  "0x4fd77be300f31c5fe6ab266d35d27750a3478d27";
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const resultsElement = document.querySelector<HTMLPreElement>("#results");
const initializeButton =
  document.querySelector<HTMLButtonElement>("#initialize");
const runButton = document.querySelector<HTMLButtonElement>("#run");
const closeButton = document.querySelector<HTMLButtonElement>("#close");

if (
  statusElement === null ||
  resultsElement === null ||
  initializeButton === null ||
  runButton === null ||
  closeButton === null
) {
  throw new Error("POC page elements are missing.");
}

const session =
  endpoint === undefined || endpoint.length === 0
    ? undefined
    : new AnonRpcSession({
        endpoint,
        bootstrapRpcUrl: endpoint,
        workerAddress,
      });

const observations: RpcObservation[] = [];

initializeButton.addEventListener("click", async () => {
  if (session === undefined) {
    statusElement.textContent = "Set VITE_ANON_RPC_ENDPOINT and restart Vite.";
    return;
  }
  initializeButton.disabled = true;
  statusElement.textContent = "Initializing worker and awaiting readiness...";
  try {
    await session.initialize();
    statusElement.textContent =
      "Worker ready. Bootstrap provider was used only to read the specifier.";
    runButton.disabled = false;
    closeButton.disabled = false;
  } catch (error) {
    statusElement.textContent = `Harness initialization failed: ${
      error instanceof Error ? error.message : "unknown error"
    }`;
    initializeButton.disabled = false;
  }
});

runButton.addEventListener("click", async () => {
  if (session === undefined) return;
  runButton.disabled = true;
  statusElement.textContent =
    "Running read-only requests through the harness...";
  for (const method of SUPPORTED_METHODS) {
    observations.push(await session.request(method));
  }
  resultsElement.textContent = JSON.stringify(observations, null, 2);
  statusElement.textContent = "Read-only request batch complete.";
  runButton.disabled = false;
});

closeButton.addEventListener("click", () => {
  session?.close();
  runButton.disabled = true;
  closeButton.disabled = true;
  initializeButton.disabled = false;
  statusElement.textContent =
    "Worker closed. No ordinary-RPC fallback is used.";
});
