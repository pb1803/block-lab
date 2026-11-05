/**
 * DOM mounting for the read-only comparison view.
 *
 * This is the only module in the feature that touches the document. It reads a
 * caller-provided source, renders nodes, and refreshes when the caller publishes
 * an event. There is no polling and no RPC execution here.
 */
import { parseStudioSnapshot, type StudioComparisonState } from "./model.js";
import { comparisonViewNodes, type ViewNode } from "./view.js";

export interface ComparisonSource {
  /** Returns the current snapshot, or undefined when nothing has run yet. */
  read(): unknown;
  /** Optional subscription; the returned function unsubscribes. */
  subscribe?(listener: () => void): () => void;
}

export interface MountedComparisonView {
  refresh(): void;
  unmount(): void;
}

function renderNode(doc: Document, node: ViewNode): Node {
  if (node.kind === "text") return doc.createTextNode(node.text);
  const element = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    element.setAttribute(name, value);
  }
  for (const child of node.children) {
    element.append(renderNode(doc, child));
  }
  return element;
}

function stateFrom(source: ComparisonSource): StudioComparisonState {
  let raw: unknown;
  try {
    raw = source.read();
  } catch {
    return {
      status: "invalid",
      issues: ["The comparison source could not be read."],
    };
  }
  return parseStudioSnapshot(raw);
}

/**
 * Mounts the view into `container`. The caller keeps ownership of the payload
 * and of the event that signals a new one; Studio never fetches data itself.
 */
export function mountComparisonView(
  container: HTMLElement,
  source: ComparisonSource,
): MountedComparisonView {
  const render = (): void => {
    const nodes = comparisonViewNodes(stateFrom(source));
    container.replaceChildren(
      ...nodes.map((node) => renderNode(container.ownerDocument, node)),
    );
  };

  let unsubscribe: (() => void) | undefined;
  if (source.subscribe !== undefined) {
    try {
      unsubscribe = source.subscribe(render);
    } catch {
      // A broken subscription must not prevent the initial render.
      unsubscribe = undefined;
    }
  }

  render();

  return {
    refresh: render,
    unmount: (): void => {
      if (unsubscribe !== undefined) {
        try {
          unsubscribe();
        } catch {
          // Unsubscribing twice is harmless.
        }
        unsubscribe = undefined;
      }
      container.replaceChildren();
    },
  };
}
