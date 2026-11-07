import type { AgentHealth, AgentInspectionResponse } from "@blocklab/core";
import {
  rpcBlackoutScenario,
  rpcConnectionFailureScenario,
  rpcIntermittentFailureScenario,
  rpcLatencyScenario,
  rpcMalformedResponseScenario,
  rpcRateLimitScenario,
} from "@blocklab/scenarios/registry";
import type { AgentState } from "./agent.js";
import type { StudioArkivState } from "./arkiv/types.js";
import type { StudioRoute } from "./shell.js";

const cliScenarios = [
  rpcBlackoutScenario,
  rpcLatencyScenario,
  rpcIntermittentFailureScenario,
  rpcRateLimitScenario,
  rpcConnectionFailureScenario,
  rpcMalformedResponseScenario,
] as const;

export interface OverviewProject {
  readonly projectId: string;
  readonly name: string;
  readonly rootIdentifier: string;
  readonly inspection?: AgentInspectionResponse;
}

export interface OverviewModel {
  readonly connection: {
    readonly state: AgentState["connection"] | "unavailable";
    readonly label: string;
    readonly tone: "success" | "warning" | "error" | "info";
    readonly endpoint?: string;
    readonly error?: string;
    readonly health?: AgentHealth;
    readonly projectCount: number;
    readonly projectsAreStale: boolean;
  };
  readonly projects: readonly OverviewProject[];
  readonly projectsState: "connected" | "disconnected" | "empty";
  readonly scenarios: typeof cliScenarios;
  readonly studioCapabilities: readonly string[];
  readonly plannedInStudio: readonly string[];
  readonly experimentActivity: {
    readonly available: false;
    readonly explanation: string;
  };
  readonly quickActions: readonly {
    readonly route: StudioRoute;
    readonly label: string;
  }[];
  readonly arkiv?: {
    readonly walletStatus: StudioArkivState["wallet"]["status"];
    readonly historyPhase: StudioArkivState["history"]["phase"];
    readonly historyCount: number;
    readonly historyQuery?: string;
    readonly historyError?: string;
  };
}

function agentStatus(state: AgentState["connection"] | undefined) {
  switch (state) {
    case "connected":
      return { label: "Connected", tone: "success" as const };
    case "pairing":
      return { label: "Pairing in progress", tone: "info" as const };
    case "error":
      return { label: "Connection error", tone: "error" as const };
    default:
      return { label: "Disconnected", tone: "warning" as const };
  }
}

