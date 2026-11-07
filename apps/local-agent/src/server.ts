import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { isIP } from "node:net";
import { basename, join, resolve, sep } from "node:path";
import {
  LOCAL_RUNTIME_PROTOCOL_VERSION,
  LOCAL_RUNTIME_SERVICE,
  type PairRequest,
  ProtocolValidationError,
  parseBootstrapRequest,
  parseEmptyRequest,
  parsePairRequest,
  parseReportIdentifier,
  REPORT_MAX_PAGE_SIZE,
  type ReportListResponse,
  UnsupportedProtocolVersionError,
} from "@blocklab/core";
import {
  type EvidenceRecord,
  readEvidenceWithIntegrity,
  toReportDetail,
  toReportListResponse,
} from "@blocklab/evidence";
import { type InspectionSummary, inspectProject } from "@blocklab/inspector";

const PAIRING_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 10 * 60_000;
const BOOTSTRAP_TTL_MS = 5 * 60_000;
const BOOTSTRAP_MAX_EXCHANGES = 8;
const PAIRING_ATTEMPT_WINDOW_MS = 60_000;
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_BODY_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_DEADLINE_MS = 15_000;
const PAIRING_CODE_PATTERN = /^[0-9A-F]{32}$/;
const DEVELOPMENT_ORIGINS = [
  "http://127.0.0.1:5178",
  "http://localhost:5178",
] as const;
const ALLOWED_METHODS = new Set(["GET", "POST", "DELETE", "OPTIONS"]);
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);

export interface LocalAgentOptions {
  readonly projectPaths?: readonly string[];
  readonly evidenceDirectories?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly bootstrapProjectId?: string;
  readonly port?: number;
  readonly now?: () => number;
  readonly onPairingCode?: (code: string) => void;
}

export interface LocalAgentHandle {
  readonly agentId: string;
  readonly pairingCode: string;
  readonly bootstrapToken?: string;
  readonly port: number;
  readonly url: string;
  readonly revokeAll: () => void;
  readonly close: () => Promise<void>;
}

interface AuthorizedProject {
  readonly projectId: string;
  readonly name: string;
  readonly rootIdentifier: string;
  readonly rootPath: string;
  readonly evidenceDirectory: string | undefined;
}

interface Session {
  readonly expiresAt: number;
  readonly projectIds: ReadonlySet<string>;
}

interface BootstrapTicket {
  readonly expiresAt: number;
  readonly projectId: string;
  exchangesRemaining: number;
}

interface PairingAttemptBucket {
  windowStartedAt: number;
  attempts: number;
}

interface AgentState {
  readonly runtimeId: string;
  pairingCode: string;
  pairingCodeDigest: Buffer;
  pairingExpiresAt: number;
  readonly projects: readonly AuthorizedProject[];
  readonly sessions: Map<string, Session>;
  readonly bootstrapTickets: Map<string, BootstrapTicket>;
  readonly now: () => number;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly pairingAttempts: Map<string, PairingAttemptBucket>;
  readonly onPairingCode: ((code: string) => void) | undefined;
  port: number;
}

export class AgentRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(
    status: number,
    code: string,
    message: string,
    retryable = status === 429 || status >= 500,
  ) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function digestPairingCode(code: string): Buffer {
  return createHash("sha256").update(code.toUpperCase()).digest();
}

function newPairingCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

function validateOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Allowed origins must be exact HTTP or HTTPS origins.");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.origin !== value ||
    value.includes("*")
  ) {
    throw new Error("Allowed origins must be exact HTTP or HTTPS origins.");
  }
  return origin.origin;
}

function rawHeaderCount(request: IncomingMessage, name: string): number {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) count += 1;
  }
  return count;
}

function validateHeaderMultiplicity(request: IncomingMessage): void {
  for (const name of [
    "host",
    "origin",
    "authorization",
    "content-type",
    "content-length",
    "transfer-encoding",
    "access-control-request-method",
    "access-control-request-headers",
    "access-control-request-private-network",
  ]) {
    if (rawHeaderCount(request, name) > 1) {
      throw new AgentRequestError(
        400,
        "AMBIGUOUS_HEADERS",
        "Request contains ambiguous headers.",
      );
    }
  }
  if (
    request.headers["content-length"] !== undefined &&
    request.headers["transfer-encoding"] !== undefined
  ) {
    throw new AgentRequestError(
      400,
      "AMBIGUOUS_HEADERS",
      "Request contains ambiguous headers.",
    );
  }
}

