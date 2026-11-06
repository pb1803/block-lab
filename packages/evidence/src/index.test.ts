import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareEvidence,
  createRpcBlackoutEvidence,
  createRpcConnectionFailureEvidence,
  createRpcIntermittentFailureEvidence,
  createRpcLatencyEvidence,
  createRpcMalformedResponseEvidence,
  createRpcRateLimitEvidence,
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceObservation,
  type EvidenceRecord,
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

function attackRecord(
  scenarioId: string,
  offset: number,
  outcome: EvidenceObservation["outcome"],
  correlationId: string,
  injected = false,
): {
  readonly executionId: string;
  readonly scenarioId: string;
  readonly timestamp: string;
  readonly requestTimestamp: string;
  readonly method: string;
  readonly outcome: EvidenceObservation["outcome"];
  readonly injected: boolean;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly errorCategory?: string;
} {
  const timestamp = new Date(Date.parse(startedAt) + offset).toISOString();
  return {
    executionId: "attack-execution",
    scenarioId,
    timestamp,
    requestTimestamp: timestamp,
    method: "eth_chainId",
    outcome,
    injected,
    latencyMs: offset % 31,
    correlationId,
    ...(injected ? { errorCategory: "injected_fault" } : {}),
  };
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

describe("ATTACK-02 through ATTACK-05 evidence", () => {
  const attackEvidence = (): EvidenceRecord[] => [
    createRpcIntermittentFailureEvidence(
      {
        executionId: "intermittent",
        state: "completed",
        startedAt,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        startOffsetMs: 100,
        failureDurationMs: 50,
        recoveryIntervalMs: 50,
        windowCount: 2,
        experimentDurationMs: 300,
      },
      [
        attackRecord(
          "rpc-intermittent-failure",
          0,
          "forwarded_success",
          "intermittent-baseline",
        ),
        attackRecord(
          "rpc-intermittent-failure",
          100,
          "injected_failure",
          "intermittent-fault-1",
          true,
        ),
        attackRecord(
          "rpc-intermittent-failure",
          150,
          "forwarded_success",
          "intermittent-recovery-1",
        ),
        attackRecord(
          "rpc-intermittent-failure",
          200,
          "injected_failure",
          "intermittent-fault-2",
          true,
        ),
        attackRecord(
          "rpc-intermittent-failure",
          250,
          "forwarded_success",
          "intermittent-recovery-2",
        ),
      ],
    ),
    createRpcRateLimitEvidence(
      {
        executionId: "rate-limit",
        state: "completed",
        startedAt,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      { maxRequests: 2, windowMs: 250, experimentDurationMs: 500 },
      [
        attackRecord(
          "rpc-rate-limit",
          0,
          "forwarded_success",
          "rate-baseline-1",
        ),
        attackRecord(
          "rpc-rate-limit",
          10,
          "forwarded_success",
          "rate-baseline-2",
        ),
        attackRecord("rpc-rate-limit", 20, "rate_limited", "rate-fault", true),
        attackRecord(
          "rpc-rate-limit",
          300,
          "forwarded_success",
          "rate-recovery",
        ),
      ],
    ),
    createRpcConnectionFailureEvidence(
      {
        executionId: "connection-failure",
        state: "completed",
        startedAt,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        faultMode: "connection-reset",
        startOffsetMs: 100,
        durationMs: 100,
        experimentDurationMs: 300,
      },
      [
        attackRecord(
          "rpc-connection-failure",
          0,
          "forwarded_success",
          "connection-baseline",
        ),
        attackRecord(
          "rpc-connection-failure",
          100,
          "injected_connection_failure",
          "connection-fault",
          true,
        ),
        attackRecord(
          "rpc-connection-failure",
          200,
          "forwarded_success",
          "connection-recovery",
        ),
      ],
    ),
    createRpcMalformedResponseEvidence(
      {
        executionId: "malformed-response",
        state: "completed",
        startedAt,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        faultMode: "mismatched-id",
        startOffsetMs: 100,
        durationMs: 100,
        experimentDurationMs: 300,
      },
      [
        attackRecord(
          "rpc-malformed-response",
          0,
          "forwarded_success",
          "malformed-baseline",
        ),
        attackRecord(
          "rpc-malformed-response",
          100,
          "injected_malformed_response",
          "malformed-fault",
          true,
        ),
        attackRecord(
          "rpc-malformed-response",
          200,
          "forwarded_success",
          "malformed-recovery",
        ),
      ],
    ),
  ];

  it("creates and validates scenario-specific evidence, outcomes, phases, and metrics", () => {
    const records = attackEvidence();
    expect(records.map((evidence) => evidence.scenarioId)).toEqual([
      "rpc-intermittent-failure",
      "rpc-rate-limit",
      "rpc-connection-failure",
      "rpc-malformed-response",
    ]);
    for (const evidence of records) {
      expect(evidence.scenarioVersion).toBe("1.0.0");
      expect(() => validateEvidence(evidence)).not.toThrow();
      expect(evidence.evaluation.status).toBe("passed");
      expect(evidence.evaluation.metrics).toMatchObject({
        totalRequests: evidence.observations.length,
        successfulForwardedRequests: expect.any(Number),
        injectedRequestCount: evidence.observations.filter(
          (observation) => observation.injected,
        ).length,
        upstreamErrors: 0,
        injectedBlackoutFailures: 0,
        recoverySuccessCount: expect.any(Number),
      });
      expect(evidence.observations.some((item) => item.phase === "fault")).toBe(
        true,
      );
      expect(
        evidence.observations.some((item) => item.phase === "recovery"),
      ).toBe(true);
    }
    expect(records[0]?.evaluation.metrics.injectedRequestCount).toBe(2);
    expect(records[0]?.observations.map((item) => item.phase)).toEqual([
      "baseline",
      "fault",
      "recovery",
      "fault",
      "recovery",
    ]);
    expect(records[1]?.observations.map((item) => item.phase)).toEqual([
      "baseline",
      "baseline",
      "fault",
      "recovery",
    ]);
  });

  it("rejects invalid scenario versions and invalid attack configurations", () => {
    const [intermittent, rateLimit, connectionFailure, malformedResponse] =
      attackEvidence();
    for (const evidence of [
      intermittent,
      rateLimit,
      connectionFailure,
      malformedResponse,
    ]) {
      expect(() =>
        validateEvidence({ ...evidence, scenarioVersion: "9.0.0" }),
      ).toThrow(EvidenceValidationError);
    }
    expect(() =>
      createRpcIntermittentFailureEvidence(
        { executionId: "invalid", state: "completed" },
        {
          startOffsetMs: 100,
          failureDurationMs: 50,
          recoveryIntervalMs: 50,
          windowCount: 2,
          experimentDurationMs: 249,
        },
        [],
      ),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      createRpcRateLimitEvidence(
        { executionId: "invalid", state: "completed" },
        { maxRequests: 0, windowMs: 250 },
        [],
      ),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      createRpcConnectionFailureEvidence(
        { executionId: "invalid", state: "completed" },
        {
          faultMode: "reset" as never,
          startOffsetMs: 0,
          durationMs: 100,
        },
        [],
      ),
    ).toThrow(EvidenceValidationError);
    expect(() =>
      createRpcMalformedResponseEvidence(
        { executionId: "invalid", state: "completed" },
        {
          faultMode: "unknown" as never,
          startOffsetMs: 0,
          durationMs: 100,
        },
        [],
      ),
    ).toThrow(EvidenceValidationError);
    expect(intermittent?.scenarioId).toBe("rpc-intermittent-failure");
    expect(rateLimit?.scenarioId).toBe("rpc-rate-limit");
    expect(connectionFailure?.scenarioId).toBe("rpc-connection-failure");
    expect(malformedResponse?.scenarioId).toBe("rpc-malformed-response");
  });

  it("round-trips every attack through persistence, replay, and comparison", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blocklab-attacks-"));
    try {
      const original = attackEvidence();
      for (const evidence of original) {
        const path = join(directory, `${evidence.executionId}.json`);
        await writeEvidence(path, evidence);
        const loaded = await readEvidence(path);
        expect(loaded).toEqual(evidence);
        const replay = replayConfiguration(toReplayConfiguration(loaded));
        expect(replay.scenarioId).toBe(evidence.scenarioId);
        expect(replay.scenarioVersion).toBe(evidence.scenarioVersion);
        expect(replay.configuration).toEqual(evidence.configuration);
      }
      const first = original[0];
      const second = original[1];
      if (first === undefined || second === undefined) {
        throw new Error("Attack evidence fixtures were not created.");
      }
      expect(compareEvidence(first, first).comparable).toBe(true);
      expect(compareEvidence(first, second).comparable).toBe(false);
      if (second.scenarioId !== "rpc-rate-limit") {
        throw new Error("Rate-limit evidence fixture was not created.");
      }
      const changedRetryPolicy = {
        ...second,
        configuration: {
          ...second.configuration,
          retryAfterSeconds: 3,
        },
      };
      expect(compareEvidence(second, changedRetryPolicy).comparable).toBe(
        false,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("distinguishes injected transport faults from observed upstream failures", () => {
    const evidence = createRpcConnectionFailureEvidence(
      {
        executionId: "connection-outcomes",
        state: "completed",
        startedAt,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        faultMode: "connection-reset",
        startOffsetMs: 100,
        durationMs: 100,
        experimentDurationMs: 300,
      },
      [
        attackRecord(
          "rpc-connection-failure",
          0,
          "forwarded_success",
          "outcome-baseline",
        ),
        attackRecord(
          "rpc-connection-failure",
          100,
          "injected_connection_failure",
          "outcome-injected",
          true,
        ),
        attackRecord(
          "rpc-connection-failure",
          200,
          "upstream_unavailable",
          "outcome-upstream",
        ),
      ],
    );
    expect(
      evidence.observations.map((observation) => observation.outcome),
    ).toEqual([
      "forwarded_success",
      "injected_connection_failure",
      "upstream_unavailable",
    ]);
    expect(evidence.evaluation.metrics).toMatchObject({
      injectedRequestCount: 1,
      injectedBlackoutFailures: 0,
      upstreamErrors: 1,
      successfulForwardedRequests: 1,
      recoverySuccessCount: 0,
    });
    expect(evidence.evaluation.fault.status).toBe("passed");
    expect(evidence.evaluation.recovery.status).toBe("failed");
    expect(evidence.evaluation.status).toBe("failed");
  });

  it("keeps empty and interrupted scenario evidence honest", () => {
    const partial = createRpcConnectionFailureEvidence(
      { executionId: "partial", state: "cancelled", startedAt },
      {
        faultMode: "premature-close",
        startOffsetMs: 100,
        durationMs: 100,
        experimentDurationMs: 300,
      },
      [],
    );
    expect(partial.observations).toHaveLength(0);
    expect(partial.evaluation.status).toBe("inconclusive");
    expect(partial.evaluation.metrics.averageLatencyMs).toBeUndefined();
    expect(partial.evaluation.reasons).toContain("execution_not_completed");
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
