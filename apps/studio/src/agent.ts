import type {
  AgentHealth,
  AgentInspectionResponse,
  AuthorizedProject,
  ReportDetail,
  ReportListResponse,
} from "@blocklab/core";
import {
  LOCAL_RUNTIME_PROTOCOL_VERSION,
  LOCAL_RUNTIME_SERVICE,
  ProtocolValidationError,
  parseAuthorizedProjectsResponse,
  parseInspectionResponse,
  parseLocalRuntimeHealth,
  parsePairResponse,
  parseReportDetailResponse,
  parseReportListResponse,
  parseRuntimeErrorEnvelope,
} from "@blocklab/core";

export type AgentConnectionState =
  | "disconnected"
  | "pairing"
  | "connected"
  | "expired"
  | "error";

export interface AgentState {
  readonly connection: AgentConnectionState;
  readonly endpoint: string;
  readonly health?: AgentHealth | undefined;
  readonly projects: readonly AuthorizedProject[];
  readonly selectedProjectId?: string | undefined;
  readonly inspection?: AgentInspectionResponse | undefined;
  readonly reports?: ReportListResponse | undefined;
  readonly selectedReport?: ReportDetail | undefined;
  readonly reportsLoading: boolean;
  readonly sessionAvailable: boolean;
  readonly error?: string | undefined;
}

export interface StudioAgentClient {
  readonly getState: () => AgentState;
  readonly bootstrap: (endpoint: string, token: string) => Promise<void>;
  readonly pair: (endpoint: string, code: string) => Promise<void>;
  readonly inspect: (projectId: string) => Promise<void>;
  readonly listReports: (projectId: string) => Promise<void>;
  readonly getReport: (projectId: string, executionId: string) => Promise<void>;
  readonly refreshReports: () => Promise<void>;
  readonly revoke: () => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Local Agent request failed.";
}

class AgentRequestError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  public constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
    this.code = code;
  }
}

function normalizeLoopbackEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Enter a valid Local Runtime endpoint.");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Local Runtime endpoints must use HTTP on 127.0.0.1.");
  }
  return url.origin;
}