function validateHost(request: IncomingMessage, state: AgentState): void {
  const expectedHost =
    state.port === 80 ? "127.0.0.1" : `127.0.0.1:${state.port}`;
  if (
    rawHeaderCount(request, "host") !== 1 ||
    request.headers.host !== expectedHost
  ) {
    throw new AgentRequestError(
      400,
      "HOST_REJECTED",
      "Request host is not allowed.",
    );
  }
}

function originOf(request: IncomingMessage): string | undefined {
  const value = request.headers.origin;
  return typeof value === "string" ? value : undefined;
}

function requireOrigin(request: IncomingMessage, state: AgentState): string {
  const origin = originOf(request);
  if (origin === undefined || !state.allowedOrigins.has(origin)) {
    throw new AgentRequestError(
      403,
      "ORIGIN_REJECTED",
      "Browser origin is not allowed.",
      false,
    );
  }
  return origin;
}

function setCorsHeaders(
  response: ServerResponse,
  origin: string | undefined,
): void {
  if (origin === undefined) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type",
  );
  response.setHeader(
    "access-control-allow-methods",
    "GET, POST, DELETE, OPTIONS",
  );
  response.setHeader("vary", "Origin");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId: string,
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  if (payload.byteLength > MAX_RESPONSE_BYTES) {
    const limited = Buffer.from(
      JSON.stringify({
        error: {
          code: "RESPONSE_TOO_LARGE",
          message: "Response exceeds the Local Runtime limit.",
          retryable: false,
          requestId,
        },
      }),
      "utf8",
    );
    response.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      connection: "close",
    });
    response.end(limited);
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": payload.byteLength,
  });
  response.end(payload);
}

function sendError(
  response: ServerResponse,
  exception: AgentRequestError,
  requestId: string,
): void {
  sendJson(
    response,
    exception.status,
    {
      error: {
        code: exception.code,
        message: exception.message,
        retryable: exception.retryable,
        requestId,
      },
    },
    requestId,
  );
}

function validateJsonContentType(
  request: IncomingMessage,
  required: boolean,
): void {
  const contentType = request.headers["content-type"];
  if (contentType === undefined && !required) return;
  if (typeof contentType !== "string") {
    throw new AgentRequestError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Request content type must be application/json.",
      false,
    );
  }
  const [mediaType, ...parameters] = contentType.split(";");
  if (
    mediaType?.trim().toLowerCase() !== "application/json" ||
    parameters.some((parameter) => !/^charset=utf-8$/i.test(parameter.trim()))
  ) {
    throw new AgentRequestError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Request content type must be application/json.",
      false,
    );
  }
}

function assertNoRequestBody(request: IncomingMessage): void {
  validateJsonContentType(request, false);
  const contentLength = request.headers["content-length"];
  if (
    request.headers["transfer-encoding"] !== undefined ||
    (contentLength !== undefined &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) !== 0))
  ) {
    request.resume();
    throw new AgentRequestError(
      400,
      "UNEXPECTED_BODY",
      "This Local Runtime request must not include a body.",
      false,
    );
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  validateJsonContentType(request, true);
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      throw new AgentRequestError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Request content length is invalid.",
        false,
      );
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      request.resume();
      throw new AgentRequestError(
        413,
        "BODY_TOO_LARGE",
        "Request body exceeds the Local Runtime limit.",
        false,
      );
    }
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new AgentRequestError(
        413,
        "BODY_TOO_LARGE",
        "Request body exceeds the Local Runtime limit.",
        false,
      );
    }
    chunks.push(data);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentRequestError(
      400,
      "INVALID_JSON",
      "Request body must be valid JSON.",
      false,
    );
  }
}

function tokenFrom(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) {
    throw new AgentRequestError(
      401,
      "UNAUTHORIZED",
      "A Local Runtime session is required.",
      false,
    );
  }
  return value.slice("Bearer ".length);
}

