import type { ScenarioDefinition, TestMode } from "@blocklab/core";

export const rpcBlackoutScenario: ScenarioDefinition = {
  scenarioId: "rpc-blackout",
  version: "1.0.0",
  name: "RPC blackout",
  status: "supported",
  description: "A controlled outage against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "connection-failure",
    targetScope: "loopback",
  },
};

export const rpcLatencyScenario: ScenarioDefinition = {
  scenarioId: "rpc-latency",
  version: "1.0.0",
  name: "RPC latency",
  status: "supported",
  description: "Deterministic response delay against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "response-delay",
    targetScope: "loopback",
  },
};

export function validateScenarioMode(
  scenario: ScenarioDefinition,
  mode: TestMode,
): void {
  if (scenario.requiredMode !== mode) {
    throw new Error(
      `Scenario ${scenario.scenarioId} requires ${scenario.requiredMode} mode; received ${mode}.`,
    );
  }
}
