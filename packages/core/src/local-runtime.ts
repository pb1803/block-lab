import type {
  AgentInspectionResponse,
  AuthorizedProject,
  DependencyEdge,
  DependencyNode,
  InspectionSummary,
  PackageManager,
} from "./index.js";

export const LOCAL_RUNTIME_PROTOCOL_VERSION = "1" as const;
export const LOCAL_RUNTIME_SERVICE = "blocklab-local-agent" as const;

const MAX_STRING_LENGTH = 4_096;
const MAX_ARRAY_LENGTH = 512;
const MAX_OBJECT_KEYS = 128;
const MAX_JSON_DEPTH = 12;

export interface LocalRuntimeHealth {
  readonly service: typeof LOCAL_RUNTIME_SERVICE;
  readonly runtimeId: string;
  readonly status: "ready";
  readonly protocolVersions: readonly string[];
}

export interface PairRequest {
  readonly pairingCode: string;
  readonly protocolVersions: readonly string[];
}

export interface PairResponse {
  readonly runtimeId: string;
  readonly protocolVersion: typeof LOCAL_RUNTIME_PROTOCOL_VERSION;
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
}

export interface AuthorizedProjectsResponse {
  readonly projects: readonly AuthorizedProject[];
}

export interface RuntimeErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly requestId: string;
  };
}

export interface RpcEndpointRegistration {
  readonly endpointId: string;
  readonly name: string;
  readonly url: string;
  readonly registrationKind: "loopback" | "remote";
  readonly approval: "registered" | "approved-loopback";
}

export class ProtocolValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

export class UnsupportedProtocolVersionError extends ProtocolValidationError {
  public constructor() {
    super("No supported Local Runtime protocol version was requested.");
    this.name = "UnsupportedProtocolVersionError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new ProtocolValidationError("Request must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ProtocolValidationError("Request contains an unknown field.");
    }
  }
}

function string(
  value: unknown,
  field: string,
  maxLength = MAX_STRING_LENGTH,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  maximum = MAX_ARRAY_LENGTH,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ProtocolValidationError(`${field} is invalid.`);
  }
  return value.map((item) => string(item, field));
}

function assertJsonBounds(
  value: unknown,
  depth = 0,
  entries = { count: 0 },
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new ProtocolValidationError("JSON nesting exceeds the limit.");
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new ProtocolValidationError("JSON string exceeds the limit.");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProtocolValidationError("JSON number is invalid.");
    }
    return;
  }
  if (value === null || typeof value === "boolean" || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new ProtocolValidationError("JSON array exceeds the limit.");
    }
    for (const item of value) assertJsonBounds(item, depth + 1, entries);
    return;
  }
  const object = record(value);
  const keys = Object.keys(object);
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new ProtocolValidationError("JSON object exceeds the limit.");
  }
  entries.count += keys.length;
  if (entries.count > MAX_ARRAY_LENGTH) {
    throw new ProtocolValidationError("JSON payload exceeds the limit.");
  }
  for (const [key, item] of Object.entries(object)) {
    if (key.length > 128) {
      throw new ProtocolValidationError("JSON field name exceeds the limit.");
    }
    assertJsonBounds(item, depth + 1, entries);
  }
}

function isPackageManager(value: unknown): value is PackageManager {
  return ["npm", "pnpm", "yarn", "bun"].includes(String(value));
}

function parseAuthorizedProject(value: unknown): AuthorizedProject {
  const project = record(value);
  strictKeys(project, [
    "projectId",
    "name",
    "rootIdentifier",
    "sourceType",
    "authorization",
  ]);
  if (project.sourceType !== "local" || project.authorization !== "explicit") {
    throw new ProtocolValidationError("Authorized project is invalid.");
  }
  return {
    projectId: string(project.projectId, "projectId", 128),
    name: string(project.name, "name", 256),
    rootIdentifier: string(project.rootIdentifier, "rootIdentifier", 128),
    sourceType: "local",
    authorization: "explicit",
  };
}

