/**
 * Browser delivery for an export artifact.
 *
 * Kept separate from `export.ts` so the export itself stays environment-neutral
 * and testable without a DOM. The environment is injectable, which lets tests
 * assert exactly what a click would download.
 */
import type { ComparisonExportArtifact } from "./export.js";

const REVOKE_DELAY_MS = 60_000;

export interface DownloadAnchor {
  href: string;
  download: string;
  style?: { display: string };
  remove?(): void;
  click(): void;
}

export interface DownloadEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): DownloadAnchor;
  append?(anchor: DownloadAnchor): void;
  /**
   * Defers revocation. Revoking while the browser is still consuming the blob
   * aborts the download, so the default waits before releasing the URL.
   */
  scheduleRevoke?(callback: () => void): void;
}

export interface DownloadResult {
  readonly ok: boolean;
  readonly filename: string;
  readonly reason?: string;
}

/** True when the current global environment can start a download. */
export function isComparisonExportDownloadSupported(): boolean {
  return defaultEnvironment() !== null;
}

function defaultEnvironment(): DownloadEnvironment | null {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return null;
  }
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return null;
  }
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    append: (anchor) => {
      if (anchor instanceof Node) {
        (document.body ?? document.documentElement).append(anchor);
      }
    },
    scheduleRevoke: (callback) => {
      if (typeof setTimeout === "function") {
        setTimeout(callback, REVOKE_DELAY_MS);
      } else {
        callback();
      }
    },
  };
}

/**
 * Downloads the artifact as JSON through a temporary object URL.
 *
 * The artifact is not modified and no network request is made. The object URL
 * is revoked on a short delay: revoking it synchronously cancels the download
 * before the browser can consume the blob (verified in headless Chrome).
 */
export function downloadComparisonExport(
  artifact: ComparisonExportArtifact,
  environment?: DownloadEnvironment,
): DownloadResult {
  const env = environment ?? defaultEnvironment();
  if (env === null) {
    return {
      ok: false,
      filename: artifact.filename,
      reason: "This browser cannot start a file download.",
    };
  }

  let url: string | null = null;
  let handedOff = false;
  const anchor = env.createAnchor();
  try {
    const blob = new Blob([artifact.json], { type: "application/json" });
    url = env.createObjectURL(blob);
    anchor.href = url;
    anchor.download = artifact.filename;
    if (anchor.style !== undefined) anchor.style.display = "none";
    env.append?.(anchor);
    anchor.click();
    anchor.remove?.();
    handedOff = true;
    const revokeUrl = url;
    if (env.scheduleRevoke !== undefined) {
      env.scheduleRevoke(() => env.revokeObjectURL(revokeUrl));
    } else {
      env.revokeObjectURL(revokeUrl);
    }
    return { ok: true, filename: artifact.filename };
  } catch {
    return {
      ok: false,
      filename: artifact.filename,
      reason: "The browser rejected the download.",
    };
  } finally {
    // On failure nothing was handed to the browser, so release it immediately.
    if (url !== null && !handedOff) env.revokeObjectURL(url);
  }
}
