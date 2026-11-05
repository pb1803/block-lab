import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountComparisonView } from "./dom.js";
import type { DownloadEnvironment } from "./download.js";
import { okComparison, snapshot } from "./test-fixtures.js";

/**
 * Minimal element tree. DOM libraries are not a dependency of this repository,
 * so this fake stands in for the parts `mountComparisonView` uses. It exercises
 * the real wiring (click listener, re-render, download call), not a mock of it.
 */
class FakeElement {
  readonly tag: string;
  readonly attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  ownerDocument: FakeDocument | null = null;
  private listener:
    | ((event: { target: unknown; preventDefault(): void }) => void)
    | null = null;

  constructor(tag = "") {
    this.tag = tag;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [...nodes];
  }

  addEventListener(
    _type: string,
    listener: (event: { target: unknown; preventDefault(): void }) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(): void {
    this.listener = null;
  }

  closest(selector: string): FakeElement | null {
    if (
      selector === "[data-blocklab-export]" &&
      "data-blocklab-export" in this.attrs
    ) {
      return this;
    }
    return null;
  }

  dispatchClickFrom(target: FakeElement): void {
    this.listener?.({ target, preventDefault: () => undefined });
  }
}

interface FakeText {
  readonly text: string;
}

type FakeNode = FakeElement | FakeText;

class FakeDocument {
  createElement(tag: string): FakeElement {
    const element = new FakeElement(tag);
    element.ownerDocument = this;
    return element;
  }

  createTextNode(text: string): FakeText {
    return { text };
  }
}

function isElement(node: FakeNode): node is FakeElement {
  return node instanceof FakeElement;
}

function texts(nodes: readonly FakeNode[]): string[] {
  const out: string[] = [];
  const walk = (node: FakeNode): void => {
    if (!isElement(node)) {
      out.push(node.text);
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

function find(
  node: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (current: FakeElement): void => {
    if (predicate(current)) found.push(current);
    for (const child of current.children) {
      if (isElement(child)) walk(child);
    }
  };
  walk(node);
  return found;
}

interface DownloadSpy {
  readonly environment: DownloadEnvironment;
  readonly urlCalls: string[];
  blob(): Blob | undefined;
}

function downloadSpy(): DownloadSpy {
  const urlCalls: string[] = [];
  let captured: Blob | undefined;
  return {
    environment: {
      createObjectURL: (blob) => {
        captured = blob;
        return "blob:fake";
      },
      revokeObjectURL: (url) => urlCalls.push(url),
      createAnchor: () => ({
        href: "",
        download: "",
        style: { display: "" },
        click: () => undefined,
        remove: () => undefined,
      }),
      append: () => undefined,
    },
    urlCalls,
    blob: () => captured,
  };
}

const before = globalThis.Element;

beforeAll(() => {
  (globalThis as { Element?: unknown }).Element = FakeElement;
});

afterAll(() => {
  (globalThis as { Element?: unknown }).Element = before;
});

function mount(raw: unknown, exportEnabled = true) {
  const document = new FakeDocument();
  const container = document.createElement("div");
  const spy = downloadSpy();
  let reads = 0;
  const view = mountComparisonView(
    container as unknown as HTMLElement,
    {
      read: () => {
        reads += 1;
        return raw;
      },
    },
    { exportEnabled, downloadEnvironment: spy.environment },
  );
  const button = () =>
    find(container, (element) => "data-blocklab-export" in element.attrs)[0];
  const click = () => {
    const target = button();
    if (target !== undefined) container.dispatchClickFrom(target);
  };
  return { container, view, spy, button, click, reads: () => reads };
}

describe("Studio export action", () => {
  it("disables export before any comparison exists", () => {
    const mounted = mount(undefined);

    expect(mounted.button()?.attrs.disabled).toBe("true");
    mounted.click();
    expect(mounted.spy.blob()).toBeUndefined();
    expect(texts(mounted.container.children).join(" ")).toContain(
      "There is no valid comparison to export.",
    );
  });

  it("exports the displayed comparison and reports the filename", async () => {
    const raw = snapshot(okComparison);
    const before = JSON.stringify(raw);
    const mounted = mount(raw);

    expect(mounted.button()?.attrs.disabled).toBeUndefined();
    mounted.click();

    const blob = mounted.spy.blob();
    expect(blob).toBeDefined();
    const parsed = JSON.parse(await blob?.text()) as {
      kind: string;
      run: { completeness: string };
      direct: { totals: { succeeded: number } };
    };
    expect(parsed.kind).toBe("blocklab.rpc-comparison");
    expect(parsed.run.completeness).toBe("complete");
    expect(parsed.direct.totals.succeeded).toBe(4);

    const rendered = texts(mounted.container.children).join(" ");
    expect(rendered).toContain("Exported blocklab-rpc-comparison-");
    expect(rendered).toContain("(complete)");
    expect(mounted.spy.urlCalls).toEqual(["blob:fake"]);
    // The snapshot the page owns must not be modified by exporting it.
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("re-reads the source for the export instead of trusting a stale copy", () => {
    const mounted = mount(snapshot(okComparison));
    const before = mounted.reads();
    mounted.click();

    expect(mounted.reads()).toBeGreaterThan(before);
  });

  it("refuses to export when the host disables the capability", () => {
    const mounted = mount(snapshot(okComparison), false);

    expect(mounted.button()?.attrs.disabled).toBe("true");
    mounted.click();
    expect(mounted.spy.blob()).toBeUndefined();
  });

  it("clears the panel and its listener on unmount", () => {
    const mounted = mount(snapshot(okComparison));
    mounted.view.unmount();

    expect(mounted.container.children).toHaveLength(0);
    mounted.click();
    expect(mounted.spy.blob()).toBeUndefined();
  });
});