function sessionFrom(request: IncomingMessage, state: AgentState): Session {
  const token = tokenFrom(request);
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  const session = state.sessions.get(tokenDigest);
  if (session === undefined || session.expiresAt <= state.now()) {
    if (session !== undefined) state.sessions.delete(tokenDigest);
    throw new AgentRequestError(
      401,
      "SESSION_EXPIRED",
      "The Local Runtime session is expired or revoked.",
      false,
    );
  }
  return session;
}

function canonicalProjectId(rootPath: string): string {
  return `root-${createHash("sha256").update(rootPath).digest("hex").slice(0, 16)}`;
}

function rootIdentifier(rootPath: string): string {
  return `root-${createHash("sha256").update(rootPath).digest("hex").slice(0, 16)}`;
}

function authorizeProject(
  inputPath: string,
  configuredEvidenceDirectory: string | undefined,
): AuthorizedProject {
  const resolved = resolve(inputPath);
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
    if (!statSync(realPath).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new AgentRequestError(
      400,
      "INVALID_PROJECT",
      "The authorized project directory is not available.",
      false,
    );
  }
  const evidenceDirectory =
    configuredEvidenceDirectory === undefined
      ? undefined
      : resolve(configuredEvidenceDirectory);
  return {
    projectId: canonicalProjectId(realPath),
    name: basename(realPath),
    rootIdentifier: rootIdentifier(realPath),
    rootPath: realPath,
    evidenceDirectory,
  };
}

function insideAuthorized(rootPath: string, candidate: string): boolean {
  const root = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return candidate === rootPath || candidate.startsWith(root);
}

function projectResponse(project: AuthorizedProject): Record<string, string> {
  return {
    projectId: project.projectId,
    name: project.name,
    rootIdentifier: project.rootIdentifier,
    sourceType: "local",
    authorization: "explicit",
  };
}

function decodePathIdentifier(
  value: string | undefined,
  field: string,
): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value ?? "");
  } catch {
    throw new AgentRequestError(
      400,
      `INVALID_${field.toUpperCase()}`,
      `${field} is invalid.`,
      false,
    );
  }
  try {
    return parseReportIdentifier(decoded, field);
  } catch {
    throw new AgentRequestError(
      400,
      `INVALID_${field.toUpperCase()}`,
      `${field} is invalid.`,
      false,
    );
  }
}

function projectForRequest(
  state: AgentState,
  value: string | undefined,
): AuthorizedProject {
  const projectId = decodePathIdentifier(value, "projectId");
  const project = state.projects.find((item) => item.projectId === projectId);
  if (project === undefined) {
    throw new AgentRequestError(
      404,
      "PROJECT_NOT_FOUND",
      "Project is not authorized.",
      false,
    );
  }
  return project;
}

function projectForSession(
  state: AgentState,
  session: Session,
  value: string | undefined,
): AuthorizedProject {
  const project = projectForRequest(state, value);
  if (!session.projectIds.has(project.projectId)) {
    throw new AgentRequestError(
      403,
      "PROJECT_NOT_IN_SESSION",
      "Project is outside this Local Runtime session scope.",
      false,
    );
  }
  return project;
}

function evidenceDirectoryFor(project: AuthorizedProject): string {
  if (project.evidenceDirectory === undefined) {
    throw new AgentRequestError(
      404,
      "EVIDENCE_NOT_CONFIGURED",
      "No evidence is configured for this project.",
      false,
    );
  }
  return project.evidenceDirectory;
}

async function verifiedEvidenceInDirectory(
  project: AuthorizedProject,
): Promise<readonly EvidenceRecord[]> {
  const directory = evidenceDirectoryFor(project);
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw new AgentRequestError(
      500,
      "EVIDENCE_UNAVAILABLE",
      "Evidence could not be read.",
    );
  }
  const records: EvidenceRecord[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const result = await readEvidenceWithIntegrity(join(directory, name));
    if (result.integrity.status === "verified") {
      const evidence = result.evidence;
      if (evidence !== undefined) records.push(evidence);
    }
  }
  return records;
}

