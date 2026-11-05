/**
 * DOM mounting for the read-only comparison view.
 *
 * This is the only module in the feature that touches the document. It reads a
 * caller-provided source, renders nodes, and refreshes when the caller publishes
 * an event. There is no polling and no RPC execution here.
 *
 * The export action is part of the panel: it builds the redacted artifact from
 * the snapshot currently displayed and hands it to the browser download helper.
 */
import {
  type DownloadEnvironment,
  downloadComparisonExport,
  isComparisonExportDownloadSupported,
} from "./download.js";
import { buildComparisonExport } from "./export.js";
import { parseStudioSnapshot, type StudioComparisonState } from "./model.js";
import { comparisonViewNodes, type ViewNode } from "./view.js";

export interface ComparisonSource {
  /** Returns the current snapshot, or undefined when nothing has run yet. */
  read(): unknown;
  /** Optional subscription; the returned function unsubscribes. */
  subscribe?(listener: () => void): () => void;
}

export interface MountComparisonOptions {
  /** Overrides capability detection; false removes the enabled state. */
  readonly exportEnabled?: boolean;
  /** Injectable delivery for hosts and tests; defaults to the browser. */
  readonly downloadEnvironment?: DownloadEnvironment;
}

export interface ExportAttempt {
  readonly ok: boolean;
  readonly filename?: string;
  readonly message: string;
}

export interface MountedComparisonView {
  refresh(): void;
  exportCurrent(): ExportAttempt;
  unmount(): void;
}

interface Feedback {
  readonly message: string;
  readonly error: boolean;
}

function renderNode(doc: Document, node: ViewNode): Node {
  if (node.kind === "text") return doc.createTextNode(node.text);
  const element = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    element.setAttribute(name, value);
    // `disabled` is also a property; set both so styling and behaviour agree.
    if (name === "disabled") (element as HTMLButtonElement).disabled = true;
  }
  for (const child of node.children) {
    element.append(renderNode(doc, child));
  }
  return element;
}

function stateFrom(source: ComparisonSource): {
  readonly state: StudioComparisonState;
  readonly raw: unknown;
} {
  let raw: unknown;
  try {
    raw = source.read();
  } catch {
    return {
      state: {
        status: "invalid",
        issues: ["The comparison source could not be read."],
      },
      raw: undefined,
    };
  }
  return { state: parseStudioSnapshot(raw), raw };
}

/**
 * Mounts the view into `container`. The caller keeps ownership of the payload
 * and of the event that signals a new one; Studio never fetches data itself.
 */
export function mountComparisonView(
  container: HTMLElement,
  source: ComparisonSource,
  options: MountComparisonOptions = {},
): MountedComparisonView {
  const exportEnabled =
    options.exportEnabled ?? isComparisonExportDownloadSupported();
  let feedback: Feedback | null = null;

  const render = (): void => {
    const { state } = stateFrom(source);
    const nodes = comparisonViewNodes(state, {
      exportEnabled: exportEnabled && state.status === "ready",
      exportFeedback: feedback,
    });
    container.replaceChildren(
      ...nodes.map((node) => renderNode(container.ownerDocument, node)),
    );
  };

  const exportCurrent = (): ExportAttempt => {
    // Re-read the source so the export always matches what is displayed.
    const { state, raw } = stateFrom(source);
    if (state.status !== "ready") {
      const attempt: ExportAttempt = {
        ok: false,
        message: "There is no valid comparison to export.",
      };
      feedback = { message: attempt.message, error: true };
      render();
      return attempt;
    }
    if (!exportEnabled) {
      const attempt: ExportAttempt = {
        ok: false,
        message: "Export is unavailable in this environment.",
      };
      feedback = { message: attempt.message, error: true };
      render();
      return attempt;
    }

    const built = buildComparisonExport(raw);
    if (!built.ok) {
      const attempt: ExportAttempt = {
        ok: false,
        message: `Export failed: ${built.reason}`,
      };
      feedback = { message: attempt.message, error: true };
      render();
      return attempt;
    }

    const download = downloadComparisonExport(
      built.artifact,
      options.downloadEnvironment,
    );
    const attempt: ExportAttempt = download.ok
      ? {
          ok: true,
          filename: download.filename,
          message: `Exported ${download.filename} (${built.artifact.completeness}).`,
        }
      : {
          ok: false,
          message: `Export failed: ${download.reason ?? "unknown error"}`,
        };
    feedback = { message: attempt.message, error: !attempt.ok };
    render();
    return attempt;
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-blocklab-export]") === null) return;
    event.preventDefault();
    exportCurrent();
  };

  container.addEventListener("click", onClick);

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
    exportCurrent,
    unmount: (): void => {
      container.removeEventListener("click", onClick);
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