export function createStudioAgentClient(
  fetcher: typeof fetch = fetch,
): StudioAgentClient {
  let state: AgentState = {
    connection: "disconnected",
    endpoint: "http://127.0.0.1:8787",
    projects: [],
    reportsLoading: false,
    sessionAvailable: false,
  };
  let token: string | undefined;
  let pairingInProgress = false;
  let revocationInProgress = false;
  let sessionGeneration = 0;
  let reportRequestGeneration = 0;
  let inspectionRequestGeneration = 0;
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of listeners) listener();
  };
  const update = (next: AgentState): void => {
    state = next;
    publish();
  };
  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    const response = await fetcher(`${state.endpoint}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(init.headers ?? {}),
      },
    });
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new Error("Local Runtime returned an invalid JSON response.");
    }
    if (!response.ok) {
      try {
        const errorPayload = parseRuntimeErrorEnvelope(payload);
        throw new AgentRequestError(
          errorPayload.error.message,
          response.status,
          errorPayload.error.code,
        );
      } catch (error) {
        if (error instanceof ProtocolValidationError) {
          throw new AgentRequestError(
            "The Local Runtime rejected the request.",
            response.status,
          );
        }
        throw error;
      }
    }
    return payload;
  };
  const handleFailure = (
    error: unknown,
    requestGeneration = sessionGeneration,
  ): void => {
    if (requestGeneration !== sessionGeneration) return;
    if (
      error instanceof AgentRequestError &&
      error.status === 401 &&
      (error.code === "SESSION_EXPIRED" || error.code === "UNAUTHORIZED")
    ) {
      token = undefined;
      sessionGeneration += 1;
      update({
        ...state,
        connection: "expired",
        sessionAvailable: false,
        projects: [],
        inspection: undefined,
        reports: undefined,
        selectedReport: undefined,
        reportsLoading: false,
        error: `${messageFrom(error)} Pair again with a fresh one-time code.`,
      });
      return;
    }
    update({
      ...state,
      connection: "error",
      sessionAvailable: token !== undefined,
      reportsLoading: false,
      error:
        error instanceof TypeError
          ? "The Local Agent is unavailable. Check that it is running and reconnect; if its session expired, pair again with a fresh code."
          : messageFrom(error),
    });
  };
  const authorizedProject = (projectId: string): boolean =>
    state.projects.some((project) => project.projectId === projectId);

  return {
    getState: () => state,
    async bootstrap(endpoint, bootstrapToken): Promise<void> {
      if (pairingInProgress || revocationInProgress) return;
      let normalized: string;
      try {
        normalized = normalizeLoopbackEndpoint(endpoint);
      } catch (error) {
        update({
          ...state,
          connection: "error",
          error: messageFrom(error),
        });
        return;
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(bootstrapToken)) {
        update({
          ...state,
          endpoint: normalized,
          connection: "error",
          error: "The Studio launch authorization is invalid.",
        });
        return;
      }
      pairingInProgress = true;
      update({
        ...state,
        endpoint: normalized,
        connection: "pairing",
        error: undefined,
      });
      let failureGeneration = sessionGeneration;
      try {
        const paired = parsePairResponse(
          await request("/v1/bootstrap", {
            method: "POST",
            body: JSON.stringify({
              bootstrapToken,
              protocolVersions: [LOCAL_RUNTIME_PROTOCOL_VERSION],
            }),
          }),
        );
        token = paired.accessToken;
        sessionGeneration += 1;
        failureGeneration = sessionGeneration;
        const listed = parseAuthorizedProjectsResponse(
          await request("/v1/projects"),
        );
        if (failureGeneration !== sessionGeneration) return;
        update({
          ...state,
          connection: "connected",
          sessionAvailable: true,
          health: {
            service: LOCAL_RUNTIME_SERVICE,
            protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
            agentId: paired.runtimeId,
            status: "ready",
            authorizedProjectCount: listed.projects.length,
          },
          projects: listed.projects,
          reports: undefined,
          selectedReport: undefined,
          reportsLoading: false,
          error: undefined,
        });
      } catch (error) {
        handleFailure(error, failureGeneration);
      } finally {
        pairingInProgress = false;
      }
    },
    async pair(endpoint, code): Promise<void> {
      if (pairingInProgress || revocationInProgress) return;
      let normalized: string;
      try {
        normalized = normalizeLoopbackEndpoint(endpoint);
      } catch (error) {
        update({
          ...state,
          connection: "error",
          error: messageFrom(error),
        });
        return;
      }
      if (token !== undefined && normalized !== state.endpoint) {
        update({
          ...state,
          error:
            "Disconnect the current Local Agent before changing endpoints.",
        });
        return;
      }
      pairingInProgress = true;
      let failureGeneration = sessionGeneration;
      update({
        ...state,
        endpoint: normalized,
        connection: "pairing",
        error: undefined,
      });
      try {
        if (token !== undefined) {
          failureGeneration = sessionGeneration;
          const listed = parseAuthorizedProjectsResponse(
            await request("/v1/projects"),
          );
          if (failureGeneration !== sessionGeneration) return;
          update({
            ...state,
            connection: "connected",
            sessionAvailable: true,
            projects: listed.projects,
            health: state.health
              ? {
                  ...state.health,
                  authorizedProjectCount: listed.projects.length,
                }
              : undefined,
            error: undefined,
          });
          return;
        }
        const runtimeHealth = parseLocalRuntimeHealth(
          await request("/v1/health"),
        );
        const paired = parsePairResponse(
          await request("/v1/pair", {
            method: "POST",
            body: JSON.stringify({
              pairingCode: code,
              protocolVersions: [LOCAL_RUNTIME_PROTOCOL_VERSION],
            }),
          }),
        );
        if (paired.runtimeId !== runtimeHealth.runtimeId) {
          throw new Error("Local Runtime identity changed during pairing.");
        }
        token = paired.accessToken;
        sessionGeneration += 1;
        failureGeneration = sessionGeneration;
        const listed = parseAuthorizedProjectsResponse(
          await request("/v1/projects"),
        );
        if (failureGeneration !== sessionGeneration) return;
        const health: AgentHealth = {
          service: LOCAL_RUNTIME_SERVICE,
          protocolVersion: LOCAL_RUNTIME_PROTOCOL_VERSION,
          agentId: runtimeHealth.runtimeId,
          status: "ready",
          authorizedProjectCount: listed.projects.length,
        };
        update({
          ...state,
          endpoint: normalized,
          connection: "connected",
          sessionAvailable: true,
          health,
          projects: listed.projects,
          reports: undefined,
          selectedReport: undefined,
          reportsLoading: false,
          error: undefined,
        });
      } catch (error) {
        handleFailure(error, failureGeneration);
      } finally {
        pairingInProgress = false;
      }
    },
    async inspect(projectId): Promise<void> {
      if (token === undefined) {
        update({
          ...state,
          connection: "error",
          error: "Pair with the Local Agent before inspecting a project.",
        });
        return;
      }
      if (!authorizedProject(projectId)) {
        update({
          ...state,
          error: "This project is not authorized by the Local Agent.",
        });
        return;
      }
      const requestGeneration = sessionGeneration;
      const inspectionGeneration = ++inspectionRequestGeneration;
      update({ ...state, selectedProjectId: projectId, error: undefined });
      try {
        const result = parseInspectionResponse(
          await request(
            `/v1/projects/${encodeURIComponent(projectId)}/inspect`,
            { method: "POST", body: "{}" },
          ),
        );
        if (
          requestGeneration !== sessionGeneration ||
          inspectionGeneration !== inspectionRequestGeneration
        )
          return;
        update({
          ...state,
          selectedProjectId: projectId,
          inspection: result,
          error: undefined,
        });
      } catch (error) {
        if (inspectionGeneration === inspectionRequestGeneration)
          handleFailure(error, requestGeneration);
      }
    },
    async listReports(projectId): Promise<void> {
      if (token === undefined) {
        update({
          ...state,
          connection: "error",
          error: "Pair with the Local Agent before loading reports.",
        });
        return;
      }
      if (!authorizedProject(projectId)) {
        update({
          ...state,
          error: "This project is not authorized by the Local Agent.",
        });
        return;
      }
      const requestGeneration = sessionGeneration;
      const reportGeneration = ++reportRequestGeneration;
      update({
        ...state,
        selectedProjectId: projectId,
        reports: undefined,
        selectedReport: undefined,
        reportsLoading: true,
        error: undefined,
      });
      try {
        const reports = parseReportListResponse(
          await request(
            `/v1/projects/${encodeURIComponent(projectId)}/reports`,
          ),
        );
        if (
          requestGeneration !== sessionGeneration ||
          reportGeneration !== reportRequestGeneration
        )
          return;
        update({
          ...state,
          selectedProjectId: projectId,
          reports,
          selectedReport: undefined,
          reportsLoading: false,
          error: undefined,
        });
      } catch (error) {
        if (reportGeneration === reportRequestGeneration)
          handleFailure(error, requestGeneration);
      }
    },
    async getReport(projectId, executionId): Promise<void> {
      if (token === undefined) {
        update({
          ...state,
          connection: "error",
          error: "Pair with the Local Agent before opening reports.",
        });
        return;
      }
      if (!authorizedProject(projectId)) {
        update({
          ...state,
          error: "This project is not authorized by the Local Agent.",
        });
        return;
      }
      const requestGeneration = sessionGeneration;
      const reportGeneration = ++reportRequestGeneration;
      update({ ...state, error: undefined });
      try {
        const report = parseReportDetailResponse(
          await request(
            `/v1/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(executionId)}`,
          ),
        );
        if (
          requestGeneration !== sessionGeneration ||
          reportGeneration !== reportRequestGeneration
        )
          return;
        update({
          ...state,
          selectedProjectId: projectId,
          selectedReport: report,
          error: undefined,
        });
      } catch (error) {
        if (reportGeneration === reportRequestGeneration)
          handleFailure(error, requestGeneration);
      }
    },
    async refreshReports(): Promise<void> {
      if (state.selectedProjectId !== undefined) {
        await this.listReports(state.selectedProjectId);
      }
    },
    async revoke(): Promise<void> {
      if (pairingInProgress || revocationInProgress) return;
      revocationInProgress = true;
      let revokeError: string | undefined;
      const revokeRequest =
        token === undefined
          ? undefined
          : request("/v1/session", { method: "DELETE" });
      sessionGeneration += 1;
      token = undefined;
      if (revokeRequest !== undefined) {
        try {
          await revokeRequest;
        } catch (error) {
          revokeError = `The Local Agent could not confirm session revocation: ${messageFrom(error)}`;
        }
      }
      revocationInProgress = false;
      update({
        connection: "disconnected",
        endpoint: state.endpoint,
        projects: [],
        reports: undefined,
        selectedReport: undefined,
        reportsLoading: false,
        sessionAvailable: false,
        ...(revokeError === undefined ? {} : { error: revokeError }),
      });
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
