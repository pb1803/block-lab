import type { RpcObservation } from "@blocklab/browser-rpc";
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
