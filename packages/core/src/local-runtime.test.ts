import { describe, expect, it } from "vitest";
import {
  isApprovedLoopbackEndpoint,
  ProtocolValidationError,
  parseAuthorizedProjectsResponse,
  parseEmptyRequest,
  parseLocalRuntimeHealth,
  parsePairRequest,
  parsePairResponse,
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
});
