import { describe, expect, it } from "vitest";
import { MalformedRecordError, summaryFromRow } from "./gateway.js";

describe("summaryFromRow", () => {
  it("maps a complete discovery row", () => {
    const summary = summaryFromRow({
      $key: "0xbb",
      experimentId: { value: "poc-write-001" },
      scenarioName: { value: "RPC blackout" },
      status: { value: "passed" },
      startedAtMs: { value: 1_793_924_125_113n },
    });
    expect(summary).toEqual({
      entityKey: "0xbb",
      experimentId: "poc-write-001",
      scenarioName: "RPC blackout",
      status: "passed",
      startedAtMs: 1_793_924_125_113,
    });
  });

  it("rejects a row missing an indexed attribute instead of substituting", () => {
    expect(() =>
      summaryFromRow({
        $key: "0xbb",
        experimentId: { value: "poc-write-001" },
        scenarioName: undefined,
        status: { value: "passed" },
        startedAtMs: { value: 1n },
      }),
    ).toThrow(MalformedRecordError);
  });

  it("rejects a row without a key", () => {
    expect(() =>
      summaryFromRow({
        $key: undefined,
        experimentId: { value: "poc-write-001" },
        scenarioName: { value: "x" },
        status: { value: "passed" },
        startedAtMs: { value: 1n },
      }),
    ).toThrow(MalformedRecordError);
  });
});
