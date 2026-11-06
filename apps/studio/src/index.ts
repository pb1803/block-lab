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
  ArkivController,
  type ArkivGateway,
  type ArkivRecord,
  type ArkivWalletActions,
  type CompareModel,
  type CompareRow,
  type CompareSide,
  compareRecords,
  createRabdiGateway,
  DETAIL_DISCLAIMER,
  detailRows,
  type HistorySearchField,
  mountArkivCompare,
  mountStudioArkiv,
  publicDisclosure,
  RABDI_CHAIN_ID,
  RABDI_CHAIN_ID_HEX,
  type StudioArkivState,
  type StudioError,
  sourceLabel,
} from "./arkiv/index.js";
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
export {
  hashForRoute,
  mountStudioShell,
  routeFromHash,
  type StudioNavigationItem,
  type StudioRoute,
  type StudioShellMount,
  studioNavigation,
} from "./shell.js";
