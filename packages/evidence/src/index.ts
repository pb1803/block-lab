import type {
  CleanupStatus,
  ExperimentResult,
  ExperimentStatus,
} from "@blocklab/core";

export function evaluateCleanup(
  cleanupStatus: CleanupStatus,
): ExperimentStatus {
  return cleanupStatus === "completed" ? "inconclusive" : "inconclusive";
}

export function toJsonReport(result: ExperimentResult): string {
  return JSON.stringify(result, null, 2);
}
