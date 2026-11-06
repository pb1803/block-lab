import type {
  AgentHealth,
  AgentInspectionResponse,
  AuthorizedProject,
} from "@blocklab/core";
import {
  LOCAL_RUNTIME_PROTOCOL_VERSION,
  LOCAL_RUNTIME_SERVICE,
  ProtocolValidationError,
  parseAuthorizedProjectsResponse,
  parseInspectionResponse,
  parseLocalRuntimeHealth,
  parsePairResponse,
  parseRuntimeErrorEnvelope,
} from "@blocklab/core";

export type AgentConnectionState =
  | "disconnected"
  | "pairing"
  | "connected"
  | "error";

export interface AgentState {
  readonly connection: AgentConnectionState;
  readonly endpoint: string;
  readonly health?: AgentHealth | undefined;
  readonly projects: readonly AuthorizedProject[];
  readonly selectedProjectId?: string | undefined;
  readonly inspection?: AgentInspectionResponse | undefined;
  readonly error?: string | undefined;
}

export interface StudioAgentClient {
  readonly getState: () => AgentState;
  readonly pair: (endpoint: string, code: string) => Promise<void>;
  readonly inspect: (projectId: string) => Promise<void>;
  readonly revoke: () => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
}

function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The Local Agent request failed.";
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
  };
  let token: string | undefined;
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
        throw new Error(errorPayload.error.message);
      } catch (error) {
        if (error instanceof ProtocolValidationError) {
          throw new Error("The Local Runtime rejected the request.");
        }
        throw error;
      }
    }
    return payload;
  };

  return {
    getState: () => state,
    async pair(endpoint, code): Promise<void> {
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
      token = undefined;
      update({
        ...state,
        endpoint: normalized,
        connection: "pairing",
        error: undefined,
      });
      try {
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
        const listed = parseAuthorizedProjectsResponse(
          await request("/v1/projects"),
        );
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
          health,
          projects: listed.projects,
          error: undefined,
        });
      } catch (error) {
        token = undefined;
        update({
          ...state,
          endpoint: normalized,
          connection: "error",
          error: messageFrom(error),
        });
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
      update({ ...state, selectedProjectId: projectId, error: undefined });
      try {
        const result = parseInspectionResponse(
          await request(
            `/v1/projects/${encodeURIComponent(projectId)}/inspect`,
            { method: "POST", body: "{}" },
          ),
        );
        update({
          ...state,
          selectedProjectId: projectId,
          inspection: result,
          error: undefined,
        });
      } catch (error) {
        update({ ...state, connection: "error", error: messageFrom(error) });
      }
    },
    async revoke(): Promise<void> {
      if (token !== undefined) {
        try {
          await request("/v1/session", { method: "DELETE" });
        } catch {
          // Local state is revoked even if the agent has gone offline.
        }
      }
      token = undefined;
      update({
        connection: "disconnected",
        endpoint: state.endpoint,
        projects: [],
      });
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
