import { describe, expect, it } from "vitest";
import { isExperimentStatus, type ScenarioDefinition } from "./index.js";

describe("core domain", () => {
  it("recognizes the complete result status set", () => {
    expect(isExperimentStatus("passed")).toBe(true);
    expect(isExperimentStatus("failed")).toBe(true);
    expect(isExperimentStatus("partial")).toBe(true);
    expect(isExperimentStatus("inconclusive")).toBe(true);
    expect(isExperimentStatus("unknown")).toBe(false);
  });

  it("represents a supported scenario without platform APIs", () => {
    const scenario: ScenarioDefinition = {
      scenarioId: "rpc-blackout",
      version: "1.0.0",
      name: "RPC blackout",
      status: "supported",
      description: "Controlled local RPC outage.",
      requiredMode: "local",
      parameters: { durationMs: 1000 },
    };

    expect(scenario.requiredMode).toBe("local");
  });
});
