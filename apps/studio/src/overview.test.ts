import type { AgentHealth, AuthorizedProject } from "@blocklab/core";
import { describe, expect, it } from "vitest";
import type { AgentState } from "./agent.js";
import { initialState } from "./arkiv/types.js";
import { createOverviewModel } from "./overview.js";

const health: AgentHealth = {
  service: "blocklab-local-agent",
  protocolVersion: "1",
  agentId: "agent-local-01",
  status: "ready",
  authorizedProjectCount: 1,
};

const project: AuthorizedProject = {
  projectId: "project-1",
  name: "sample-dapp",
  rootIdentifier: "root-a1",
  sourceType: "local",
  authorization: "explicit",
};

function agentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    connection: "disconnected",
    endpoint: "http://127.0.0.1:8787",
    projects: [],
    ...overrides,
  };
}

describe("Studio Overview model", () => {
  it("reports the connected Agent identity, protocol, and actual project count", () => {
    const model = createOverviewModel(
      agentState({
        connection: "connected",
        health,
        projects: [project],
      }),
    );

    expect(model.connection).toMatchObject({
      state: "connected",
      label: "Connected",
      tone: "success",
      health,
      projectCount: 1,
      projectsAreStale: false,
    });
    expect(model.projects).toEqual([
      {
        projectId: "project-1",
        name: "sample-dapp",
        rootIdentifier: "root-a1",
      },
    ]);
  });

  it("communicates disconnected state and does not invent connection details", () => {
    const model = createOverviewModel(agentState());

    expect(model.connection.state).toBe("disconnected");
    expect(model.connection.label).toBe("Disconnected");
    expect(model.connection.health).toBeUndefined();
    expect(model.projectsState).toBe("disconnected");
  });

  it("reports pairing as an in-progress connection state", () => {
    const model = createOverviewModel(agentState({ connection: "pairing" }));

    expect(model.connection.label).toBe("Pairing in progress");
    expect(model.connection.tone).toBe("info");
  });

  it("marks retained project and health information stale after a connection error", () => {
    const model = createOverviewModel(
      agentState({
        connection: "error",
        error: "Agent became unavailable.",
        health,
        projects: [project],
      }),
    );

    expect(model.connection.projectsAreStale).toBe(true);
    expect(model.connection.health).toEqual(health);
    expect(model.projectsState).toBe("disconnected");
  });

  it("includes the project's last successful inspection when available", () => {
    const inspection = {
      project,
      inspectedAt: "2026-11-06T15:00:00.000Z",
      inspection: {
        schemaVersion: "1.0" as const,
        rootPath: "root-a1",
        manifest: "present" as const,
        packageManagers: ["pnpm" as const],
        packageManagerConflict: false,
        detectedStack: ["Vite", "TypeScript"],
        dependencies: [],
        edges: [],
        chainIds: [31337],
        networkNames: ["Anvil"],
        rpcReferences: [],
        limitations: [],
      },
    };
    const model = createOverviewModel(
      agentState({
        connection: "connected",
        projects: [project],
        inspection,
        selectedProjectId: project.projectId,
      }),
    );

    expect(model.projects[0]?.inspection).toEqual(inspection);
  });

  it("surfaces Agent operation errors while retaining the last known project", () => {
    const model = createOverviewModel(
      agentState({
        connection: "error",
        selectedProjectId: project.projectId,
        error: "Inspection timed out.",
        projects: [project],
      }),
    );

    expect(model.connection.error).toBe("Inspection timed out.");
    expect(model.projects[0]?.projectId).toBe(project.projectId);
  });

  it("shows a real empty-project state for a connected Agent", () => {
    const model = createOverviewModel(
      agentState({
        connection: "connected",
        health: { ...health, authorizedProjectCount: 0 },
        projects: [],
      }),
    );

    expect(model.projectsState).toBe("empty");
    expect(model.projects).toEqual([]);
    expect(model.connection.projectCount).toBe(0);
  });

  it("handles absent optional health and inspection information", () => {
    const model = createOverviewModel(
      agentState({ connection: "connected", projects: [project] }),
    );

    expect(model.connection.health).toBeUndefined();
    expect(model.projects[0]?.inspection).toBeUndefined();
  });

  it("separates CLI scenarios from Studio capabilities and unavailable workflows", () => {
    const model = createOverviewModel(agentState());

    expect(model.scenarios.map((scenario) => scenario.scenarioId)).toHaveLength(
      6,
    );
    expect(
      model.scenarios.every((scenario) => scenario.status === "supported"),
    ).toBe(true);
    expect(model.studioCapabilities.join(" ")).toContain("Local Agent");
    expect(model.plannedInStudio).toContain("Experiment execution");
    expect(model.plannedInStudio).toContain("RPC inspection");
  });

  it("does not claim experiment activity without an execution or evidence source", () => {
    const model = createOverviewModel(agentState());

    expect(model.experimentActivity.available).toBe(false);
    expect(model.experimentActivity.explanation).toContain(
      "does not execute experiments",
    );
    expect(model.experimentActivity.explanation).toContain("verified reports");
    expect("runs" in model.experimentActivity).toBe(false);
  });

  it("summarizes only queried Arkiv data and omits the section without a source", () => {
    const state = initialState();
    state.history = {
      phase: "ok",
      query: { field: "scenarioName", value: "RPC blackout" },
      records: [
        {
          entityKey: `0x${"a".repeat(64)}`,
          experimentId: "run-1",
          scenarioName: "RPC blackout",
          status: "passed",
          startedAtMs: 1_798_000_000_000,
        },
      ],
      error: undefined,
    };
    const model = createOverviewModel(agentState(), state);

    expect(model.arkiv).toMatchObject({
      walletStatus: "missing",
      historyPhase: "ok",
      historyCount: 1,
      historyQuery: "scenarioName: RPC blackout",
    });
    expect(createOverviewModel(agentState()).arkiv).toBeUndefined();
  });

  it("limits quick actions to supported Projects and Evidence Vault routes", () => {
    const disconnected = createOverviewModel(agentState());
    const connected = createOverviewModel(
      agentState({ connection: "connected", projects: [project] }),
    );

    expect(disconnected.quickActions.map((action) => action.route)).toEqual([
      "projects",
      "evidence-vault",
    ]);
    expect(connected.quickActions[0]?.label).toBe("View authorized projects");
  });
});
