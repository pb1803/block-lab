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
  buildComparisonExport,
  type ComparisonExportOptions,
  type ComparisonExportResult,
  type CoverageView,
  createStudioSnapshot,
  downloadComparisonExport,
  type ExportCompleteness,
  isComparisonExportDownloadSupported,
  type MethodRow,
  type MountedComparisonView,
  mountComparisonView,
  parseStudioSnapshot,
  STUDIO_COMPARISON_EVENT,
  STUDIO_COMPARISON_SCHEMA_VERSION,
  STUDIO_EXPORT_KIND,
  STUDIO_EXPORT_SCHEMA_VERSION,
  type StudioComparisonExport,
  type StudioComparisonModel,
  type StudioComparisonState,
  type StudioRpcSnapshot,
  type ViemProbeResult,
} from "./comparison/index.js";
