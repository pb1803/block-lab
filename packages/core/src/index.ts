export type SourceType = "local" | "github" | "url";

export type TestMode = "local" | "authorized-staging" | "external-observation";

export type EvidenceConfidence = "detected" | "inferred" | "user-declared";

export type DependencyType =
  | "application"
  | "framework"
  | "package-manager"
  | "rpc"
  | "chain"
  | "contract"
  | "wallet"
  | "indexer"
  | "unknown";

export type ScenarioStatus = "supported" | "planned" | "unsupported";

export type ExperimentStatus = "passed" | "failed" | "partial" | "inconclusive";

export type CleanupStatus = "completed" | "failed" | "not-attempted";

export interface Project {
  readonly projectId: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly testMode: TestMode;
  readonly detectedStack: readonly string[];
  readonly dependencies: readonly DependencyNode[];
  readonly createdAt: string;
}

export interface DependencyNode {
  readonly nodeId: string;
  readonly type: DependencyType;
  readonly name: string;
  readonly label: string;
  readonly evidenceSource: string;
  readonly evidence: string;
  readonly confidence: EvidenceConfidence;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface DependencyEdge {
  readonly edgeId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relationship: string;
  readonly evidenceSource: string;
  readonly confidence: EvidenceConfidence;
}

export interface ScenarioDefinition {
  readonly scenarioId: string;
  readonly version: string;
  readonly name: string;
  readonly status: ScenarioStatus;
  readonly description: string;
  readonly requiredMode: TestMode;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface Experiment {
  readonly experimentId: string;
  readonly projectId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly targetDependencyId: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ExperimentMetrics {
  readonly requestCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly latencyMs?: Readonly<{
    min: number;
    max: number;
    average: number;
  }>;
}

export interface ExperimentObservation {
  readonly phase: "baseline" | "fault" | "recovery";
  readonly timestamp: string;
  readonly category: string;
  readonly message: string;
}

export interface ExperimentResult {
  readonly runId: string;
  readonly experimentId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly environmentFingerprint: string;
  readonly baselineMetrics: ExperimentMetrics;
  readonly faultMetrics: ExperimentMetrics;
  readonly recoveryMetrics: ExperimentMetrics;
  readonly observations: readonly ExperimentObservation[];
  readonly status: ExperimentStatus;
  readonly cleanupStatus: CleanupStatus;
  readonly evidenceDigest: string;
}

export interface EvidenceRecord {
  readonly recordId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly category: string;
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

export function isExperimentStatus(value: string): value is ExperimentStatus {
  return (
    value === "passed" ||
    value === "failed" ||
    value === "partial" ||
    value === "inconclusive"
  );
}
