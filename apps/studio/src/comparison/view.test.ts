import { describe, expect, it } from "vitest";
import { parseStudioSnapshot } from "./model.js";
import {
  failedWorkerComparison,
  okComparison,
  partialComparison,
  referenceWorkload,
  snapshot,
  viemAnon,
  viemDirect,
} from "./test-fixtures.js";
import { comparisonViewNodes, type ViewNode } from "./view.js";

function texts(nodes: readonly ViewNode[]): string[] {
  const out: string[] = [];
  const walk = (node: ViewNode): void => {
    if (node.kind === "text") {
      out.push(node.text);
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

function allText(value: unknown): string[] {
  return texts(comparisonViewNodes(parseStudioSnapshot(value)));
}

function find(node: ViewNode, tag: string): ViewNode[] {
  const found: ViewNode[] = [];
  const walk = (current: ViewNode): void => {
    if (current.kind !== "element") return;
    if (current.tag === tag) found.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return found;
}

function tableRows(value: unknown): string[][] {
  const nodes = comparisonViewNodes(parseStudioSnapshot(value));
  const tables = nodes.flatMap((node) => find(node, "table"));
  const rows = tables.flatMap((table) =>
    (table.kind === "element" ? table.children : []).flatMap((section) =>
      section.kind === "element" && section.tag === "tbody"
        ? section.children.filter(
            (row): row is Extract<ViewNode, { kind: "element" }> =>
              row.kind === "element",
          )
        : [],
    ),
  );
  return rows.map((row) => row.children.flatMap((cell) => texts([cell])));
}

describe("Studio comparison view", () => {
  it("renders an empty state before any comparison exists", () => {
    const value = allText(undefined).join(" ");
    expect(value).toContain("No comparison yet");
    expect(value).toContain("read-only");
  });

  it("renders an accessible error state for malformed payloads", () => {
    const nodes = comparisonViewNodes(
      parseStudioSnapshot({ schemaVersion: "1.0" }),
    );
    const errors = nodes.flatMap((node) => find(node, "div"));
    expect(
      errors.some(
        (node) => node.kind === "element" && node.attrs.role === "alert",
      ),
    ).toBe(true);
    expect(texts(nodes).join(" ")).toContain("Comparison data is unavailable");
  });

  it("renders route status, worker type, and readiness", () => {
    const value = allText(snapshot(okComparison)).join(" ");
    expect(value).toContain("Direct RPC");
    expect(value).toContain("Anon-RPC");
    expect(value).toContain("network (declared anonymizing)");
    expect(value).toContain("tor-js");
    expect(value).toContain("Ready");
  });

  it("labels a passthrough worker as not anonymizing", () => {
    const value = allText(
      snapshot({ ...okComparison, anonRpc: referenceWorkload }),
    ).join(" ");
    expect(value).toContain("passthrough (not anonymizing)");
  });

  it("builds one table row per method with per-route outcomes", () => {
    const rows = tableRows(snapshot(okComparison));
    expect(rows).toHaveLength(4);
    expect(rows[0]?.[0]).toBe("eth_chainId");
    expect(rows[0]?.[1]).toBe("succeeded");
    expect(rows[0]?.[2]).toBe("succeeded");
    expect(rows[0]?.[3]).toBe("12 ms");
    expect(rows[0]?.[4]).toBe("90 ms");
    expect(rows[0]?.[5]).toBe("yes");
  });

  it("shows skipped methods and unavailable latency honestly", () => {
    const rows = tableRows(snapshot(partialComparison));
    expect(rows.find((row) => row[0] === "eth_call")?.[1]).toBe(
      "not attempted",
    );
    expect(rows.find((row) => row[0] === "eth_call")?.[3]).toBe("—");

    const noLatency = {
      ...okComparison,
      direct: {
        ...okComparison.direct,
        attempts: [
          {
            method: "eth_chainId",
            success: true,
            receivedThroughHarness: false,
          },
        ],
      },
    };
    const value = allText(snapshot(noLatency)).join(" ");
    expect(value).toContain("unavailable");
  });

  it("renders coverage with an explicit denominator", () => {
    const value = allText(snapshot(okComparison)).join(" ");
    expect(value).toContain("Routing coverage");
    expect(value).toContain("100%");
    expect(value).toContain("÷ eligible read-only methods");
  });

  it("renders worker failure and zero coverage", () => {
    const nodes = comparisonViewNodes(
      parseStudioSnapshot(snapshot(failedWorkerComparison)),
    );
    const value = texts(nodes).join(" ");
    expect(value).toContain("short bytes32 return");
    expect(value).toContain("0%");
    // A failed attempt must not present its duration as a successful latency.
    expect(value).toContain("0 ms (failed)");
    expect(value).toContain("No request was attempted through the harness");
    expect(value).toContain("not applicable (direct)");
  });

  it("renders Viem results separately and notes when they were not run", () => {
    const withViem = allText(
      snapshot(okComparison, { direct: viemDirect, anonRpc: viemAnon }),
    ).join(" ");
    expect(withViem).toContain("Viem: Direct RPC");
    expect(withViem).toContain("Block number");
    expect(withViem).toContain("separate from the raw RPC observations");

    const withoutViem = allText(snapshot(okComparison)).join(" ");
    expect(withoutViem).not.toContain("Viem: Direct RPC");
  });

  it("states the privacy limitations in every rendered comparison", () => {
    const value = allText(snapshot(okComparison)).join(" ");
    expect(value).toContain("Latency is not a privacy measurement");
    expect(value).toContain("does not anonymize anything");
    expect(value).toContain("Successful routing proves");
  });

  it("does not render raw payload structures", () => {
    const value = allText(snapshot(okComparison)).join(" ");
    expect(value).not.toContain('"attempts"');
    expect(value).not.toContain('"params"');
    expect(value).not.toContain("{");
  });
});

describe("Studio export control", () => {
  function button(
    value: unknown,
    options: Parameters<typeof comparisonViewNodes>[1],
  ) {
    const nodes = comparisonViewNodes(parseStudioSnapshot(value), options);
    const buttons = nodes.flatMap((node) => find(node, "button"));
    expect(buttons).toHaveLength(1);
    const only = buttons[0];
    if (only?.kind !== "element") throw new Error("expected a button element");
    return only;
  }

  it("shows a disabled Export JSON action without a valid comparison", () => {
    const empty = button(undefined, { exportEnabled: true });
    expect(empty.attrs["data-blocklab-export"]).toBe("");
    expect(empty.attrs.disabled).toBe("true");
    expect(texts([empty]).join("")).toBe("Export JSON");
  });

  it("stays disabled for an invalid payload even when export is supported", () => {
    const invalid = button({ schemaVersion: "1.0" }, { exportEnabled: true });
    expect(invalid.attrs.disabled).toBe("true");
  });

  it("enables export for a valid comparison", () => {
    const ready = button(snapshot(okComparison), { exportEnabled: true });
    expect(ready.attrs.disabled).toBeUndefined();
    const nodes = comparisonViewNodes(
      parseStudioSnapshot(snapshot(okComparison)),
      {
        exportEnabled: true,
      },
    );
    expect(texts(nodes).join(" ")).toContain("No request is re-run");
  });

  it("reports the last export attempt next to the action", () => {
    const ok = allText(snapshot(okComparison));
    expect(ok.join(" ")).not.toContain("Exported blocklab-rpc-comparison");

    const nodes = comparisonViewNodes(
      parseStudioSnapshot(snapshot(okComparison)),
      {
        exportEnabled: true,
        exportFeedback: {
          message: "Exported blocklab-rpc-comparison-x.json.",
          error: false,
        },
      },
    );
    const status = nodes
      .flatMap((node) => find(node, "p"))
      .find((node) => node.kind === "element" && node.attrs.role === "status");
    expect(status).toBeDefined();
    expect(texts(nodes).join(" ")).toContain(
      "Exported blocklab-rpc-comparison-x.json.",
    );

    const failed = comparisonViewNodes(
      parseStudioSnapshot(snapshot(okComparison)),
      {
        exportEnabled: true,
        exportFeedback: {
          message: "Export failed: no comparison.",
          error: true,
        },
      },
    );
    const alert = failed
      .flatMap((node) => find(node, "p"))
      .find((node) => node.kind === "element" && node.attrs.role === "alert");
    expect(alert).toBeDefined();
  });
});
