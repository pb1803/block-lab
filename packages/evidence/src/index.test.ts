import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareEvidence,
  createRpcBlackoutEvidence,
  createRpcLatencyEvidence,
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceObservation,
  EvidenceValidationError,
  evaluateRpcBlackout,
  evaluateRpcLatency,
  listEvidence,
  normalizeLatencyProxyEvidence,
  normalizeProxyEvidence,
  type RpcBlackoutEvidence,
  readEvidence,
  replayConfiguration,
  toReplayConfiguration,
  validateEvidence,
  writeEvidence,
} from "./index.js";

const startedAt = "2026-01-01T00:00:00.000Z";
const schedule = {
  startOffsetMs: 100,
  durationMs: 100,
  experimentDurationMs: 400,
};
const latencySchedule = {
  delayMs: 50,
  startOffsetMs: 100,
  durationMs: 100,
  experimentDurationMs: 400,
};

function record(
  offset: number,
  outcome: EvidenceObservation["outcome"],
  correlationId: string,
  injected = false,
): {
  readonly executionId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly outcome: EvidenceObservation["outcome"];
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly correlationId: string;
} {
  return {
    executionId: "execution-1",
    scenarioId: "rpc-blackout",
    timestamp: new Date(Date.parse(startedAt) + offset).toISOString(),
    method: "eth_blockNumber",
    outcome,
    injected,
    latencyMs: offset % 17,
    correlationId,
  };
}

function completeEvidence(
  records: ReturnType<typeof record>[],
  state: "completed" | "failed" | "cancelled" | "timed_out" = "completed",
): RpcBlackoutEvidence {
  return createRpcBlackoutEvidence(
    {
      executionId: "execution-1",
      state,
      startedAt,
      finishedAt: "2026-01-01T00:00:01.000Z",
    },
    schedule,
    records,
  );
}

describe("evidence validation and classification", () => {
  it("classifies exact blackout boundaries using [start, end)", () => {
    const observations = normalizeProxyEvidence(
      [
        record(99, "forwarded_success", "before"),
        record(100, "injected_blackout", "at-start", true),
        record(200, "forwarded_success", "at-end"),
      ],
      startedAt,
      schedule,
    );
    expect(observations.map((observation) => observation.phase)).toEqual([
      "baseline",
      "fault",
      "recovery",
    ]);
  });

  it("sorts out-of-order observations and rejects duplicate IDs", () => {
    const observations = normalizeProxyEvidence(
      [
        record(200, "forwarded_success", "later"),
        record(0, "forwarded_success", "first"),
      ],
      startedAt,
      schedule,
    );
    expect(
      observations.map((observation) => observation.correlationId),
    ).toEqual(["first", "later"]);
    expect(() =>
      completeEvidence([
        record(0, "forwarded_success", "duplicate"),
        record(200, "forwarded_success", "duplicate"),
      ]),
    ).toThrow(/Duplicate/);
  });

  it("validates schema, required fields, and timestamps", () => {
    const evidence = completeEvidence([
      record(0, "forwarded_success", "valid"),
    ]);
    expect(() => validateEvidence(evidence)).not.toThrow();
    expect(() =>
      validateEvidence({ ...evidence, schemaVersion: "2.0" }),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      validateEvidence({ ...evidence, startedAt: "not-a-date" }),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      validateEvidence({ ...evidence, evaluation: undefined }),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      validateEvidence({ ...evidence, evidenceDigest: "not-a-digest" }),
    ).toThrow(EvidenceValidationError);
    expect(EVIDENCE_SCHEMA_VERSION).toBe("1.0");
  });
});

