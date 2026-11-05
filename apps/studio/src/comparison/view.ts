/**
 * Pure view description for the comparison panel.
 *
 * Nodes are plain objects so the structure can be tested without a DOM. The
 * browser entry converts them with `renderToDom`, which is the only DOM-touching
 * code in this feature.
 */
import type {
  RouteCell,
  RouteStatusView,
  StudioComparisonState,
  ViemRouteView,
} from "./model.js";

export interface ViewElement {
  readonly kind: "element";
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ViewNode[];
}

export interface ViewText {
  readonly kind: "text";
  readonly text: string;
}

export type ViewNode = ViewElement | ViewText;

function el(
  tag: string,
  attrs: Readonly<Record<string, string>>,
  ...children: ViewNode[]
): ViewElement {
  return { kind: "element", tag, attrs, children };
}

function txt(value: string): ViewText {
  return { kind: "text", text: value };
}

function paragraph(className: string, value: string): ViewElement {
  return el("p", { class: className }, txt(value));
}

function cellValue(cell: RouteCell): string {
  if (!cell.attempted) return "not attempted";
  if (cell.success === true) return "succeeded";
  if (cell.success === false) return "failed";
  return "unavailable";
}

function latency(cell: RouteCell): string {
  if (!cell.attempted) return "—";
  if (cell.latencyMs === null) return "unavailable";
  // A failed attempt still has a duration, but it measured a failure rather
  // than an answer, so the label must not read like a successful latency.
  return cell.success === false
    ? `${cell.latencyMs} ms (failed)`
    : `${cell.latencyMs} ms`;
}

function harness(cell: RouteCell): string {
  if (!cell.attempted) return "—";
  if (cell.routedThroughHarness === null) return "unavailable";
  return cell.routedThroughHarness ? "yes" : "no";
}

function errorOf(cell: RouteCell): string {
  if (!cell.attempted) return "—";
  return cell.errorCategory ?? "none";
}

function facts(
  heading: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): ViewElement {
  const list = el("dl", { class: "facts" });
  for (const [term, value] of pairs) {
    list.children.push(el("dt", {}, txt(term)), el("dd", {}, txt(value)));
  }
  return el(
    "section",
    { class: "studio-card" },
    el("h4", {}, txt(heading)),
    list,
  );
}

function routeCard(status: RouteStatusView): ViewElement {
  const pairs: Array<readonly [string, string]> = [
    ["Route", status.label],
    ["Transport state", status.state],
    ["Ready", status.ready ? "yes" : "no"],
    ["Worker", workerIdLabel(status)],
    ["Worker type", workerTypeLabel(status)],
    ["Requests attempted", String(status.attempted)],
    ["Succeeded", String(status.succeeded)],
    ["Failed", String(status.failed)],
  ];
  if (status.initializationError !== null) {
    pairs.push(["Initialization error", status.initializationError]);
  }
  return facts(status.route === "direct" ? "Direct RPC" : "Anon-RPC", pairs);
}

function workerIdLabel(status: RouteStatusView): string {
  if (status.route === "direct") return "not applicable (direct)";
  return status.workerId ?? "not recorded";
}

function workerTypeLabel(status: RouteStatusView): string {
  if (status.route === "direct") return "not applicable (direct)";
  if (status.workerKind === "reference") return "passthrough (not anonymizing)";
  if (status.workerKind === "network") return "network (declared anonymizing)";
  return "not recorded";
}

function methodsTable(
  state: Extract<StudioComparisonState, { status: "ready" }>,
): ViewElement {
  const header = el("tr", {});
  for (const label of [
    "Method",
    "Direct",
    "Anon-RPC",
    "Direct latency",
    "Anon latency",
    "Harness-routed",
    "Error category",
  ]) {
    header.children.push(el("th", { scope: "col" }, txt(label)));
  }

  const body = el("tbody", {});
  for (const row of state.model.methods) {
    const tr = el("tr", {});
    tr.children.push(
      el("th", { scope: "row" }, txt(row.method)),
      el("td", {}, txt(cellValue(row.direct))),
      el("td", {}, txt(cellValue(row.anonRpc))),
      el("td", {}, txt(latency(row.direct))),
      el("td", {}, txt(latency(row.anonRpc))),
      el("td", {}, txt(harness(row.anonRpc))),
      el(
        "td",
        {},
        txt(
          [errorOf(row.direct), errorOf(row.anonRpc)]
            .filter((value) => value !== "—" && value !== "none")
            .join(", ") || "none",
        ),
      ),
    );
    body.children.push(tr);
  }

  return el(
    "div",
    { class: "table-scroll" },
    el(
      "table",
      { class: "studio-table" },
      el("caption", {}, txt("Read-only method results by route")),
      el("thead", {}, header),
      body,
    ),
  );
}

