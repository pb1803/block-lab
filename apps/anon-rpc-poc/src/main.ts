import {
  AnonRpcTransport,
  findWorker,
  type RpcObservation,
  runWorkload,
} from "@blocklab/browser-rpc";
import "./style.css";

const endpoint = import.meta.env.VITE_ANON_RPC_ENDPOINT?.trim();
const workerId = import.meta.env.VITE_ANON_RPC_WORKER?.trim() ?? "passthrough";
const worker = findWorker(workerId);

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

const routeMissing =
  endpoint === undefined || endpoint.length === 0 || worker === undefined;

const session =
  routeMissing === false
    ? new AnonRpcTransport({
        endpoint,
        bootstrapRpcUrl: endpoint,
        worker,
        ...(worker.exampleConfig === undefined
          ? {}
          : { config: worker.exampleConfig }),
      })
    : undefined;

const observations: RpcObservation[] = [];

initializeButton.addEventListener("click", async () => {
  if (session === undefined) {
    statusElement.textContent =
      "Set VITE_ANON_RPC_ENDPOINT (and VITE_ANON_RPC_WORKER) and restart Vite.";
    return;
  }
  initializeButton.disabled = true;
  statusElement.textContent = "Initializing worker and awaiting readiness...";
  try {
    await session.initialize();
    statusElement.textContent =
      worker.kind === "network"
        ? `Worker ready (${worker.id} — anonymizing network worker).`
        : `Worker ready (${worker.id} — reference worker, NOT anonymizing).`;
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
  observations.push(...(await runWorkload(session)));
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