export function createOverviewModel(
  agent: AgentState | undefined,
  arkiv?: StudioArkivState,
): OverviewModel {
  const connection = agentStatus(agent?.connection);
  const projectsAreStale =
    agent !== undefined &&
    agent.connection !== "connected" &&
    agent.projects.length > 0;
  const inspectedProjectId = agent?.inspection?.project.projectId;
  const projects = (agent?.projects ?? []).map((project) => ({
    projectId: project.projectId,
    name: project.name,
    rootIdentifier: project.rootIdentifier,
    ...(inspectedProjectId === project.projectId && agent?.inspection
      ? { inspection: agent.inspection }
      : {}),
  }));
  const projectsState =
    agent?.connection === "connected"
      ? projects.length === 0
        ? "empty"
        : "connected"
      : "disconnected";
  const arkivHistoryQuery = arkiv?.history.query;

  return {
    connection: {
      state: agent?.connection ?? "unavailable",
      ...connection,
      ...(agent?.endpoint ? { endpoint: agent.endpoint } : {}),
      ...(agent?.error ? { error: agent.error } : {}),
      ...(agent?.health ? { health: agent.health } : {}),
      projectCount:
        agent?.health?.authorizedProjectCount ?? agent?.projects.length ?? 0,
      projectsAreStale,
    },
    projects,
    projectsState,
    scenarios: cliScenarios,
    studioCapabilities: [
      "Pair with the Local Agent and inspect explicitly authorized projects.",
      "Read verified experiment reports and their local evidence.",
      "Query Arkiv experiment metadata through the Evidence Vault.",
      "Compare validated local metadata with a retrieved Arkiv record.",
    ],
    plannedInStudio: [
      "Experiment execution",
      "RPC inspection",
      "Attack Lab workflows",
    ],
    experimentActivity: {
      available: false,
      explanation:
        "Studio does not execute experiments or aggregate recent-run charts. Pair the Local Agent and open Experiments to inspect verified reports and their local observations.",
    },
    quickActions: [
      {
        route: "projects",
        label:
          agent?.connection === "connected"
            ? "View authorized projects"
            : "Connect or inspect a project",
      },
      { route: "evidence-vault", label: "Open Evidence Vault" },
    ],
    ...(arkiv
      ? {
          arkiv: {
            walletStatus: arkiv.wallet.status,
            historyPhase: arkiv.history.phase,
            historyCount:
              arkiv.history.phase === "ok" || arkiv.history.phase === "empty"
                ? arkiv.history.records.length
                : 0,
            ...(arkivHistoryQuery
              ? {
                  historyQuery: `${arkivHistoryQuery.field}: ${arkivHistoryQuery.value}`,
                }
              : {}),
            ...(arkiv.history.error
              ? { historyError: arkiv.history.error.message }
              : {}),
          },
        }
      : {}),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function statusBadge(
  doc: Document,
  label: string,
  tone: OverviewModel["connection"]["tone"],
): HTMLElement {
  const status = element(doc, "span", `status status-${tone}`);
  status.setAttribute("role", "status");
  const dot = element(doc, "span", "status-dot");
  dot.setAttribute("aria-hidden", "true");
  const text = element(doc, "span", "status-label");
  text.textContent = label;
  status.append(dot, text);
  return status;
}

function sectionCard(
  doc: Document,
  titleText: string,
  className: string,
): { section: HTMLElement; body: HTMLElement } {
  const section = element(doc, "section", `dashboard-card ${className}`);
  const heading = element(doc, "div", "dashboard-card-heading");
  const title = element(doc, "h3");
  title.textContent = titleText;
  heading.append(title);
  const body = element(doc, "div", "dashboard-card-body");
  section.append(heading, body);
  return { section, body };
}

function addDetail(
  doc: Document,
  list: HTMLElement,
  labelText: string,
  valueText: string,
): void {
  const item = element(doc, "div", "dashboard-detail");
  const label = element(doc, "dt");
  label.textContent = labelText;
  const value = element(doc, "dd");
  value.textContent = valueText;
  item.append(label, value);
  list.append(item);
}

function createRouteLink(
  doc: Document,
  route: StudioRoute,
  label: string,
  className = "button button-secondary",
): HTMLAnchorElement {
  const link = element(doc, "a", className);
  link.href = `#/${route}`;
  link.textContent = label;
  return link;
}

function renderConnection(doc: Document, model: OverviewModel): HTMLElement {
  const { section, body } = sectionCard(
    doc,
    "Local Agent runtime",
    "runtime-card",
  );
  const overview = element(doc, "div", "runtime-overview");
  overview.append(
    statusBadge(
      doc,
      `Local Agent ${model.connection.label.toLowerCase()}`,
      model.connection.tone,
    ),
  );
  const explanation = element(doc, "p", "muted");
  explanation.textContent =
    model.connection.state === "connected"
      ? "The Studio is paired with the local project-inspection service. This status does not indicate Ethereum RPC health."
      : model.connection.state === "pairing"
        ? "Pairing is in progress. Agent identity and authorized project details will appear when the connection is ready."
        : model.connection.state === "error"
          ? "The Local Agent connection needs attention. Review the error and reconnect from Projects."
          : "No Local Agent session is connected. Start the agent and pair it from Projects to inspect an explicitly authorized project.";
  overview.append(explanation);
  body.append(overview);

  if (model.connection.health) {
    const details = element(doc, "dl", "dashboard-details");
    const isCurrent = model.connection.state === "connected";
    addDetail(
      doc,
      details,
      isCurrent ? "Agent ID" : "Last known agent ID",
      model.connection.health.agentId,
    );
    addDetail(
      doc,
      details,
      "Protocol",
      model.connection.health.protocolVersion,
    );
    addDetail(
      doc,
      details,
      isCurrent ? "Authorized projects" : "Last reported projects",
      String(model.connection.health.authorizedProjectCount),
    );
    body.append(details);
  }
  if (model.connection.endpoint) {
    const endpoint = element(doc, "p", "runtime-endpoint");
    const label = element(doc, "span", "muted");
    label.textContent = "Agent endpoint";
    const value = element(doc, "code");
    value.textContent = model.connection.endpoint;
    endpoint.append(label, value);
    body.append(endpoint);
  }
  if (model.connection.error) {
    const error = element(doc, "p", "dashboard-error");
    error.setAttribute("role", "alert");
    error.textContent = model.connection.error;
    body.append(error);
  }
  body.append(
    createRouteLink(
      doc,
      "projects",
      model.connection.state === "connected"
        ? "Manage projects"
        : "Connect Local Agent",
    ),
  );
  return section;
}

function renderInspection(
  doc: Document,
  project: OverviewProject,
): HTMLElement | undefined {
  const inspection = project.inspection;
  if (!inspection) return undefined;
  const details = element(doc, "div", "overview-inspection");
  const inspectedAt = element(doc, "p", "inspection-time");
  const timestamp = new Date(inspection.inspectedAt);
  inspectedAt.textContent = Number.isNaN(timestamp.getTime())
    ? `Inspection timestamp: ${inspection.inspectedAt}`
    : `Last successful inspection: ${timestamp.toLocaleString()}`;
  details.append(inspectedAt);
  const summary = element(doc, "ul", "inspection-summary");
  const values = [
    ["Detected stack", inspection.inspection.detectedStack.join(", ")],
    ["Package managers", inspection.inspection.packageManagers.join(", ")],
    ["Chains", inspection.inspection.chainIds.join(", ")],
    ["Networks", inspection.inspection.networkNames.join(", ")],
  ] as const;
  for (const [label, rawValue] of values) {
    const item = element(doc, "li");
    const labelNode = element(doc, "span", "muted");
    labelNode.textContent = label;
    const value = element(doc, "strong");
    value.textContent = rawValue || "None detected";
    item.append(labelNode, value);
    summary.append(item);
  }
  if (inspection.inspection.limitations.length > 0) {
    const limitations = element(doc, "p", "inspection-limitations-copy");
    limitations.textContent = `${inspection.inspection.limitations.length} inspection warning${inspection.inspection.limitations.length === 1 ? "" : "s"}; review details in Projects.`;
    details.append(limitations);
  }
  details.append(summary);
  return details;
}

function renderProjects(doc: Document, model: OverviewModel): HTMLElement {
  const { section, body } = sectionCard(
    doc,
    "Workspace & projects",
    "workspace-card",
  );
  const lead = element(doc, "p", "muted");
  if (model.connection.projectsAreStale) {
    lead.textContent =
      "Showing the last known authorized project list; the Local Agent is not currently connected.";
  } else if (model.projectsState === "connected") {
    lead.textContent = `${model.projects.length} authorized local project${model.projects.length === 1 ? "" : "s"} available for inspection.`;
  } else if (model.projectsState === "empty") {
    lead.textContent =
      "The Local Agent is connected, but no project has been explicitly authorized yet.";
  } else {
    lead.textContent =
      "Project details are available after pairing with the Local Agent.";
  }
  body.append(lead);

  if (model.projects.length > 0) {
    const list = element(doc, "div", "overview-project-list");
    for (const project of model.projects) {
      const card = element(doc, "article", "overview-project");
      const heading = element(doc, "div", "overview-project-heading");
      const name = element(doc, "h4");
      name.textContent = project.name || "Unnamed project";
      const authorization = statusBadge(
        doc,
        "Explicitly authorized",
        "success",
      );
      heading.append(name, authorization);
      const root = element(doc, "code", "project-root");
      root.textContent = project.rootIdentifier || "Project path unavailable";
      card.append(heading, root);
      const inspection = renderInspection(doc, project);
      if (inspection) card.append(inspection);
      if (
        model.connection.state === "connected" &&
        !model.connection.projectsAreStale
      ) {
        const inspect = element(doc, "button", "button button-secondary");
        inspect.type = "button";
        inspect.dataset.agentAction = "inspect";
        inspect.dataset.projectId = project.projectId;
        inspect.textContent = inspection ? "Inspect again" : "Inspect project";
        card.append(inspect);
      }
      list.append(card);
    }
    body.append(list);
  } else {
    const empty = element(doc, "p", "dashboard-empty");
    empty.textContent =
      model.projectsState === "empty"
        ? "Authorize a project explicitly in Projects to make it available for inspection."
        : "No project data is available while the Local Agent is disconnected.";
    body.append(empty);
  }
  body.append(createRouteLink(doc, "projects", "Open Projects"));
  return section;
}

function renderCapabilities(doc: Document, model: OverviewModel): HTMLElement {
  const { section, body } = sectionCard(
    doc,
    "Platform capabilities",
    "capabilities-card",
  );
  const columns = element(doc, "div", "capability-columns");
  const cli = element(doc, "div", "capability-group");
  const cliTitle = element(doc, "h4");
  cliTitle.textContent = "Available through the local CLI";
  const cliDescription = element(doc, "p", "muted");
  cliDescription.textContent =
    "Six supported local RPC fault scenarios. Run experiments only through the CLI; Studio cannot launch them.";
  const scenarioList = element(doc, "ul", "scenario-list");
  for (const scenario of model.scenarios) {
    const item = element(doc, "li");
    const name = element(doc, "strong");
    name.textContent = scenario.name;
    const description = element(doc, "span", "muted");
    description.textContent = scenario.description;
    item.append(name, description);
    scenarioList.append(item);
  }
  cli.append(cliTitle, cliDescription, scenarioList);

  const studio = element(doc, "div", "capability-group");
  const studioTitle = element(doc, "h4");
  studioTitle.textContent = "Available in this Studio";
  const studioList = element(doc, "ul", "capability-list");
  for (const capability of model.studioCapabilities) {
    const item = element(doc, "li");
    item.textContent = capability;
    studioList.append(item);
  }
  const plannedTitle = element(doc, "h4");
  plannedTitle.textContent = "Planned, not implemented in Studio";
  const planned = element(doc, "p", "muted");
  planned.textContent = model.plannedInStudio.join(", ");
  studio.append(studioTitle, studioList, plannedTitle, planned);
  columns.append(cli, studio);
  body.append(columns);
  return section;
}

function renderActivity(doc: Document, model: OverviewModel): HTMLElement {
  const { section, body } = sectionCard(
    doc,
    "Experiment activity",
    "activity-card",
  );
  const unavailable = element(doc, "div", "unavailable-state");
  const title = element(doc, "h4");
  title.textContent = "Recent activity summaries are not available";
  const explanation = element(doc, "p", "muted");
  explanation.textContent = model.experimentActivity.explanation;
  const boundary = element(doc, "p", "muted");
  boundary.textContent =
    "Arkiv stores validated metadata only; it is not a substitute for complete local experiment evidence.";
  const reports = element(doc, "a", "button button-secondary");
  reports.href = "#/experiments";
  reports.textContent = "Browse verified reports";
  unavailable.append(title, explanation, boundary, reports);
  body.append(unavailable);
  return section;
}

function renderArkiv(
  doc: Document,
  model: OverviewModel,
): HTMLElement | undefined {
  const arkiv = model.arkiv;
  if (!arkiv) return undefined;
  const { section, body } = sectionCard(doc, "Evidence & Arkiv", "arkiv-card");
  const wallet = element(doc, "p", "dashboard-detail-copy");
  wallet.textContent = `Wallet status: ${arkiv.walletStatus.replace("-", " ")}. Wallet actions remain explicit and are available in Evidence Vault.`;
  body.append(wallet);
  const history = element(doc, "div", "arkiv-history-summary");
  const title = element(doc, "h4");
  title.textContent = "Arkiv history";
  const summary = element(doc, "p", "muted");
  if (arkiv.historyPhase === "ok" || arkiv.historyPhase === "empty") {
    summary.textContent = `${arkiv.historyCount} matching metadata record${arkiv.historyCount === 1 ? "" : "s"} in the latest query.`;
  } else if (arkiv.historyPhase === "searching") {
    summary.textContent = "Arkiv history query is in progress.";
  } else if (arkiv.historyPhase === "failed") {
    summary.textContent =
      arkiv.historyError ?? "The latest Arkiv history query failed.";
    summary.setAttribute("role", "alert");
  } else {
    summary.textContent =
      "No Arkiv history query has been run in this Studio session.";
  }
  history.append(title, summary);
  if (arkiv.historyQuery) {
    const query = element(doc, "p", "arkiv-query");
    query.textContent = `Latest query: ${arkiv.historyQuery}`;
    history.append(query);
  }
  const note = element(doc, "p", "muted");
  note.textContent =
    "Arkiv records contain validated metadata, not full local evidence or experiment traces.";
  body.append(
    history,
    note,
    createRouteLink(doc, "evidence-vault", "Open Evidence Vault"),
  );
  return section;
}

export function renderOverviewDashboard(
  doc: Document,
  model: OverviewModel,
): HTMLElement {
  const dashboard = element(doc, "div", "overview-dashboard");
  const intro = element(doc, "section", "dashboard-intro");
  const eyebrow = element(doc, "p", "eyebrow");
  eyebrow.textContent = "WORKSPACE SNAPSHOT";
  const title = element(doc, "h2");
  title.textContent = "Infrastructure, grounded in your workspace.";
  const description = element(doc, "p", "lead");
  description.textContent =
    "A current view of your Local Agent connection, authorized projects, and the workflows available today.";
  intro.append(eyebrow, title, description);

  const grid = element(doc, "div", "dashboard-grid");
  grid.append(
    renderConnection(doc, model),
    renderProjects(doc, model),
    renderActivity(doc, model),
    renderCapabilities(doc, model),
  );
  const arkiv = renderArkiv(doc, model);
  if (arkiv) grid.append(arkiv);

  const actions = element(doc, "section", "dashboard-quick-actions");
  const actionTitle = element(doc, "h3");
  actionTitle.textContent = "Next steps";
  const actionLinks = element(doc, "div", "overview-actions");
  model.quickActions.forEach((action, index) => {
    actionLinks.append(
      createRouteLink(
        doc,
        action.route,
        action.label,
        index === 0 ? "button button-primary" : "button button-secondary",
      ),
    );
  });
  actions.append(actionTitle, actionLinks);
  dashboard.append(intro, grid, actions);
  return dashboard;
}
