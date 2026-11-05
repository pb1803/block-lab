import type { Project } from "@blocklab/core";

export interface StudioShell {
  readonly name: "BLOCKLAB Studio";
  readonly localAgentRequired: true;
  readonly project: Project | null;
}

export const studioShell: StudioShell = {
  name: "BLOCKLAB Studio",
  localAgentRequired: true,
  project: null,
};

export {
  type CoverageView,
  createStudioSnapshot,
  type MethodRow,
  type MountedComparisonView,
  mountComparisonView,
  parseStudioSnapshot,
  STUDIO_COMPARISON_EVENT,
  STUDIO_COMPARISON_SCHEMA_VERSION,
  type StudioComparisonModel,
  type StudioComparisonState,
  type StudioRpcSnapshot,
  type ViemProbeResult,
} from "./comparison/index.js";