function evidenceErrorStatus(status: string): {
  readonly status: number;
  readonly code: string;
  readonly message: string;
} {
  if (status === "oversized") {
    return {
      status: 413,
      code: "EVIDENCE_TOO_LARGE",
      message: "Evidence exceeds the Local Runtime response limit.",
    };
  }
  return {
    status: 422,
    code: "EVIDENCE_INVALID",
    message: "Evidence integrity could not be verified.",
  };
}

function pairingBucket(
  state: AgentState,
  source: string,
): PairingAttemptBucket {
  const now = state.now();
  for (const [key, bucket] of state.pairingAttempts) {
    if (now - bucket.windowStartedAt >= PAIRING_ATTEMPT_WINDOW_MS) {
      state.pairingAttempts.delete(key);
    }
  }
  let bucket = state.pairingAttempts.get(source);
  if (bucket === undefined) {
    if (state.pairingAttempts.size >= 64) {
      const oldest = state.pairingAttempts.keys().next().value as
        | string
        | undefined;
      if (oldest !== undefined) state.pairingAttempts.delete(oldest);
    }
    bucket = { windowStartedAt: now, attempts: 0 };
    state.pairingAttempts.set(source, bucket);
  }
  return bucket;
}

function rejectPairing(state: AgentState, source: string): never {
  const bucket = pairingBucket(state, source);
  bucket.attempts += 1;
  if (bucket.attempts > MAX_PAIRING_ATTEMPTS) {
    throw new AgentRequestError(
      429,
      "PAIRING_THROTTLED",
      "Pairing is temporarily unavailable.",
    );
  }
  throw new AgentRequestError(
    401,
    "PAIRING_REJECTED",
    "Pairing code was rejected.",
    false,
  );
}

function assertPairingNotThrottled(
  state: AgentState,
  source: string,
): PairingAttemptBucket {
  const bucket = pairingBucket(state, source);
  if (bucket.attempts >= MAX_PAIRING_ATTEMPTS) {
    throw new AgentRequestError(
      429,
      "PAIRING_THROTTLED",
      "Pairing is temporarily unavailable.",
    );
  }
  return bucket;
}

function rotatePairingCode(state: AgentState): void {
  state.pairingCode = newPairingCode();
  state.pairingCodeDigest = digestPairingCode(state.pairingCode);
  state.pairingExpiresAt = state.now() + PAIRING_TTL_MS;
  state.pairingAttempts.clear();
  state.onPairingCode?.(state.pairingCode);
}

function assertSupportedPath(pathname: string): void {
  if (/^\/v\d+(?:\/|$)/.test(pathname) && !pathname.startsWith("/v1/")) {
    throw new AgentRequestError(
      426,
      "PROTOCOL_UNSUPPORTED",
      "This Local Runtime protocol version is not supported.",
      false,
    );
  }
  if (
    ["/health", "/pair", "/revoke", "/projects"].includes(pathname) ||
    /^\/projects\/[^/]+\/inspect$/.test(pathname)
  ) {
    throw new AgentRequestError(
      426,
      "PROTOCOL_REQUIRED",
      "Use the versioned Local Runtime API.",
      false,
    );
  }
}

function validatePreflight(request: IncomingMessage): void {
  const requestedMethod = request.headers["access-control-request-method"];
  if (
    typeof requestedMethod !== "string" ||
    !ALLOWED_METHODS.has(requestedMethod)
  ) {
    throw new AgentRequestError(
      403,
      "PREFLIGHT_REJECTED",
      "Cross-origin request is not allowed.",
      false,
    );
  }
  const requestedHeaders =
    request.headers["access-control-request-headers"] ?? "";
  if (typeof requestedHeaders !== "string") {
    throw new AgentRequestError(
      403,
      "PREFLIGHT_REJECTED",
      "Cross-origin request is not allowed.",
      false,
    );
  }
  const headers = requestedHeaders
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (headers.some((header) => !ALLOWED_HEADERS.has(header))) {
    throw new AgentRequestError(
      403,
      "PREFLIGHT_REJECTED",
      "Cross-origin request is not allowed.",
      false,
    );
  }
}

