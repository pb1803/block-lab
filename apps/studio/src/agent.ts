import type {
  AgentHealth,
  AgentInspectionResponse,
  AuthorizedProject,
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
  const request = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const response = await fetcher(`${state.endpoint}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = (await response.json()) as
      | T
      | { error?: { message?: string } };
    if (!response.ok) {
      const errorPayload = payload as { error?: { message?: string } };
      throw new Error(
        errorPayload.error?.message ?? "The Local Agent rejected the request.",
      );
    }
    return payload as T;
  };

  return {
    getState: () => state,
    async pair(endpoint, code): Promise<void> {
      const normalized = endpoint.replace(/\/+$/, "");
      update({
        ...state,
        endpoint: normalized,
        connection: "pairing",
        error: undefined,
      });
      try {
        const health = await request<AgentHealth>("/health");
        const paired = await request<{ token: string }>("/pair", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        token = paired.token;
        const listed = await request<{
          projects: readonly AuthorizedProject[];
        }>("/projects");
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
        const result = await request<AgentInspectionResponse>(
          `/projects/${encodeURIComponent(projectId)}/inspect`,
          { method: "POST" },
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
          await request("/revoke", { method: "POST" });
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