describe("rpc-blackout evaluation and metrics", () => {
  it("passes only when baseline, injected fault, and recovery are observed", () => {
    const evidence = completeEvidence([
      record(0, "forwarded_success", "baseline"),
      record(100, "injected_blackout", "fault", true),
      record(200, "forwarded_success", "recovery"),
    ]);
    expect(evidence.evaluation.status).toBe("passed");
    expect(evidence.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.evaluation.metrics).toMatchObject({
      totalRequests: 3,
      successfulForwardedRequests: 2,
      injectedBlackoutFailures: 1,
      recoverySuccessCount: 1,
      recoveryLatencyMs: 0,
    });

    describe("rpc-latency evaluation and metrics", () => {
      it("classifies request-start boundaries and measures injected latency", () => {
        const records = [
          {
            ...record(0, "forwarded_success", "baseline"),
            latencyMs: 5,
            requestTimestamp: new Date(Date.parse(startedAt)).toISOString(),
          },
          {
            ...record(150, "forwarded_success", "fault", true),
            latencyMs: 55,
            injectedDelayMs: 50,
            requestTimestamp: new Date(
              Date.parse(startedAt) + 100,
            ).toISOString(),
          },
          {
            ...record(250, "forwarded_success", "recovery"),
            latencyMs: 6,
            requestTimestamp: new Date(
              Date.parse(startedAt) + 200,
            ).toISOString(),
          },
        ];
        const observations = normalizeLatencyProxyEvidence(
          records,
          startedAt,
          latencySchedule,
        );
        expect(observations.map((observation) => observation.phase)).toEqual([
          "baseline",
          "fault",
          "recovery",
        ]);
        const evidence = createRpcLatencyEvidence(
          {
            executionId: "latency-execution",
            state: "completed",
            startedAt,
            finishedAt: "2026-01-01T00:00:01.000Z",
          },
          latencySchedule,
          records,
        );
        expect(evidence.evaluation.status).toBe("passed");
        expect(evidence.evaluation.metrics).toMatchObject({
          injectedRequestCount: 1,
          baselineAverageLatencyMs: 5,
          faultAverageLatencyMs: 55,
          recoveryAverageLatencyMs: 6,
          observedAdditionalLatencyMs: 50,
        });
      });

      it("remains inconclusive when configured latency is not observed", () => {
        const evaluation = evaluateRpcLatency(
          normalizeLatencyProxyEvidence(
            [
              {
                ...record(0, "forwarded_success", "baseline"),
                latencyMs: 10,
              },
              {
                ...record(100, "forwarded_success", "fault", true),
                latencyMs: 10,
              },
              {
                ...record(200, "forwarded_success", "recovery"),
                latencyMs: 10,
              },
            ],
            startedAt,
            latencySchedule,
          ),
          startedAt,
          latencySchedule,
        );
        expect(evaluation.status).toBe("inconclusive");
        expect(evaluation.fault.reasons).toContain(
          "configured_delay_not_observed",
        );
      });
    });
  });

  it("fails unhealthy baseline and recovery failures", () => {
    const baselineFailure = completeEvidence([
      record(0, "upstream_unavailable", "baseline-failure"),
      record(100, "injected_blackout", "fault", true),
      record(200, "forwarded_success", "recovery"),
    ]);
    expect(baselineFailure.evaluation.status).toBe("failed");
    expect(baselineFailure.evaluation.baseline.reasons).toContain(
      "baseline_unhealthy",
    );

    const recoveryFailure = completeEvidence([
      record(0, "forwarded_success", "baseline"),
      record(100, "injected_blackout", "fault", true),
      record(200, "upstream_unavailable", "recovery"),
    ]);
    expect(recoveryFailure.evaluation.status).toBe("failed");
    expect(recoveryFailure.evaluation.recovery.reasons).toContain(
      "recovery_failed",
    );
  });

  it("is inconclusive when requests do not establish fault or recovery", () => {
    const noFault = completeEvidence([
      record(0, "forwarded_success", "baseline"),
      record(250, "forwarded_success", "recovery"),
    ]);
    expect(noFault.evaluation.status).toBe("inconclusive");
    expect(noFault.evaluation.fault.reasons).toContain(
      "fault_observation_missing",
    );

    const genuineUpstreamFailure = completeEvidence([
      record(0, "forwarded_success", "baseline"),
      record(120, "upstream_unavailable", "upstream-failure"),
      record(200, "forwarded_success", "recovery"),
    ]);
    expect(genuineUpstreamFailure.evaluation.status).toBe("inconclusive");
    expect(genuineUpstreamFailure.evaluation.fault.reasons).toContain(
      "no_injected_blackout_observed",
    );
  });

  it("keeps empty phase metrics undefined rather than reporting fake averages", () => {
    const evaluation = evaluateRpcBlackout([], startedAt, schedule);
    expect(evaluation.metrics.totalRequests).toBe(0);
    expect(evaluation.metrics.averageLatencyMs).toBeUndefined();
    expect(evaluation.metrics.medianLatencyMs).toBeUndefined();
    expect(evaluation.metrics.recoveryLatencyMs).toBeUndefined();
  });

  it("separates injected failures from upstream errors and computes median latency", () => {
    const evidence = completeEvidence([
      record(0, "forwarded_success", "one"),
      record(20, "forwarded_error", "two"),
      record(100, "injected_blackout", "three", true),
      record(200, "forwarded_success", "four"),
    ]);
    expect(evidence.evaluation.metrics.upstreamErrors).toBe(1);
    expect(evidence.evaluation.metrics.injectedBlackoutFailures).toBe(1);
    expect(evidence.evaluation.metrics.medianLatencyMs).toBe(8);
  });

  it("retains cancelled and timed-out terminal states without claiming success", () => {
    const cancelled = completeEvidence(
      [
        record(0, "forwarded_success", "cancelled"),
        record(100, "injected_blackout", "cancelled-fault", true),
        record(200, "forwarded_success", "cancelled-recovery"),
      ],
      "cancelled",
    );
    expect(cancelled.terminalState).toBe("cancelled");
    expect(cancelled.evaluation.status).toBe("inconclusive");
    expect(
      completeEvidence(
        [record(0, "forwarded_success", "timed-out")],
        "timed_out",
      ).terminalState,
    ).toBe("timed_out");
  });
});