function parseDependencyNode(value: unknown): DependencyNode {
  const node = record(value);
  strictKeys(node, [
    "nodeId",
    "type",
    "name",
    "label",
    "evidenceSource",
    "evidence",
    "confidence",
    "metadata",
  ]);
  const types = [
    "application",
    "framework",
    "package-manager",
    "rpc",
    "chain",
    "contract",
    "wallet",
    "indexer",
    "unknown",
  ];
  const confidences = ["detected", "inferred", "user-declared"];
  if (
    !types.includes(String(node.type)) ||
    !confidences.includes(String(node.confidence))
  ) {
    throw new ProtocolValidationError("Inspection dependency is invalid.");
  }
  let metadata: Record<string, string> | undefined;
  if (node.metadata !== undefined) {
    const rawMetadata = record(node.metadata);
    if (Object.keys(rawMetadata).length > MAX_OBJECT_KEYS) {
      throw new ProtocolValidationError("Inspection metadata is invalid.");
    }
    metadata = {};
    for (const [key, value] of Object.entries(rawMetadata)) {
      metadata[string(key, "metadata key", 128)] = string(
        value,
        "metadata value",
      );
    }
  }
  return {
    nodeId: string(node.nodeId, "nodeId", 128),
    type: node.type as DependencyNode["type"],
    name: string(node.name, "dependency name", 256),
    label: string(node.label, "dependency label", 256),
    evidenceSource: string(node.evidenceSource, "evidence source", 256),
    evidence: string(node.evidence, "dependency evidence"),
    confidence: node.confidence as DependencyNode["confidence"],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseDependencyEdge(value: unknown): DependencyEdge {
  const edge = record(value);
  strictKeys(edge, [
    "edgeId",
    "fromNodeId",
    "toNodeId",
    "relationship",
    "evidenceSource",
    "confidence",
  ]);
  const confidences = ["detected", "inferred", "user-declared"];
  if (!confidences.includes(String(edge.confidence))) {
    throw new ProtocolValidationError("Inspection relationship is invalid.");
  }
  return {
    edgeId: string(edge.edgeId, "edgeId", 128),
    fromNodeId: string(edge.fromNodeId, "fromNodeId", 128),
    toNodeId: string(edge.toNodeId, "toNodeId", 128),
    relationship: string(edge.relationship, "relationship", 256),
    evidenceSource: string(edge.evidenceSource, "evidence source", 256),
    confidence: edge.confidence as DependencyEdge["confidence"],
  };
}

function parseInspectionSummary(value: unknown): InspectionSummary {
  const summary = record(value);
  strictKeys(summary, [
    "schemaVersion",
    "rootPath",
    "manifest",
    "packageManagers",
    "packageManagerConflict",
    "detectedStack",
    "dependencies",
    "edges",
    "chainIds",
    "networkNames",
    "rpcReferences",
    "limitations",
  ]);
  const packageManagers = stringArray(
    summary.packageManagers,
    "packageManagers",
    8,
  );
  const chainIds = summary.chainIds;
  if (
    summary.schemaVersion !== "1.0" ||
    !["present", "missing", "malformed"].includes(String(summary.manifest)) ||
    typeof summary.packageManagerConflict !== "boolean" ||
    !packageManagers.every(isPackageManager) ||
    !Array.isArray(summary.dependencies) ||
    !Array.isArray(summary.edges) ||
    !Array.isArray(chainIds) ||
    chainIds.length > MAX_ARRAY_LENGTH ||
    !chainIds.every(
      (chainId) =>
        typeof chainId === "number" &&
        Number.isSafeInteger(chainId) &&
        chainId >= 0,
    )
  ) {
    throw new ProtocolValidationError("Project inspection is invalid.");
  }
  return {
    schemaVersion: "1.0",
    rootPath: string(summary.rootPath, "rootPath", 128),
    manifest: summary.manifest as InspectionSummary["manifest"],
    packageManagers,
    packageManagerConflict: summary.packageManagerConflict,
    detectedStack: stringArray(summary.detectedStack, "detectedStack"),
    dependencies: summary.dependencies.map(parseDependencyNode),
    edges: summary.edges.map(parseDependencyEdge),
    chainIds,
    networkNames: stringArray(summary.networkNames, "networkNames"),
    rpcReferences: stringArray(summary.rpcReferences, "rpcReferences"),
    limitations: stringArray(summary.limitations, "limitations"),
  };
}

export function parseEmptyRequest(value: unknown): Record<string, never> {
  const input = record(value);
  strictKeys(input, []);
  return {};
}

export function parsePairRequest(value: unknown): PairRequest {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["pairingCode", "protocolVersions"]);
  const protocolVersions = stringArray(
    input.protocolVersions,
    "protocolVersions",
    8,
  );
  if (!protocolVersions.includes(LOCAL_RUNTIME_PROTOCOL_VERSION)) {
    throw new UnsupportedProtocolVersionError();
  }
  return {
    pairingCode: string(input.pairingCode, "pairingCode", 64),
    protocolVersions,
  };
}

export function parseLocalRuntimeHealth(value: unknown): LocalRuntimeHealth {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["service", "runtimeId", "status", "protocolVersions"]);
  if (
    input.service !== LOCAL_RUNTIME_SERVICE ||
    input.status !== "ready" ||
    !stringArray(input.protocolVersions, "protocolVersions", 8).includes(
      LOCAL_RUNTIME_PROTOCOL_VERSION,
    )
  ) {
    throw new ProtocolValidationError("Local Runtime health is invalid.");
  }
  return {
    service: LOCAL_RUNTIME_SERVICE,
    runtimeId: string(input.runtimeId, "runtimeId", 128),
    status: "ready",
    protocolVersions: input.protocolVersions as string[],
  };
}

