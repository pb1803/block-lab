import type {
  RouteComparison,
  RouteWorkload,
  RpcObservation,
} from "@blocklab/browser-rpc";
import type { ViemProbe } from "./viem-demo.js";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  return node;
}

function requireElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing page element: ${selector}`);
  return found;
}

const statusElement = requireElement<HTMLParagraphElement>("#status");
const routeDetailElement =
  requireElement<HTMLParagraphElement>("#route-detail");
const resultsElement = requireElement<HTMLDivElement>("#results");
const comparisonElement = requireElement<HTMLDivElement>("#comparison");
const privacyNoteElement =
  requireElement<HTMLParagraphElement>("#privacy-note");
const viemResultsElement = requireElement<HTMLDivElement>("#viem-results");

export function renderStatus(
  message: string,
  tone: "info" | "success" | "error" = "info",
): void {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

export function renderRouteDetail(message: string): void {
  routeDetailElement.textContent = message;
}

export function renderPrivacyNote(message: string): void {
  privacyNoteElement.textContent = message;
}

function cell(text: string): HTMLTableCellElement {
  return element("td", { text });
}

export function renderObservations(
  observations: readonly RpcObservation[],
): void {
  if (observations.length === 0) {
    resultsElement.replaceChildren(
      element("p", { className: "meta", text: "No requests were recorded." }),
    );
    return;
  }

  const table = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of [
    "Method",
    "Route",
    "Worker",
    "Harness",
    "Result",
    "Latency",
    "Error",
  ]) {
    headRow.append(element("th", { text: label }));
  }
  head.append(headRow);

  const body = element("tbody");
  for (const observation of observations) {
    const row = element("tr");
    row.append(
      cell(observation.method),
      cell(observation.route),
      cell(observation.workerId ?? "—"),
      cell(
        observation.receivedThroughHarness
          ? "routed"
          : observation.harnessReady
            ? "ready, not routed"
            : "not used",
      ),
      cell(observation.success ? "success" : "failure"),
      cell(`${observation.durationMs}ms`),
      cell(observation.errorMessage ?? observation.errorCategory ?? "—"),
    );
    if (!observation.success) row.dataset.status = "failed";
    body.append(row);
  }

  table.append(head, body);
  resultsElement.replaceChildren(table);
}

function workloadCard(title: string, workload: RouteWorkload): HTMLElement {
  const card = element("article", { className: "card" });
  card.append(element("h3", { text: title }));
  if (!workload.initialized) {
    card.append(
      element("p", {
        className: "error",
        text:
          workload.initializationError ??
          "Route was not initialized, so no request was routed.",
      }),
    );
  }
  const list = element("dl");
  const rows: [string, string][] = [
    ["Worker", workload.workerId ?? "not applicable"],
    [
      "Success rate",
      `${workload.successRatePct}% (${workload.succeeded}/${workload.total})`,
    ],
    [
      "Average latency",
      workload.averageLatencyMs === null
        ? "no requests"
        : `${workload.averageLatencyMs}ms`,
    ],
    ["Harness-routed", `${workload.harnessRouted}/${workload.total} requests`],
  ];
  for (const [term, value] of rows) {
    list.append(element("dt", { text: term }), element("dd", { text: value }));
  }
  card.append(list);
  return card;
}

export function renderComparison(comparison: RouteComparison): void {
  const grid = element("div", { className: "summary-grid" });
  grid.append(workloadCard("Direct RPC", comparison.direct));
  if (comparison.anonRpc === null) {
    const missing = element("article", { className: "card" });
    missing.append(
      element("h3", { text: "Anon-RPC" }),
      element("p", { className: "meta", text: "Not measured." }),
    );
    grid.append(missing);
  } else {
    grid.append(workloadCard("Anon-RPC", comparison.anonRpc));
  }

  const coverage = element("p", {
    className: "meta",
    text: `Eligible methods routed through the harness: ${comparison.coverage.routedMethods.length}/${comparison.coverage.eligibleMethods.length} (${comparison.coverage.coveragePct}%). Excluded by policy: ${comparison.coverage.excludedMethods.join(", ")}.`,
  });

  const notes = element("ul", { className: "notes" });
  for (const note of comparison.notes) {
    notes.append(element("li", { text: note }));
  }

  comparisonElement.replaceChildren(
    grid,
    coverage,
    element("h3", { text: "Limitations" }),
    notes,
  );
}

export function renderInitialComparisonPlaceholder(): void {
  comparisonElement.replaceChildren(
    element("p", {
      className: "meta",
      text: "Run a comparison to measure both routes with the same workload.",
    }),
  );
}

export function renderViemProbe(probe: ViemProbe): void {
  const card = element("article", { className: "card" });
  card.append(
    element("h3", { text: `Viem via ${probe.route}` }),
    element("p", {
      className: probe.ok ? "meta" : "meta error",
      text: probe.ok
        ? "Public client calls answered through the selected transport."
        : `Failed (${probe.errorCategory ?? "error"}): ${probe.errorMessage ?? "unknown error"}`,
    }),
  );

  if (probe.ok) {
    const list = element("dl", { className: "facts" });
    const rows: Array<[string, string]> = [
      ["getChainId", probe.chainId === undefined ? "—" : String(probe.chainId)],
      ["getBlockNumber", probe.blockNumber ?? "—"],
      ["getBalance (wei)", probe.balanceWei ?? "—"],
      ["call().data", probe.callData ?? "—"],
    ];
    for (const [term, value] of rows) {
      list.append(
        element("dt", { text: term }),
        element("dd", { text: value }),
      );
    }
    card.append(list);
  }

  viemResultsElement.replaceChildren(card);
}