function coverageCard(
  state: Extract<StudioComparisonState, { status: "ready" }>,
): ViewElement {
  const { coverage } = state.model;
  return facts("Coverage", [
    ["Eligible methods", String(coverage.eligibleMethods.length)],
    [
      "Answered through the harness",
      `${coverage.routedCount} (${coverage.routedMethods.join(", ") || "none"})`,
    ],
    ["Routing coverage", `${coverage.coveragePct}%`],
    ["Direct requests attempted", String(coverage.attempted)],
    ["Succeeded", String(coverage.succeeded)],
    ["Failed", String(coverage.failed)],
    ["Skipped", String(coverage.skipped)],
  ]);
}

function viemCard(view: ViemRouteView): ViewElement {
  const heading =
    view.route === "direct" ? "Viem: Direct RPC" : "Viem: Anon-RPC";
  if (!view.ran) {
    return facts(heading, [["Result", "not run"]]);
  }
  const pairs: Array<readonly [string, string]> = [
    ["Result", view.ok ? "succeeded" : "failed"],
  ];
  if (view.ok) {
    pairs.push(
      [
        "Chain ID",
        view.chainId === null ? "unavailable" : String(view.chainId),
      ],
      ["Block number", view.blockNumber ?? "unavailable"],
      ["Balance (wei)", view.balanceWei ?? "unavailable"],
      ["call().data", view.callData ?? "unavailable"],
    );
  } else {
    pairs.push(
      ["Error category", view.errorCategory ?? "unavailable"],
      ["Error", view.errorMessage ?? "unavailable"],
    );
  }
  return facts(heading, pairs);
}

function readyView(
  state: Extract<StudioComparisonState, { status: "ready" }>,
): ViewNode[] {
  const { model } = state;
  const nodes: ViewNode[] = [
    paragraph("meta", `Generated ${model.generatedAt}. ${model.summary}`),
  ];

  if (model.warnings.length > 0) {
    const list = el("ul", {});
    for (const warning of model.warnings)
      list.children.push(el("li", {}, txt(warning)));
    nodes.push(
      el(
        "div",
        { class: "studio-warning", role: "status" },
        el("h4", {}, txt("Some data was unavailable")),
        list,
      ),
    );
  }

  nodes.push(
    el(
      "div",
      { class: "studio-grid" },
      routeCard(model.direct),
      model.anonRpc === null
        ? facts("Anon-RPC", [["Result", "not measured"]])
        : routeCard(model.anonRpc),
    ),
    methodsTable(state),
    coverageCard(state),
    paragraph("note", model.coverage.denominator),
  );

  if (model.viem !== null) {
    nodes.push(
      el(
        "div",
        { class: "studio-grid" },
        viemCard(model.viem.direct),
        viemCard(model.viem.anonRpc),
      ),
      paragraph(
        "meta",
        "Viem results come from a public client using the same transport; they are separate from the raw RPC observations above.",
      ),
    );
  }

  const limitations = el("ul", { class: "notes" });
  for (const limitation of model.limitations) {
    limitations.children.push(el("li", {}, txt(limitation)));
  }
  nodes.push(el("h4", {}, txt("Limitations")), limitations);

  return nodes;
}

/** Builds the complete read-only view description for a parsed snapshot. */
export function comparisonViewNodes(state: StudioComparisonState): ViewNode[] {
  if (state.status === "empty") {
    return [
      el("h3", {}, txt("No comparison yet")),
      paragraph(
        "meta",
        "Run a comparison in the browser application to populate this view. Studio is read-only: it never executes an RPC request.",
      ),
    ];
  }
  if (state.status === "invalid") {
    const list = el("ul", {});
    for (const issue of state.issues)
      list.children.push(el("li", {}, txt(issue)));
    return [
      el(
        "div",
        { class: "studio-error", role: "alert" },
        el("h3", {}, txt("Comparison data is unavailable")),
        paragraph(
          "meta",
          "The payload could not be rendered. Nothing was substituted for the missing values.",
        ),
        list,
      ),
    ];
  }
  return readyView(state);
}
