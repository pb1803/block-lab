import { describe, expect, it } from "vitest";
import {
  isApprovedLoopbackEndpoint,
  ProtocolValidationError,
  parseAuthorizedProjectsResponse,
  parseEmptyRequest,
  parseLocalRuntimeHealth,
  parsePairRequest,
  parsePairResponse,
  parseReportCapabilities,
  parseReportDetailResponse,
  parseReportListResponse,
  parseReportSummaryResponse,
  parseRpcEndpointRegistration,
  UnsupportedProtocolVersionError,
} from "./local-runtime.js";

describe("Local Runtime protocol contracts", () => {
  it("accepts supported pairing requests and rejects unknown fields", () => {
    expect(
      parsePairRequest({
        pairingCode: "A".repeat(32),
        protocolVersions: ["1"],
      }),
    ).toEqual({
      pairingCode: "A".repeat(32),
      protocolVersions: ["1"],
    });
    expect(() =>
      parsePairRequest({
        pairingCode: "A".repeat(32),
        protocolVersions: ["1"],
        debug: true,
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("rejects unsupported protocol versions distinctly", () => {
    expect(() =>
      parsePairRequest({
        pairingCode: "A".repeat(32),
        protocolVersions: ["2"],
      }),
    ).toThrow(UnsupportedProtocolVersionError);
  });

  it("enforces string, array, object, and JSON nesting bounds", () => {
    expect(() =>
      parsePairRequest({
        pairingCode: "A".repeat(65),
        protocolVersions: ["1"],
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parsePairRequest({
        pairingCode: "A".repeat(32),
        protocolVersions: Array(9).fill("1"),
      }),
    ).toThrow(ProtocolValidationError);
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    expect(() =>
      parsePairRequest({
        pairingCode: "A".repeat(32),
        protocolVersions: ["1"],
        nested,
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("validates health and session response shapes", () => {
    expect(
      parseLocalRuntimeHealth({
        service: "blocklab-local-agent",
        runtimeId: "runtime-1",
        status: "ready",
        protocolVersions: ["1"],
      }).runtimeId,
    ).toBe("runtime-1");
    expect(() =>
      parseLocalRuntimeHealth({
        service: "blocklab-local-agent",
        runtimeId: "runtime-1",
        status: "ready",
        protocolVersions: ["1"],
        authorizedProjectCount: 0,
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parsePairResponse({
        runtimeId: "runtime-1",
        protocolVersion: "1",
        accessToken: "short",
        expiresAt: "2026-11-06T16:10:00.000Z",
        scopes: [],
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("requires empty request bodies to have no unknown fields", () => {
    expect(parseEmptyRequest({})).toEqual({});
    expect(() => parseEmptyRequest({ path: "C:\\private" })).toThrow(
      ProtocolValidationError,
    );
  });

  it("bounds and validates authorized project list payloads", () => {
    const project = {
      projectId: "local-project",
      name: "sample",
      rootIdentifier: "root-1",
      sourceType: "local",
      authorization: "explicit",
    };
    expect(
      parseAuthorizedProjectsResponse({ projects: [project] }).projects,
    ).toHaveLength(1);
    expect(() =>
      parseAuthorizedProjectsResponse({
        projects: [{ ...project, rootPath: "C:\\private" }],
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseAuthorizedProjectsResponse({ projects: Array(129).fill(project) }),
    ).toThrow(ProtocolValidationError);
  });

  it("separates endpoint registration from local approval", () => {
    const loopback = parseRpcEndpointRegistration({
      endpointId: "node-1",
      name: "Anvil",
      url: "http://127.0.0.1:8545",
    });
    const remote = parseRpcEndpointRegistration({
      endpointId: "node-2",
      name: "Remote",
      url: "https://rpc.example",
    });
    expect(loopback.registrationKind).toBe("loopback");
    expect(loopback.approval).toBe("registered");
    expect(remote.registrationKind).toBe("remote");
    expect(remote.approval).toBe("registered");
    expect(isApprovedLoopbackEndpoint(loopback)).toBe(false);
    expect(
      isApprovedLoopbackEndpoint({
        ...loopback,
        approval: "approved-loopback",
      }),
    ).toBe(true);
    expect(
      isApprovedLoopbackEndpoint({ ...remote, approval: "approved-loopback" }),
    ).toBe(false);
  });

  it("does not accept credentials or unsupported schemes in endpoint registration", () => {
    expect(() =>
      parseRpcEndpointRegistration({
        endpointId: "node-1",
        name: "Bad",
        url: "http://user:secret@127.0.0.1:8545",
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseRpcEndpointRegistration({
        endpointId: "node-1",
        name: "Bad",
        url: "file:///etc/passwd",
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("validates strict report summary, detail, listing, and capabilities schemas", () => {
    const evaluation = {
      status: "passed",
      baseline: {
        status: "passed",
        reasons: [],
        explanation: "Baseline observed.",
      },
      fault: {
        status: "passed",
        reasons: [],
        explanation: "Fault observed.",
      },
      recovery: {
        status: "passed",
        reasons: [],
        explanation: "Recovery observed.",
      },
      reasons: [],
      explanation: "Report is complete.",
      metrics: {
        totalRequests: 3,
        requestsByPhase: { baseline: 1, fault: 1, recovery: 1 },
        successfulForwardedRequests: 2,
        upstreamErrors: 0,
        injectedBlackoutFailures: 1,
        invalidRequests: 0,
        recoverySuccessCount: 1,
        injectedRequestCount: 1,
      },
      warnings: [],
    };
    const summary = {
      executionId: "execution-1",
      recordId: "record-1",
      scenarioId: "rpc-blackout",
      scenarioVersion: "1.0.0",
      terminalState: "completed",
      evaluation,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      evidenceDigest: "a".repeat(64),
      integrityStatus: "verified",
    };
    expect(parseReportSummaryResponse(summary).executionId).toBe("execution-1");
    expect(
      parseReportSummaryResponse({
        ...summary,
        evaluation: {
          ...evaluation,
          metrics: { ...evaluation.metrics, observedAdditionalLatencyMs: -1.5 },
        },
      }).evaluation.metrics.observedAdditionalLatencyMs,
    ).toBe(-1.5);
    expect(
      parseReportListResponse({
        protocolVersion: "1",
        projectId: "project-1",
        totalCount: 1,
        reports: [summary],
      }).reports,
    ).toHaveLength(1);
    expect(
      parseReportDetailResponse({
        ...summary,
        configuration: {
          startOffsetMs: 100,
          durationMs: 100,
          experimentDurationMs: 400,
        },
        observations: [
          {
            phase: "fault",
            timestamp: "2026-01-01T00:00:00.100Z",
            method: "eth_chainId",
            outcome: "injected_blackout",
            injected: true,
            latencyMs: 0,
            correlationId: "correlation-1",
          },
        ],
        diagnostics: { warnings: [], limitations: [] },
      }).observations,
    ).toHaveLength(1);
    expect(
      parseReportCapabilities({
        protocolVersion: "1",
        operations: ["reports:list", "reports:read"],
        maximumPageSize: 64,
        maximumReportResponseBytes: 1_048_576,
      }).operations,
    ).toEqual(["reports:list", "reports:read"]);
    expect(() =>
      parseReportSummaryResponse({ ...summary, executionId: "../secret" }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportSummaryResponse({ ...summary, unexpected: true }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportDetailResponse({
        ...summary,
        configuration: {
          startOffsetMs: 100,
          durationMs: 100,
          rpcUrl: "https://user:password@example.test",
        },
        observations: [],
        diagnostics: { warnings: [], limitations: [] },
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportSummaryResponse({
        ...summary,
        integrityStatus: "verified",
        evidenceDigest: undefined,
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportSummaryResponse({
        ...summary,
        integrityStatus: "missing-digest",
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportSummaryResponse({
        ...summary,
        integrityStatus: "verified",
        evidenceDigest: "bad",
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportSummaryResponse({
        ...summary,
        integrityStatus: "digest-mismatch",
        evidenceDigest: "a".repeat(64),
      }),
    ).not.toThrow();
    for (const scenarioId of [
      "rpc-blackout",
      "rpc-latency",
      "rpc-intermittent-failure",
      "rpc-rate-limit",
      "rpc-connection-failure",
      "rpc-malformed-response",
    ] as const) {
      expect(() =>
        parseReportSummaryResponse({
          ...summary,
          scenarioId,
          scenarioVersion: "1.0.0",
        }),
      ).not.toThrow();
      expect(() =>
        parseReportSummaryResponse({
          ...summary,
          scenarioId,
          scenarioVersion: "9.0.0",
        }),
      ).toThrow(ProtocolValidationError);
    }

    const observations = Array.from({ length: 512 }, (_, index) => ({
      phase: "fault",
      timestamp: "2026-01-01T00:00:00.100Z",
      method: "eth_chainId",
      outcome: "injected_blackout",
      injected: true,
      latencyMs: 0,
      correlationId: `correlation-${index}`,
    }));
    const firstObservation = observations[0];
    if (!firstObservation) throw new Error("Test fixture is empty.");
    expect(
      parseReportDetailResponse({
        ...summary,
        configuration: {
          startOffsetMs: 100,
          durationMs: 100,
          experimentDurationMs: 400,
        },
        observations,
        diagnostics: { warnings: [], limitations: [] },
      }).observations,
    ).toHaveLength(512);
    expect(() =>
      parseReportDetailResponse({
        ...summary,
        configuration: {
          startOffsetMs: 100,
          durationMs: 100,
          experimentDurationMs: 400,
        },
        observations: [...observations, firstObservation],
        diagnostics: { warnings: [], limitations: [] },
      }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseReportDetailResponse({
        ...summary,
        configuration: {
          startOffsetMs: 300,
          durationMs: 200,
          experimentDurationMs: 400,
        },
        observations: [],
        diagnostics: { warnings: [], limitations: [] },
      }),
    ).toThrow(ProtocolValidationError);
  });
});
