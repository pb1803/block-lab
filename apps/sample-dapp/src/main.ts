import {
  AnonRpcTransport,
  buildComparison,
  DirectRpcTransport,
  type RouteComparison,
  type RouteKind,
  type RpcObservation,
  type RpcTransport,
  runWorkload,
  summarizeRoute,
} from "@blocklab/browser-rpc";
import { readConfig, workerDescription } from "./config.js";
import {
  renderComparison,
  renderObservations,
  renderRouteDetail,
  renderStatus,
} from "./render.js";
import "./style.css";

function requireElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing page element: ${selector}`);
  return found;
}

const runButton = requireElement<HTMLButtonElement>("#run");
const compareButton = requireElement<HTMLButtonElement>("#compare");
const closeButton = requireElement<HTMLButtonElement>("#close");
const routeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="route"]'),
);
if (routeInputs.length === 0) {
  throw new Error("Sample dApp route selector is missing.");
}

const configResult = readConfig();
const workerConfig = configResult.ok ? configResult.config.worker : undefined;
const observations: RpcObservation[] = [];

let direct: DirectRpcTransport | undefined;
let anon: AnonRpcTransport | undefined;
let activeRoute: RouteKind = "direct";
let lastComparison: RouteComparison | undefined;

type SampleWindow = Window & { __blocklabComparison?: RouteComparison };

function selectedRoute(): RouteKind {
  return routeInputs.find((input) => input.checked)?.value === "anon-rpc"
    ? "anon-rpc"
    : "direct";
}

function setBusy(busy: boolean): void {
  const usable = configResult.ok;
  runButton.disabled = busy || !usable;
  compareButton.disabled = busy || !usable;
  closeButton.disabled =
    busy || !usable || activeRoute !== "anon-rpc" || anon?.state !== "ready";
}

function updateRouteDetail(): void {
  if (!configResult.ok) {
    renderRouteDetail("Route unavailable until configuration is fixed.");
    return;
  }
  const { config } = configResult;
  renderRouteDetail(
    activeRoute === "direct"
      ? "Active route: Direct RPC. Requests bypass the harness entirely."
      : `Active route: Anon-RPC. Destination ${new URL(config.endpoint).origin}; worker ${workerDescription(config.worker)}.`,
  );
}

function selectRoute(route: RouteKind): void {
  activeRoute = route;
  for (const input of routeInputs) input.checked = input.value === route;
  updateRouteDetail();
  setBusy(false);
}

async function initializeAnon(): Promise<boolean> {
  if (anon === undefined) return false;
  if (anon.state === "ready") return true;
  renderStatus(
    `Initializing the Anon-RPC worker and awaiting readiness…`,
    "info",
  );
  try {
    await anon.initialize();
    renderStatus(
      `Anon-RPC ready. Worker: ${workerConfig === undefined ? anon.workerId : workerDescription(workerConfig)}. No signing or transaction method is ever routed.`,
      "success",
    );
    return true;
  } catch (error) {
    renderStatus(
      `Anon-RPC initialization failed: ${
        error instanceof Error ? error.message : "unknown error"
      } No direct fallback was performed.`,
      "error",
    );
    return false;
  }
}

async function runActiveWorkload(): Promise<void> {
  const transport: RpcTransport | undefined =
    activeRoute === "anon-rpc" ? anon : direct;
  if (transport === undefined) {
    renderStatus("The selected route is not configured.", "error");
    return;
  }
  setBusy(true);
  if (activeRoute === "anon-rpc" && transport.state !== "ready") {
    await initializeAnon();
  }
  renderStatus(`Running the read-only workload via ${activeRoute}…`);
  const batch = await runWorkload(transport);
  observations.push(...batch);
  renderObservations(batch);
  const succeeded = batch.filter((observation) => observation.success).length;
  renderStatus(
    `${succeeded}/${batch.length} requests succeeded via ${activeRoute}.`,
    succeeded === batch.length ? "success" : "error",
  );
  setBusy(false);
}

async function runComparison(): Promise<void> {
  if (!configResult.ok || anon === undefined) return;
  setBusy(true);
  renderStatus(
    "Measuring both routes with the same read-only workload…",
    "info",
  );

  const directTransport = new DirectRpcTransport({
    endpoint: configResult.config.endpoint,
  });
  const directObservations = await runWorkload(directTransport);
  const directSummary = summarizeRoute({
    transport: directTransport,
    observations: directObservations,
    initialized: true,
  });
  directTransport.close();

  if (anon.state !== "ready") await initializeAnon();
  const anonObservations = await runWorkload(anon);
  const anonSummary = summarizeRoute({
    transport: anon,
    observations: anonObservations,
    initialized: anon.state === "ready",
    ...(anon.initializationError === undefined
      ? {}
      : { initializationError: anon.initializationError }),
  });

  const comparison = buildComparison({
    direct: directSummary,
    anonRpc: anonSummary,
  });
  lastComparison = comparison;
  (window as SampleWindow).__blocklabComparison = comparison;

  observations.push(...directObservations, ...anonObservations);
  renderObservations(observations);
  renderComparison(comparison);
  renderStatus(
    `Comparison complete. Direct ${directSummary.successRatePct}% (${directSummary.succeeded}/${directSummary.total}) and Anon-RPC ${anonSummary.successRatePct}% (${anonSummary.succeeded}/${anonSummary.total}) success. Latency is not a privacy measurement.`,
    anonSummary.failed === 0 && directSummary.failed === 0
      ? "success"
      : "error",
  );
  setBusy(false);
}

async function start(): Promise<void> {
  if (!configResult.ok) {
    renderStatus(configResult.error, "error");
    setBusy(false);
    return;
  }
  const { config } = configResult;
  direct = new DirectRpcTransport({ endpoint: config.endpoint });
  anon = new AnonRpcTransport({
    endpoint: config.endpoint,
    bootstrapRpcUrl: config.bootstrapRpcUrl,
    worker: config.worker,
    ...(config.worker.exampleConfig === undefined
      ? {}
      : { config: config.worker.exampleConfig }),
  });

  // Anon-RPC is the default route: eligible reads go through the harness unless
  // the user explicitly selects Direct RPC.
  selectRoute("anon-rpc");
  await initializeAnon();
}

for (const input of routeInputs) {
  input.addEventListener("change", () => {
    selectRoute(selectedRoute());
    if (activeRoute === "anon-rpc" && anon?.state !== "ready") {
      void initializeAnon().then(() => setBusy(false));
    }
  });
}

runButton.addEventListener("click", () => {
  void runActiveWorkload();
});

compareButton.addEventListener("click", () => {
  void runComparison();
});

closeButton.addEventListener("click", () => {
  anon?.close();
  renderStatus(
    "Anon-RPC session closed. Subsequent Anon-RPC requests fail; there is no silent fallback.",
    "info",
  );
  setBusy(false);
});

const selfTest = new URLSearchParams(location.search).get("selftest") === "1";

if (selfTest) {
  if (!configResult.ok) {
    renderStatus(configResult.error, "error");
  } else {
    renderRouteDetail("Self-test mode: running both routes automatically.");
    void import("./selftest.js").then(async ({ runSelfTest }) => {
      const result = await runSelfTest({
        endpoint: configResult.config.endpoint,
        bootstrapRpcUrl: configResult.config.bootstrapRpcUrl,
        worker: configResult.config.worker,
      });
      lastComparison = result.comparison;
      renderComparison(result.comparison);
      renderStatus(
        result.ok
          ? "Self-test complete: both routes succeeded."
          : "Self-test complete with failures; see the comparison payload.",
        result.ok ? "success" : "error",
      );
      (window as SampleWindow).__blocklabComparison = lastComparison;
    });
  }
} else {
  void start();
}
