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

export const rpcIntermittentFailureScenario: ScenarioDefinition = {
  scenarioId: "rpc-intermittent-failure",
  version: "1.0.0",
  name: "RPC intermittent failure",
  status: "supported",
  description: "Periodic failure windows against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "intermittent-failure",
    targetScope: "loopback",
  },
};

export const rpcRateLimitScenario: ScenarioDefinition = {
  scenarioId: "rpc-rate-limit",
  version: "1.0.0",
  name: "RPC rate limit",
  status: "supported",
  description:
    "Deterministic rate-limiting and quota enforcement against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "rate-limit",
    targetScope: "loopback",
  },
};

export const rpcConnectionFailureScenario: ScenarioDefinition = {
  scenarioId: "rpc-connection-failure",
  version: "1.0.0",
  name: "RPC connection failure",
  status: "supported",
  description:
    "Transport-level socket reset and premature termination against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "connection-failure",
    targetScope: "loopback",
  },
};

export const rpcMalformedResponseScenario: ScenarioDefinition = {
  scenarioId: "rpc-malformed-response",
  version: "1.0.0",
  name: "RPC malformed response",
  status: "supported",
  description:
    "Faulty and protocol-violating JSON-RPC responses against loopback RPC traffic.",
  requiredMode: "local",
  parameters: {
    fault: "malformed-response",
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