describe("replay and comparison", () => {
  it("replays only normalized configuration with new IDs", () => {
    const evidence = completeEvidence([
      record(0, "forwarded_success", "original"),
    ]);
    const replay = replayConfiguration(toReplayConfiguration(evidence));
    expect(replay.executionId).not.toBe(evidence.executionId);
    expect(replay.replayId).not.toBe(evidence.recordId);
    expect(replay.configuration).toEqual(schedule);
  });

  it("rejects unsupported replay versions", () => {
    expect(() =>
      replayConfiguration({
        schemaVersion: "1.0",
        scenarioId: "rpc-blackout",
        scenarioVersion: "9.0.0",
        configuration: schedule,
      }),
    ).toThrow(/Unsupported replay scenario version/);
  });

  it("compares equivalent and different configurations deterministically", () => {
    const left = completeEvidence([
      record(0, "forwarded_success", "left-baseline"),
      record(100, "injected_blackout", "left-fault", true),
      record(200, "forwarded_success", "left-recovery"),
    ]);
    const right = completeEvidence([
      record(0, "forwarded_success", "right-baseline"),
      record(100, "injected_blackout", "right-fault", true),
      record(200, "forwarded_success", "right-recovery"),
    ]);
    expect(compareEvidence(left, right).comparable).toBe(true);
    const changed = completeEvidence([
      record(0, "forwarded_success", "changed"),
    ]);
    const comparison = compareEvidence(left, {
      ...changed,
      configuration: { ...schedule, durationMs: 150 },
    });
    expect(comparison.comparable).toBe(false);
    expect(comparison.differences).toContain("blackout_configuration");
    expect(comparison.metrics[0]?.note).toBe("Configurations differ.");
  });
});

describe("local persistence", () => {
  it("writes atomically, reads back, and refuses overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blocklab-evidence-"));
    const path = join(directory, "run.json");
    const evidence = completeEvidence([
      record(0, "forwarded_success", "persisted"),
    ]);
    try {
      await writeEvidence(path, evidence);
      expect((await readEvidence(path)).recordId).toBe(evidence.recordId);
      expect(
        (await listEvidence(directory)).map((item) => item.recordId),
      ).toEqual([evidence.recordId]);
      await expect(writeEvidence(path, evidence)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed evidence files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blocklab-evidence-"));
    const path = join(directory, "malformed.json");
    try {
      await writeFile(path, "{malformed", "utf8");
      await expect(readEvidence(path)).rejects.toThrow(EvidenceValidationError);
      await rm(path);
      await writeFile(path, JSON.stringify({ schemaVersion: "9.0" }), "utf8");
      await expect(readEvidence(path)).rejects.toThrow(EvidenceValidationError);
      await expect(
        readEvidence(join(directory, "missing.json")),
      ).rejects.toThrow(EvidenceValidationError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
