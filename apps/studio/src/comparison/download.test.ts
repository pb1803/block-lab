import { describe, expect, it } from "vitest";
import {
  type DownloadAnchor,
  type DownloadEnvironment,
  downloadComparisonExport,
  isComparisonExportDownloadSupported,
} from "./download.js";
import {
  buildComparisonExport,
  type ComparisonExportArtifact,
} from "./export.js";
import { okComparison, snapshot } from "./test-fixtures.js";

const EXPORTED_AT = "2026-01-02T03:04:05.000Z";

function artifact(): ComparisonExportArtifact {
  const result = buildComparisonExport(snapshot(okComparison), {
    exportedAt: EXPORTED_AT,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.artifact;
}

interface Harness {
  readonly environment: DownloadEnvironment;
  readonly calls: string[];
  readonly anchor: DownloadAnchor;
  blob(): Blob | undefined;
}

function harness(options: { failUrl?: boolean } = {}): Harness {
  const calls: string[] = [];
  let captured: Blob | undefined;
  const anchor: DownloadAnchor = {
    href: "",
    download: "",
    style: { display: "" },
    click: () => calls.push("click"),
    remove: () => calls.push("remove"),
  };
  const environment: DownloadEnvironment = {
    createObjectURL: (blob) => {
      if (options.failUrl === true) throw new Error("no object urls");
      captured = blob;
      calls.push("create-url");
      return "blob:blocklab-1";
    },
    revokeObjectURL: (url) => calls.push(`revoke:${url}`),
    createAnchor: () => anchor,
    append: () => calls.push("append"),
    // The fake runs the deferred revoke immediately so ordering is assertable.
    scheduleRevoke: (callback) => {
      calls.push("schedule-revoke");
      callback();
    },
  };
  return { environment, calls, anchor, blob: () => captured };
}

describe("Studio export download", () => {
  it("downloads exactly the artifact JSON under its deterministic filename", async () => {
    const { environment, calls, anchor, blob } = harness();
    const value = artifact();

    const result = downloadComparisonExport(value, environment);

    expect(result).toEqual({ ok: true, filename: value.filename });
    const text = (await blob()?.text()) ?? "";
    expect(text).toBe(value.json);
    expect(JSON.parse(text)).toMatchObject({
      schemaVersion: "1.0",
      kind: "blocklab.rpc-comparison",
    });
    expect(anchor.download).toBe(value.filename);
    expect(anchor.href).toBe("blob:blocklab-1");
    expect(anchor.style?.display).toBe("none");
    expect(calls).toEqual([
      "create-url",
      "append",
      "click",
      "remove",
      "schedule-revoke",
      "revoke:blob:blocklab-1",
    ]);
  });

  it("defers revocation so the browser can consume the blob", () => {
    const { environment, calls } = harness();
    downloadComparisonExport(artifact(), environment);

    expect(calls).toContain("schedule-revoke");
    expect(calls.filter((call) => call.startsWith("revoke:"))).toHaveLength(1);
  });

  it("revokes immediately when a failure occurred", () => {
    const { environment, calls } = harness({ failUrl: true });
    downloadComparisonExport(artifact(), environment);

    expect(calls).not.toContain("schedule-revoke");
    expect(calls).not.toContain("click");
  });

  it("reports a failure instead of throwing when the browser rejects the blob", () => {
    const { environment, calls } = harness({ failUrl: true });

    const result = downloadComparisonExport(artifact(), environment);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("rejected the download");
    expect(calls).not.toContain("click");
  });

  it("reports no capability in an environment without a document", () => {
    expect(isComparisonExportDownloadSupported()).toBe(false);
    const result = downloadComparisonExport(artifact());

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cannot start a file download");
  });
});
