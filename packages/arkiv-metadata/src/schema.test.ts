import { describe, expect, it } from "vitest";
import {
  ARKIV_METADATA_SCHEMA_VERSION,
  DEFAULT_LIFETIME_DAYS,
  isExperimentStatus,
  MAX_LIFETIME_DAYS,
  TERMINAL_STATUSES,
} from "../src/index.js";

describe("schema constants", () => {
  it("defines the contract version", () => {
    expect(ARKIV_METADATA_SCHEMA_VERSION).toBe("1.0");
  });

  it("classifies statuses", () => {
    expect(isExperimentStatus("passed")).toBe(true);
    expect(isExperimentStatus("running")).toBe(true);
    expect(isExperimentStatus("published")).toBe(false);
    expect(TERMINAL_STATUSES).toEqual([
      "passed",
      "failed",
      "partial",
      "inconclusive",
    ]);
  });

  it("keeps the default lifetime inside the chain bound", () => {
    expect(DEFAULT_LIFETIME_DAYS).toBeLessThanOrEqual(MAX_LIFETIME_DAYS);
    expect(MAX_LIFETIME_DAYS).toBe(180);
  });
});
