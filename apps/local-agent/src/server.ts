import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, resolve, sep } from "node:path";
import { type InspectionSummary, inspectProject } from "@blocklab/inspector";

const PROTOCOL_VERSION = "1" as const;
const PAIRING_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;
const MAX_BODY_BYTES = 16_384;

export interface LocalAgentOptions {
  readonly projectPaths?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly port?: number;
  readonly now?: () => number;
}

export interface LocalAgentHandle {
  readonly agentId: string;
  readonly pairingCode: string;
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
}

interface Session {
  readonly token: string;
  readonly expiresAt: number;
}

interface AgentState {
  readonly agentId: string;
  readonly pairingCode: string;
  readonly pairingExpiresAt: number;
  readonly projects: readonly AuthorizedProject[];
  readonly sessions: Map<string, Session>;
  readonly now: () => number;
  readonly allowedOrigins: ReadonlySet<string>;
}

export class AgentRequestError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
    this.code = code;
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  const configuredOrigin = response.getHeader("access-control-allow-origin");
  const allowOrigin =
    typeof configuredOrigin === "string" ? configuredOrigin : "";
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  response.end(payload);
}

function error(response: ServerResponse, exception: AgentRequestError): void {
  json(response, exception.status, {
    error: { code: exception.code, message: exception.message },
  });
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
    );
  }
  return origin;
}

function tokenFrom(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) {
    throw new AgentRequestError(
      401,
      "UNAUTHORIZED",
      "A session token is required.",
    );
  }
  return value.slice("Bearer ".length);
}

function sessionFrom(request: IncomingMessage, state: AgentState): Session {
  const token = tokenFrom(request);
  const session = state.sessions.get(token);
  if (session === undefined || session.expiresAt <= state.now()) {
    state.sessions.delete(token);
    throw new AgentRequestError(
      401,
      "SESSION_EXPIRED",
      "The agent session is expired or revoked.",
    );
  }
  return session;
}

function projectId(): string {
  return `local-${randomBytes(8).toString("hex")}`;
}

function rootIdentifier(rootPath: string): string {
  return `root-${createHash("sha256").update(rootPath).digest("hex").slice(0, 16)}`;
}

function authorizeProject(inputPath: string): AuthorizedProject {
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
    );
  }
  return {
    projectId: projectId(),
    name: basename(realPath),
    rootIdentifier: rootIdentifier(realPath),
    rootPath: realPath,
  };
}

function insideAuthorized(rootPath: string, candidate: string): boolean {
  const root = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return candidate === rootPath || candidate.startsWith(root);
}

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_BODY_BYTES) {
      throw new AgentRequestError(
        413,
        "BODY_TOO_LARGE",
        "Request body exceeds the agent limit.",
      );
    }
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AgentRequestError(
      400,
      "INVALID_JSON",
      "Request body must be valid JSON.",
    );
  }
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

export async function createLocalAgent(
  options: LocalAgentOptions = {},
): Promise<LocalAgentHandle> {
  const now = options.now ?? Date.now;
  const projects = (options.projectPaths ?? []).map(authorizeProject);
  const state: AgentState = {
    agentId: `agent-${randomBytes(8).toString("hex")}`,
    pairingCode: randomBytes(5).toString("hex").toUpperCase(),
    pairingExpiresAt: now() + PAIRING_TTL_MS,
    projects,
    sessions: new Map(),
    now,
    allowedOrigins: new Set(
      options.allowedOrigins ?? [
        "http://127.0.0.1:5178",
        "http://localhost:5178",
      ],
    ),
  };
  const server = createServer(async (request, response) => {
    try {
      const requestOrigin = originOf(request);
      if (
        requestOrigin !== undefined &&
        !state.allowedOrigins.has(requestOrigin)
      ) {
        throw new AgentRequestError(
          403,
          "ORIGIN_REJECTED",
          "Browser origin is not allowed.",
        );
      }
      if (requestOrigin !== undefined) {
        response.setHeader("access-control-allow-origin", requestOrigin);
        response.setHeader("vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        requireOrigin(request, state);
        response.writeHead(204, {
          "access-control-allow-origin": requestOrigin,
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        });
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          service: "blocklab-local-agent",
          protocolVersion: PROTOCOL_VERSION,
          agentId: state.agentId,
          status: "ready",
          authorizedProjectCount: state.projects.length,
        });
        return;
      }
      requireOrigin(request, state);
      if (request.method === "POST" && url.pathname === "/pair") {
        const input = (await body(request)) as { readonly code?: unknown };
        if (
          typeof input.code !== "string" ||
          input.code.length !== state.pairingCode.length
        ) {
          throw new AgentRequestError(
            401,
            "PAIRING_REJECTED",
            "Pairing code was rejected.",
          );
        }
        const expected = Buffer.from(state.pairingCode);
        const received = Buffer.from(input.code.toUpperCase());
        if (
          expected.length !== received.length ||
          !timingSafeEqual(expected, received) ||
          state.pairingExpiresAt <= state.now()
        ) {
          throw new AgentRequestError(
            401,
            "PAIRING_REJECTED",
            "Pairing code was rejected or expired.",
          );
        }
        const token = randomBytes(32).toString("base64url");
        state.sessions.set(token, {
          token,
          expiresAt: state.now() + SESSION_TTL_MS,
        });
        json(response, 200, {
          protocolVersion: PROTOCOL_VERSION,
          agentId: state.agentId,
          expiresAt: new Date(state.now() + SESSION_TTL_MS).toISOString(),
          token,
        });
        return;
      }
      const session = sessionFrom(request, state);
      if (request.method === "POST" && url.pathname === "/revoke") {
        state.sessions.delete(session.token);
        json(response, 200, { revoked: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/projects") {
        json(response, 200, { projects: state.projects.map(projectResponse) });
        return;
      }
      const match = url.pathname.match(/^\/projects\/([^/]+)\/inspect$/);
      if (request.method === "POST" && match !== null) {
        const project = state.projects.find(
          (item) => item.projectId === match[1],
        );
        if (project === undefined)
          throw new AgentRequestError(
            404,
            "PROJECT_NOT_FOUND",
            "Project is not authorized.",
          );
        const inspected: InspectionSummary = inspectProject(project.rootPath);
        json(response, 200, {
          project: projectResponse(project),
          inspection: { ...inspected, rootPath: project.rootIdentifier },
          inspectedAt: new Date(state.now()).toISOString(),
        });
        return;
      }
      throw new AgentRequestError(
        404,
        "NOT_FOUND",
        "Agent endpoint was not found.",
      );
    } catch (exception) {
      error(
        response,
        exception instanceof AgentRequestError
          ? exception
          : new AgentRequestError(
              500,
              "AGENT_ERROR",
              "The agent could not complete the request.",
            ),
      );
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Could not start the local agent.");
  return {
    agentId: state.agentId,
    pairingCode: state.pairingCode,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    revokeAll: () => state.sessions.clear(),
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
