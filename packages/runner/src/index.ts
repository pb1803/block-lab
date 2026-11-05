import type { Experiment, ScenarioDefinition } from "@blocklab/core";

export type RunnerPhase =
  | "preflight"
  | "baseline"
  | "inject"
  | "observe"
  | "recover"
  | "cleanup"
  | "evaluate"
  | "report";

export interface RunnerEvent {
  readonly runId: string;
  readonly phase: RunnerPhase;
  readonly timestamp: string;
  readonly message: string;
}

export interface Runner {
  run(
    experiment: Experiment,
    scenario: ScenarioDefinition,
  ): AsyncIterable<RunnerEvent>;
}

export function assertLoopbackTarget(target: URL): void {
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    throw new Error(`Only loopback targets are allowed by default: ${target}.`);
  }
}