export async function createLocalAgent(
  options: LocalAgentOptions = {},
): Promise<LocalAgentHandle> {
  const now = options.now ?? Date.now;
  const origins = options.allowedOrigins ?? DEVELOPMENT_ORIGINS;
  if (origins.length === 0) {
    throw new Error("At least one exact Local Runtime origin is required.");
  }
  const allowedOrigins = new Set(origins.map(validateOrigin));
  const projectPaths = options.projectPaths ?? [];
  const evidenceDirectories = options.evidenceDirectories ?? [];
  if (
    evidenceDirectories.length !== 0 &&
    evidenceDirectories.length !== projectPaths.length
  ) {
    throw new Error(
      "Evidence directories must correspond one-to-one with project paths.",
    );
  }
  const projects = projectPaths.map((path, index) =>
    authorizeProject(path, evidenceDirectories[index]),
  );
  const bootstrapProjectId = options.bootstrapProjectId;
  const bootstrapProject =
    bootstrapProjectId === undefined
      ? undefined
      : projects.find((project) => project.projectId === bootstrapProjectId);
  if (bootstrapProjectId !== undefined && bootstrapProject === undefined) {
    throw new Error("Bootstrap project must be explicitly authorized.");
  }
  const bootstrapToken =
    bootstrapProject === undefined
      ? undefined
      : randomBytes(32).toString("base64url");
  const bootstrapTickets = new Map<string, BootstrapTicket>();
  if (bootstrapProject !== undefined && bootstrapToken !== undefined) {
    bootstrapTickets.set(
      createHash("sha256").update(bootstrapToken).digest("hex"),
      {
        expiresAt: now() + BOOTSTRAP_TTL_MS,
        projectId: bootstrapProject.projectId,
        exchangesRemaining: BOOTSTRAP_MAX_EXCHANGES,
      },
    );
  }
  const initialPairingCode = newPairingCode();
  const state: AgentState = {
    runtimeId: `runtime-${randomBytes(16).toString("hex")}`,
    pairingCode: initialPairingCode,
    pairingCodeDigest: digestPairingCode(initialPairingCode),
    pairingExpiresAt: now() + PAIRING_TTL_MS,
    projects,
    sessions: new Map(),
    bootstrapTickets,
    now,
    allowedOrigins,
    pairingAttempts: new Map(),
    onPairingCode: options.onPairingCode,
    port: options.port ?? 0,
  };

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const deadline = setTimeout(() => {
      if (!response.writableEnded) response.destroy();
    }, REQUEST_DEADLINE_MS);
    deadline.unref();
    try {
      validateHeaderMultiplicity(request);
      validateHost(request, state);
      const requestOrigin = originOf(request);
      if (
        requestOrigin !== undefined &&
        !state.allowedOrigins.has(requestOrigin)
      ) {
        throw new AgentRequestError(
          403,
          "ORIGIN_REJECTED",
          "Browser origin is not allowed.",
          false,
        );
      }
      setCorsHeaders(response, requestOrigin);
      const requestTarget = request.url ?? "";
      if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
        throw new AgentRequestError(
          400,
          "INVALID_REQUEST_TARGET",
          "Request target is invalid.",
          false,
        );
      }
      const url = new URL(requestTarget, `http://${request.headers.host}`);
      const reportListPath = /^\/v1\/projects\/[^/]+\/reports$/.test(
        url.pathname,
      );
      if ((url.search !== "" && !reportListPath) || url.hash !== "") {
        throw new AgentRequestError(
          400,
          "INVALID_REQUEST_TARGET",
          "Request target is invalid.",
          false,
        );
      }
      assertSupportedPath(url.pathname);
      if (
        request.method !== "POST" ||
        (url.pathname !== "/v1/pair" &&
          url.pathname !== "/v1/bootstrap" &&
          !/^\/v1\/projects\/[^/]+\/inspect$/.test(url.pathname))
      ) {
        assertNoRequestBody(request);
      }
      if (request.method === "OPTIONS") {
        requireOrigin(request, state);
        validatePreflight(request);
        response.setHeader("access-control-max-age", "600");
        if (
          request.headers["access-control-request-private-network"] === "true"
        ) {
          response.setHeader("access-control-allow-private-network", "true");
        }
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      requireOrigin(request, state);

      if (request.method === "GET" && url.pathname === "/v1/health") {
        sendJson(
          response,
          200,
          {
            service: LOCAL_RUNTIME_SERVICE,
            runtimeId: state.runtimeId,
            status: "ready",
            protocolVersions: [LOCAL_RUNTIME_PROTOCOL_VERSION],
          },
          requestId,
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/bootstrap") {
        let bootstrapRequest: ReturnType<typeof parseBootstrapRequest>;
        try {
          bootstrapRequest = parseBootstrapRequest(await readJsonBody(request));
        } catch (exception) {
          if (exception instanceof UnsupportedProtocolVersionError) {
            throw new AgentRequestError(
              426,
              "PROTOCOL_UNSUPPORTED",
              "No supported Local Runtime protocol version was requested.",
              false,
            );
          }
          throw exception;
        }
        const digest = createHash("sha256")
          .update(bootstrapRequest.bootstrapToken)
          .digest("hex");
        const ticket = state.bootstrapTickets.get(digest);
        if (ticket === undefined || ticket.expiresAt <= state.now()) {
          if (ticket !== undefined) state.bootstrapTickets.delete(digest);
          throw new AgentRequestError(
            401,
            "BOOTSTRAP_EXPIRED",
            "The Studio launch authorization expired. Start a new report handoff.",
            false,
          );
        }
        if (ticket.exchangesRemaining <= 0) {
          state.bootstrapTickets.delete(digest);
          throw new AgentRequestError(
            401,
            "BOOTSTRAP_EXHAUSTED",
            "The Studio launch authorization has already been used.",
            false,
          );
        }
        const project = state.projects.find(
          (item) => item.projectId === ticket.projectId,
        );
        if (project === undefined) {
          state.bootstrapTickets.delete(digest);
          throw new AgentRequestError(
            403,
            "PROJECT_NOT_FOUND",
            "The launch project is no longer authorized.",
            false,
          );
        }
        ticket.exchangesRemaining -= 1;
        const token = randomBytes(32).toString("base64url");
        const expiresAt = state.now() + SESSION_TTL_MS;
        state.sessions.set(createHash("sha256").update(token).digest("hex"), {
          expiresAt,
          projectIds: new Set([project.projectId]),
        });
        sendJson(
          response,
          200,
          {
            runtimeId: state.runtimeId,
            protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
            accessToken: token,
            expiresAt: new Date(expiresAt).toISOString(),
            scopes: [
              "projects:read",
              "projects:inspect",
              "reports:list",
              "reports:read",
            ],
          },
          requestId,
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pair") {
        const bucket = assertPairingNotThrottled(
          state,
          request.socket.remoteAddress ?? "unknown",
        );
        let pairRequest: PairRequest;
        try {
          pairRequest = parsePairRequest(await readJsonBody(request));
        } catch (exception) {
          if (exception instanceof UnsupportedProtocolVersionError) {
            throw new AgentRequestError(
              426,
              "PROTOCOL_UNSUPPORTED",
              "No supported Local Runtime protocol version was requested.",
              false,
            );
          }
          if (exception instanceof ProtocolValidationError) {
            rejectPairing(state, request.socket.remoteAddress ?? "unknown");
          }
          throw exception;
        }
        const submittedDigest = digestPairingCode(pairRequest.pairingCode);
        const codeMatches =
          timingSafeEqual(submittedDigest, state.pairingCodeDigest) &&
          PAIRING_CODE_PATTERN.test(pairRequest.pairingCode.toUpperCase());
        if (!codeMatches || state.pairingExpiresAt <= state.now()) {
          rejectPairing(state, request.socket.remoteAddress ?? "unknown");
        }

        bucket.attempts = 0;
        for (const [digest, session] of state.sessions) {
          if (session.expiresAt <= state.now()) state.sessions.delete(digest);
        }
        const token = randomBytes(32).toString("base64url");
        const expiresAt = state.now() + SESSION_TTL_MS;
        state.sessions.set(createHash("sha256").update(token).digest("hex"), {
          expiresAt,
          projectIds: new Set(
            state.projects.map((project) => project.projectId),
          ),
        });
        sendJson(
          response,
          200,
          {
            runtimeId: state.runtimeId,
            protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
            accessToken: token,
            expiresAt: new Date(expiresAt).toISOString(),
            scopes: [
              "projects:read",
              "projects:inspect",
              "reports:list",
              "reports:read",
            ],
          },
          requestId,
        );
        rotatePairingCode(state);
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/v1/session") {
        sessionFrom(request, state);
        state.sessions.delete(
          createHash("sha256").update(tokenFrom(request)).digest("hex"),
        );
        sendJson(response, 200, { revoked: true }, requestId);
        return;
      }

      const session = sessionFrom(request, state);
      if (request.method === "GET" && reportListPath) {
        const project = projectForSession(
          state,
          session,
          url.pathname.match(/^\/v1\/projects\/([^/]+)\/reports$/)?.[1],
        );
        const unknownParameters = [...url.searchParams.keys()].filter(
          (key) => key !== "cursor" && key !== "limit",
        );
        if (unknownParameters.length > 0) {
          throw new AgentRequestError(
            400,
            "INVALID_REQUEST_TARGET",
            "Report pagination parameters are invalid.",
            false,
          );
        }
        const cursorValues = url.searchParams.getAll("cursor");
        const limitValues = url.searchParams.getAll("limit");
        if (cursorValues.length > 1 || limitValues.length > 1) {
          throw new AgentRequestError(
            400,
            "INVALID_REQUEST_TARGET",
            "Report pagination parameters are invalid.",
            false,
          );
        }
        const cursor = cursorValues[0] ?? "0";
        const limitText = limitValues[0] ?? String(REPORT_MAX_PAGE_SIZE);
        if (!/^(?:0|[1-9]\d*)$/.test(cursor) || !/^\d+$/.test(limitText)) {
          throw new AgentRequestError(
            400,
            "INVALID_REQUEST_TARGET",
            "Report pagination parameters are invalid.",
            false,
          );
        }
        const offset = Number(cursor);
        const limit = Number(limitText);
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > REPORT_MAX_PAGE_SIZE
        ) {
          throw new AgentRequestError(
            400,
            "INVALID_REQUEST_TARGET",
            "Report pagination parameters are invalid.",
            false,
          );
        }
        const records = await verifiedEvidenceInDirectory(project);
        const page = records.slice(offset, offset + limit);
        let body: ReportListResponse;
        try {
          body = toReportListResponse(
            project.projectId,
            page,
            offset + page.length < records.length
              ? String(offset + page.length)
              : undefined,
            records.length,
          );
        } catch {
          throw new AgentRequestError(
            413,
            "REPORT_TOO_LARGE",
            "The report response exceeds the Local Runtime limit.",
            false,
          );
        }
        sendJson(response, 200, body, requestId);
        return;
      }

      const reportDetailMatch = url.pathname.match(
        /^\/v1\/projects\/([^/]+)\/reports\/([^/]+)$/,
      );
      if (request.method === "GET" && reportDetailMatch !== null) {
        const project = projectForSession(state, session, reportDetailMatch[1]);
        const executionId = decodePathIdentifier(
          reportDetailMatch[2],
          "executionId",
        );
        const directory = evidenceDirectoryFor(project);
        const candidate = resolve(directory, `${executionId}.json`);
        if (!insideAuthorized(resolve(directory), candidate)) {
          throw new AgentRequestError(
            400,
            "INVALID_EXECUTION_ID",
            "executionId is invalid.",
            false,
          );
        }
        try {
          if (!statSync(candidate).isFile()) throw new Error("not a file");
        } catch {
          throw new AgentRequestError(
            404,
            "REPORT_NOT_FOUND",
            "Report was not found.",
            false,
          );
        }
        const result = await readEvidenceWithIntegrity(candidate);
        if (result.integrity.status !== "verified") {
          const failure = evidenceErrorStatus(result.integrity.status);
          throw new AgentRequestError(
            failure.status,
            failure.code,
            failure.message,
            false,
          );
        }
        const evidence = result.evidence;
        if (evidence === undefined || evidence.executionId !== executionId) {
          throw new AgentRequestError(
            404,
            "REPORT_NOT_FOUND",
            "Report was not found.",
            false,
          );
        }
        let detail: ReturnType<typeof toReportDetail>;
        try {
          detail = toReportDetail(evidence);
        } catch {
          throw new AgentRequestError(
            413,
            "REPORT_TOO_LARGE",
            "The report response exceeds the Local Runtime limit.",
            false,
          );
        }
        sendJson(response, 200, detail, requestId);
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/projects") {
        sendJson(
          response,
          200,
          {
            projects: state.projects
              .filter((project) => session.projectIds.has(project.projectId))
              .map(projectResponse),
          },
          requestId,
        );
        return;
      }

      const match = url.pathname.match(/^\/v1\/projects\/([^/]+)\/inspect$/);
      if (request.method === "POST" && match !== null) {
        parseEmptyRequest(await readJsonBody(request));
        let decodedProjectId: string;
        try {
          decodedProjectId = decodeURIComponent(match[1] ?? "");
        } catch {
          throw new AgentRequestError(
            400,
            "INVALID_PROJECT_ID",
            "Project identifier is invalid.",
            false,
          );
        }
        const project = projectForSession(state, session, decodedProjectId);
        const inspected: InspectionSummary = inspectProject(project.rootPath);
        sendJson(
          response,
          200,
          {
            project: projectResponse(project),
            inspection: { ...inspected, rootPath: project.rootIdentifier },
            inspectedAt: new Date(state.now()).toISOString(),
          },
          requestId,
        );
        return;
      }

      if (
        url.pathname === "/v1/health" ||
        url.pathname === "/v1/pair" ||
        url.pathname === "/v1/bootstrap" ||
        url.pathname === "/v1/session" ||
        url.pathname === "/v1/projects"
      ) {
        throw new AgentRequestError(
          405,
          "METHOD_NOT_ALLOWED",
          "HTTP method is not allowed for this endpoint.",
          false,
        );
      }
      if (/^\/v1\/projects\/[^/]+\/inspect$/.test(url.pathname)) {
        throw new AgentRequestError(
          405,
          "METHOD_NOT_ALLOWED",
          "HTTP method is not allowed for this endpoint.",
          false,
        );
      }
      if (/^\/v1\/projects\/[^/]+\/reports(?:\/[^/]+)?$/.test(url.pathname)) {
        throw new AgentRequestError(
          405,
          "METHOD_NOT_ALLOWED",
          "HTTP method is not allowed for this endpoint.",
          false,
        );
      }
      throw new AgentRequestError(
        404,
        "NOT_FOUND",
        "Local Runtime endpoint was not found.",
        false,
      );
    } catch (exception) {
      const safeError =
        exception instanceof AgentRequestError
          ? exception
          : exception instanceof ProtocolValidationError
            ? new AgentRequestError(
                400,
                "INVALID_REQUEST",
                exception.message,
                false,
              )
            : new AgentRequestError(
                500,
                "RUNTIME_ERROR",
                "The Local Runtime could not complete the request.",
              );
      if (!response.headersSent && !response.destroyed) {
        sendError(response, safeError, requestId);
      } else if (!response.destroyed) {
        response.destroy();
      }
    } finally {
      clearTimeout(deadline);
    }
  });

  server.requestTimeout = REQUEST_DEADLINE_MS;
  server.headersTimeout = REQUEST_DEADLINE_MS;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.setTimeout(REQUEST_DEADLINE_MS, (socket) => socket.destroy());

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (
    address === null ||
    typeof address === "string" ||
    isIP(address.address) !== 4 ||
    address.address !== "127.0.0.1"
  ) {
    await new Promise<void>((resolveClose) =>
      server.close(() => resolveClose()),
    );
    throw new Error("Local Runtime failed to bind to 127.0.0.1.");
  }
  state.port = address.port;
  return {
    get agentId() {
      return state.runtimeId;
    },
    get pairingCode() {
      return state.pairingCode;
    },
    ...(bootstrapToken === undefined ? {} : { bootstrapToken }),
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    revokeAll: () => {
      state.sessions.clear();
      state.bootstrapTickets.clear();
    },
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((closeError) =>
          closeError ? reject(closeError) : resolveClose(),
        ),
      ),
  };
}

export function pathIsWithinAuthorizedRoot(
  rootPath: string,
  candidatePath: string,
): boolean {
  return insideAuthorized(resolve(rootPath), resolve(candidatePath));
}

export function projectIdForPath(inputPath: string): string {
  const resolved = resolve(inputPath);
  return canonicalProjectId(realpathSync(resolved));
}