export function parsePairResponse(value: unknown): PairResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, [
    "runtimeId",
    "protocolVersion",
    "accessToken",
    "expiresAt",
    "scopes",
  ]);
  if (input.protocolVersion !== LOCAL_RUNTIME_PROTOCOL_VERSION) {
    throw new ProtocolValidationError(
      "Local Runtime protocol version is unsupported.",
    );
  }
  const expiresAt = string(input.expiresAt, "expiresAt", 64);
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new ProtocolValidationError("Session expiry is invalid.");
  }
  const accessToken = string(input.accessToken, "accessToken", 128);
  if (!/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
    throw new ProtocolValidationError("Session token is invalid.");
  }
  return {
    runtimeId: string(input.runtimeId, "runtimeId", 128),
    protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
    accessToken,
    expiresAt,
    scopes: stringArray(input.scopes, "scopes", 32),
  };
}

export function parseAuthorizedProjectsResponse(
  value: unknown,
): AuthorizedProjectsResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["projects"]);
  if (!Array.isArray(input.projects) || input.projects.length > 128) {
    throw new ProtocolValidationError("Project list is invalid.");
  }
  return { projects: input.projects.map(parseAuthorizedProject) };
}

export function parseInspectionResponse(
  value: unknown,
): AgentInspectionResponse {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["project", "inspection", "inspectedAt"]);
  const inspectedAt = string(input.inspectedAt, "inspectedAt", 64);
  if (!Number.isFinite(Date.parse(inspectedAt))) {
    throw new ProtocolValidationError("Inspection timestamp is invalid.");
  }
  return {
    project: parseAuthorizedProject(input.project),
    inspection: parseInspectionSummary(input.inspection),
    inspectedAt,
  };
}

export function parseRuntimeErrorEnvelope(
  value: unknown,
): RuntimeErrorEnvelope {
  assertJsonBounds(value);
  const envelope = record(value);
  strictKeys(envelope, ["error"]);
  const error = record(envelope.error);
  strictKeys(error, ["code", "message", "retryable", "requestId"]);
  if (typeof error.retryable !== "boolean") {
    throw new ProtocolValidationError("Runtime error response is invalid.");
  }
  return {
    error: {
      code: string(error.code, "error code", 128),
      message: string(error.message, "error message", 512),
      retryable: error.retryable,
      requestId: string(error.requestId, "requestId", 128),
    },
  };
}

function isLoopbackAddress(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1) === "::1";
  }
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) {
    return host
      .split(".")
      .slice(1)
      .every((part) => {
        const octet = Number(part);
        return octet >= 0 && octet <= 255;
      });
  }
  return false;
}

export function parseRpcEndpointRegistration(
  value: unknown,
): RpcEndpointRegistration {
  assertJsonBounds(value);
  const input = record(value);
  strictKeys(input, ["endpointId", "name", "url"]);
  const endpointId = string(input.endpointId, "endpointId", 128);
  const name = string(input.name, "name", 256);
  const rawUrl = string(input.url, "url", 2_048);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new ProtocolValidationError("RPC endpoint URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw new ProtocolValidationError("RPC endpoint URL is invalid.");
  }
  const loopback =
    isLoopbackAddress(parsedUrl.hostname) &&
    (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:");
  return {
    endpointId,
    name,
    url: parsedUrl.toString(),
    registrationKind: loopback ? "loopback" : "remote",
    approval: "registered",
  };
}

export function isApprovedLoopbackEndpoint(
  endpoint: RpcEndpointRegistration,
): boolean {
  const parsed = new URL(endpoint.url);
  return (
    endpoint.approval === "approved-loopback" &&
    endpoint.registrationKind === "loopback" &&
    isLoopbackAddress(parsed.hostname)
  );
}
