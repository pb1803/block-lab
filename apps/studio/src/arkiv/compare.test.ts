import { describe, expect, it } from "vitest";
import { type CompareSide, compareRecords, sourceLabel } from "./compare.js";
import { arkivRecordFromRow } from "./record.js";
import { makeRow, sampleMetadata } from "./test-fixtures.js";
import type { ArkivRecord } from "./types.js";

function asArkiv(overrides: Partial<ArkivRecord> = {}): ArkivRecord {
  const decoded = arkivRecordFromRow(makeRow());
  if (!decoded.ok) throw new Error("fixture invalid");
  return { ...decoded.record, ...overrides };
}

function asLocal(metadata = sampleMetadata()): CompareSide {
  return { kind: "local", label: "local run", metadata };
}

describe("compareRecords", () => {
  it("reports identical metadata as identical across all fields", () => {
    const left = asLocal();
    const right: CompareSide = {
      kind: "local",
      label: "another local run",
      metadata: sampleMetadata(),
    };
    const model = compareRecords(left, right);
    expect(model.differing).toBe(0);
    expect(model.rows).toHaveLength(17); // 17 allowlisted metadata fields
  });

  it("finds differences field by field", () => {
    const changed = {
      ...sampleMetadata(),
      experimentId: "poc-write-002",
      succeededCount: 40,
    };
    const model = compareRecords(asLocal(), asLocal(changed));
    const ids = model.rows.filter((row) => row.label === "Experiment id");
    expect(ids[0]?.same).toBe(false);
    const succeeded = model.rows.filter((row) => row.label === "Succeeded");
    expect(succeeded[0]?.same).toBe(false);
    expect(model.differing).toBeGreaterThanOrEqual(2);
  });

  it("shows a missing value as '—' and reports it as different", () => {
    const withoutCompletion = { ...sampleMetadata(), completedAtMs: undefined };
    const model = compareRecords(
      asLocal(withoutCompletion),
      asLocal(sampleMetadata()),
    );
    const completed = model.rows.filter((row) => row.label === "Completed at");
    expect(completed[0]?.left).toBe("—");
    expect(completed[0]?.same).toBe(false);
  });

  it("adds system rows only when both sides are on-chain records", () => {
    const onChain: CompareSide = {
      kind: "arkiv",
      label: "A",
      record: asArkiv(),
    };
    const other: CompareSide = { kind: "arkiv", label: "B", record: asArkiv() };
    const both = compareRecords(onChain, other);
    expect(
      both.rows.some((row) => row.group === "system" && row.label === "Owner"),
    ).toBe(true);
    expect(
      both.rows.some(
        (row) => row.group === "system" && row.label === "Entity key",
      ),
    ).toBe(true);

    const mixed = compareRecords(onChain, asLocal());
    expect(mixed.rows.some((row) => row.group === "system")).toBe(false);
  });

  it("never labels a local run as on-chain", () => {
    expect(sourceLabel(asLocal())).toContain("Local record");
    expect(
      sourceLabel({ kind: "arkiv", label: "x", record: asArkiv() }),
    ).toContain("Arkiv record");
  });
});
