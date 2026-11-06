import type {
  AgentInspectionResponse,
  AuthorizedProject,
} from "@blocklab/core";
import type { AgentConnectionState, StudioAgentClient } from "./agent.js";
import type { StudioArkivState } from "./arkiv/types.js";
import { createOverviewModel, renderOverviewDashboard } from "./overview.js";
import {
  createThemeController,
  type ThemeController,
  type ThemeMode,
} from "./theme.js";

export type StudioRoute =
  | "overview"
  | "projects"
  | "attack-lab"
  | "experiments"
  | "network-intelligence"
  | "evidence-vault"
  | "settings";

export interface StudioNavigationItem {
  readonly route: StudioRoute;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly icon: keyof typeof NAVIGATION_ICONS;
}

const NAVIGATION_ICONS = {
  overview: [
    {
      tag: "rect",
      attributes: { x: "3", y: "3", width: "8", height: "8", rx: "1" },
    },
    {
      tag: "rect",
      attributes: { x: "13", y: "3", width: "8", height: "5", rx: "1" },
    },
    {
      tag: "rect",
      attributes: { x: "13", y: "10", width: "8", height: "11", rx: "1" },
    },
    {
      tag: "rect",
      attributes: { x: "3", y: "13", width: "8", height: "8", rx: "1" },
    },
  ],
  projects: [
    {
      tag: "rect",
      attributes: { x: "3", y: "3", width: "18", height: "18", rx: "2" },
    },
    { tag: "path", attributes: { d: "M9 3v18M9 9h12" } },
  ],
  "attack-lab": [
    {
      tag: "path",
      attributes: { d: "M12 3 4 7v5c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V7l-8-4Z" },
    },
    { tag: "path", attributes: { d: "m9 12 2 2 4-4" } },
  ],
  experiments: [
    { tag: "path", attributes: { d: "M4 19V5m0 14h17" } },
    { tag: "path", attributes: { d: "m7 15 4-4 3 2 6-7" } },
  ],
  "network-intelligence": [
    { tag: "circle", attributes: { cx: "12", cy: "12", r: "9" } },
    {
      tag: "path",
      attributes: { d: "M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" },
    },
  ],
  "evidence-vault": [
    { tag: "path", attributes: { d: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" } },
  ],
  settings: [
    { tag: "circle", attributes: { cx: "12", cy: "12", r: "3" } },
    {
      tag: "path",
      attributes: {
        d: "m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z",
      },
    },
  ],
} as const;

export const studioNavigation: readonly StudioNavigationItem[] = [
  {
    route: "overview",
    label: "Overview",
    shortLabel: "Overview",
    description:
      "Review the Local Agent connection, authorized projects, and available workflows.",
    icon: "overview",
  },
  {
    route: "projects",
    label: "Projects",
    shortLabel: "Projects",
    description: "Inspect a project and review its detected boundaries.",
    icon: "projects",
  },
  {
    route: "attack-lab",
    label: "Attack Lab",
    shortLabel: "Attack Lab",
    description: "Review verified scenarios and their safety scope.",
    icon: "attack-lab",
  },
  {
    route: "experiments",
    label: "Experiments",
    shortLabel: "Experiments",
    description: "Review runs, timelines, evidence, and recovery.",
    icon: "experiments",
  },
  {
    route: "network-intelligence",
    label: "Network Intelligence",
    shortLabel: "Network",
    description: "Compare read-only RPC routes and their limitations.",
    icon: "network-intelligence",
  },
  {
    route: "evidence-vault",
    label: "Evidence Vault",
    shortLabel: "Evidence",
    description: "Search local evidence and optional Arkiv metadata.",
    icon: "evidence-vault",
  },
  {
    route: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Review integrations and local permissions.",
    icon: "settings",
  },
];

export interface StudioShellMount {
  readonly content: HTMLElement;
  readonly history: HTMLElement;
  readonly compare: HTMLElement;
  readonly setRoute: (route: StudioRoute) => void;
  readonly getRoute: () => StudioRoute;
  readonly setArkivState: (state: StudioArkivState) => void;
  readonly unmount: () => void;
}

export interface StudioShellOptions {
  readonly agent?: StudioAgentClient;
  readonly theme?: ThemeController;
}

export interface AgentStatusPresentation {
  readonly label: string;
  readonly tone: "success" | "warning" | "error" | "info";
}

export function agentStatusPresentation(
  connection: AgentConnectionState | undefined,
): AgentStatusPresentation {
  switch (connection) {
    case "connected":
      return { label: "Local Agent connected", tone: "success" };
    case "pairing":
      return { label: "Connecting to Local Agent", tone: "info" };
    case "error":
      return { label: "Local Agent connection error", tone: "error" };
    default:
      return { label: "Local Agent disconnected", tone: "warning" };
  }
}

export function routeFromHash(hash: string): StudioRoute {
  const value = hash.replace(/^#\/?/, "").split("/")[0];
  return studioNavigation.some((item) => item.route === value)
    ? (value as StudioRoute)
    : "overview";
}

export function hashForRoute(route: StudioRoute): string {
  return `#/${route}`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className !== undefined) element.className = className;
  return element;
}

function createIcon(
  doc: Document,
  iconName: StudioNavigationItem["icon"],
  className: string,
): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(className);
  for (const shape of NAVIGATION_ICONS[iconName]) {
    const element = doc.createElementNS(
      "http://www.w3.org/2000/svg",
      shape.tag,
    );
    for (const [name, value] of Object.entries(shape.attributes)) {
      element.setAttribute(name, value);
    }
    svg.append(element);
  }
  return svg;
}

function createStatus(
  doc: Document,
  label: string,
  tone: AgentStatusPresentation["tone"],
): HTMLElement {
  const status = createElement(doc, "span", `status status-${tone}`);
  status.setAttribute("role", "status");
  const dot = createElement(doc, "span", "status-dot");
  dot.setAttribute("aria-hidden", "true");
  const text = createElement(doc, "span", "status-label");
  text.textContent = label;
  status.append(dot, text);
  return status;
}

function updateStatus(
  status: HTMLElement,
  presentation: AgentStatusPresentation,
): void {
  for (const tone of ["success", "warning", "error", "info"]) {
    status.classList.remove(`status-${tone}`);
  }
  status.classList.add(`status-${presentation.tone}`);
  const label = status.querySelector<HTMLElement>(".status-label");
  if (label !== null) label.textContent = presentation.label;
}

function renderPageState(
  doc: Document,
  route: StudioRoute,
  connection: AgentConnectionState | undefined,
): HTMLElement {
  const item = studioNavigation.find((entry) => entry.route === route);
  if (item === undefined) throw new Error(`Unknown Studio route: ${route}`);

  const section = createElement(doc, "section", "page-state");
  section.setAttribute("aria-labelledby", "page-state-title");
  const eyebrow = createElement(doc, "p", "eyebrow");
  eyebrow.textContent = "WORKSPACE SURFACE";
  const title = createElement(doc, "h2");
  title.id = "page-state-title";
  title.textContent = item.label;
  const description = createElement(doc, "p", "page-state-description");
  description.textContent = item.description;
  const status = agentStatusPresentation(connection);
  const badge = createStatus(doc, status.label, status.tone);
  const note = createElement(doc, "p", "page-state-note");
  note.textContent =
    route === "settings"
      ? "Pair with the Local Agent and manage explicitly authorized projects from Projects. This surface does not expose additional local process or filesystem controls."
      : "This workflow is not implemented yet. BLOCKLAB will keep it unavailable until its safety boundary and evidence contract are ready.";
  section.append(eyebrow, title, description, badge, note);
  return section;
}

function renderProjects(
  doc: Document,
  agent: StudioAgentClient | undefined,
): HTMLElement {
  const section = createElement(doc, "section", "projects-page");
  section.setAttribute("aria-labelledby", "projects-title");
  const state = agent?.getState();
  const heading = createElement(doc, "div", "page-heading");
  const eyebrow = createElement(doc, "p", "eyebrow");
  eyebrow.textContent = "PROJECT ONBOARDING";
  const title = createElement(doc, "h2");
  title.id = "projects-title";
  title.textContent = "Connect a project you can inspect.";
  const description = createElement(doc, "p", "page-lead");
  description.textContent =
    "The Local Agent reads manifests and configuration only. It never runs project scripts, installs dependencies, or returns environment-file contents.";
  heading.append(eyebrow, title, description);
  section.append(heading);

  const connection = createElement(doc, "div", "agent-card panel");
  const connectionTitle = createElement(doc, "h3");
  connectionTitle.textContent = "Local Agent connection";
  const projectAgentStatus = agentStatusPresentation(state?.connection);
  const status = createStatus(
    doc,
    projectAgentStatus.label,
    projectAgentStatus.tone,
  );
  const form = createElement(doc, "div", "agent-form");
  const endpoint = createElement(doc, "input");
  endpoint.type = "url";
  endpoint.value = state?.endpoint ?? "http://127.0.0.1:8787";
  endpoint.placeholder = "http://127.0.0.1:8787";
  endpoint.setAttribute("aria-label", "Local Agent endpoint");
  endpoint.dataset.agentEndpoint = "true";
  const code = createElement(doc, "input");
  code.type = "text";
  code.inputMode = "text";
  code.autocomplete = "one-time-code";
  code.placeholder = "Pairing code from agent";
  code.setAttribute("aria-label", "Local Agent pairing code");
  code.dataset.agentCode = "true";
  const pair = createElement(doc, "button");
  pair.type = "button";
  pair.className = "button button-primary";
  pair.dataset.agentAction = "pair";
  pair.textContent =
    state?.connection === "connected" ? "Reconnect" : "Pair agent";
  const revoke = createElement(doc, "button");
  revoke.type = "button";
  revoke.className = "button button-secondary";
  revoke.dataset.agentAction = "revoke";
  revoke.textContent = "Disconnect";
  revoke.hidden = state?.connection !== "connected";
  form.append(endpoint, code, pair, revoke);
  connection.append(connectionTitle, status, form);
  if (state?.error) {
    const error = createElement(doc, "p", "inline-error");
    error.setAttribute("role", "alert");
    error.textContent = state.error;
    connection.append(error);
  }
  section.append(connection);

  const projectPanel = createElement(doc, "div", "panel project-panel");
  const projectTitle = createElement(doc, "h3");
  projectTitle.textContent = "Authorized projects";
  projectPanel.append(projectTitle);
  if (state?.connection !== "connected") {
    const empty = createElement(doc, "p", "empty-copy");
    empty.textContent =
      "Start the agent with an explicit project directory, then pair it here. Example: pnpm --filter @blocklab/local-agent start -- E:\\path\\to\\dapp";
    projectPanel.append(empty);
  } else if (state.projects.length === 0) {
    const empty = createElement(doc, "p", "empty-copy");
    empty.textContent =
      "The agent is connected but has no explicitly authorized project.";
    projectPanel.append(empty);
  } else {
    const list = createElement(doc, "div", "project-list");
    for (const project of state.projects) {
      list.append(projectCard(doc, project, state.inspection));
    }
    projectPanel.append(list);
  }
  section.append(projectPanel);
  return section;
}

function projectCard(
  doc: Document,
  project: AuthorizedProject,
  inspection: AgentInspectionResponse | undefined,
): HTMLElement {
  const card = createElement(doc, "article", "project-card");
  const title = createElement(doc, "h4");
  title.textContent = project.name;
  const root = createElement(doc, "code");
  root.textContent = project.rootIdentifier;
  const badge = createStatus(doc, "Explicitly authorized", "success");
  const inspect = createElement(doc, "button");
  inspect.type = "button";
  inspect.className = "button button-secondary";
  inspect.dataset.agentAction = "inspect";
  inspect.dataset.projectId = project.projectId;
  inspect.textContent =
    inspection?.project.projectId === project.projectId
      ? "Reinspect project"
      : "Inspect project";
  card.append(title, root, badge, inspect);
  if (inspection?.project.projectId === project.projectId) {
    card.append(renderInspection(doc, inspection));
  }
  return card;
}

function renderInspection(
  doc: Document,
  result: AgentInspectionResponse,
): HTMLElement {
  const inspection = result.inspection;
  const details = createElement(doc, "div", "inspection-details");
  const summary = createElement(doc, "p", "inspection-time");
  summary.textContent = `Inspected ${new Date(result.inspectedAt).toLocaleString()}`;
  details.append(summary);
  for (const [label, value] of [
    ["Detected stack", inspection.detectedStack.join(", ") || "None detected"],
    [
      "Package managers",
      inspection.packageManagers.join(", ") || "None detected",
    ],
    ["Chain IDs", inspection.chainIds.join(", ") || "None detected"],
    ["Networks", inspection.networkNames.join(", ") || "None detected"],
    ["RPC references", inspection.rpcReferences.join(", ") || "None detected"],
  ] as const) {
    const row = createElement(doc, "div", "inspection-row");
    const labelNode = createElement(doc, "span", "muted");
    labelNode.textContent = label;
    const valueNode = createElement(doc, "strong");
    valueNode.textContent = value;
    row.append(labelNode, valueNode);
    details.append(row);
  }
  if (inspection.limitations.length > 0) {
    const limitations = createElement(doc, "div", "inspection-limitations");
    const title = createElement(doc, "strong");
    title.textContent = "Warnings and limitations";
    limitations.append(title);
    for (const limitation of inspection.limitations) {
      const item = createElement(doc, "p");
      item.textContent = limitation;
      limitations.append(item);
    }
    details.append(limitations);
  }
  return details;
}

export function mountStudioShell(
  container: HTMLElement,
  initialRoute: StudioRoute = "overview",
  options: StudioShellOptions = {},
): StudioShellMount {
  const doc = container.ownerDocument;
  const shell = createElement(doc, "div", "studio-shell");
  const theme =
    options.theme ?? createThemeController({ root: doc.documentElement });
  const ownsTheme = options.theme === undefined;
  const sidebar = createElement(doc, "aside", "sidebar");
  sidebar.setAttribute("aria-label", "Primary navigation");
  const brand = createElement(doc, "a", "brand");
  brand.href = hashForRoute("overview");
  const brandMark = createElement(doc, "span", "brand-mark");
  brandMark.setAttribute("aria-hidden", "true");
  brandMark.textContent = "B";
  const brandText = createElement(doc, "span", "brand-text");
  const brandName = createElement(doc, "strong");
  brandName.textContent = "BLOCKLAB";
  const brandProduct = createElement(doc, "small");
  brandProduct.textContent = "STUDIO";
  brandText.append(brandName, brandProduct);
  brand.append(brandMark, brandText);
  const nav = createElement(doc, "nav", "sidebar-nav");
  nav.id = "studio-nav";
  nav.setAttribute("aria-label", "Studio destinations");
  const navItems = new Map<StudioRoute, HTMLAnchorElement>();
  for (const item of studioNavigation) {
    const link = createElement(doc, "a", "nav-item");
    link.href = hashForRoute(item.route);
    link.dataset.route = item.route;
    link.title = item.description;
    link.setAttribute("aria-label", item.label);
    const icon = createIcon(doc, item.icon, "nav-icon");
    const label = createElement(doc, "span", "nav-label");
    label.textContent = item.label;
    link.append(icon, label);
    nav.append(link);
    navItems.set(item.route, link);
  }
  const sidebarFooter = createElement(doc, "div", "sidebar-footer");
  const sidebarAgentStatus = createStatus(
    doc,
    "Local Agent disconnected",
    "warning",
  );
  sidebarFooter.append(sidebarAgentStatus);
  sidebar.append(brand, nav, sidebarFooter);

  const frame = createElement(doc, "div", "studio-frame");
  const header = createElement(doc, "header", "studio-header");
  const menuButton = createElement(doc, "button", "icon-button mobile-menu");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Open navigation");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", nav.id);
  menuButton.append(createIcon(doc, "projects", "control-icon"));
  const headerText = createElement(doc, "div", "header-text");
  const breadcrumbs = createElement(doc, "p", "breadcrumbs");
  const title = createElement(doc, "h1");
  title.tabIndex = -1;
  const description = createElement(doc, "p", "header-description");
  headerText.append(breadcrumbs, title, description);
  const agentStatus = createStatus(doc, "Local Agent disconnected", "warning");
  agentStatus.classList.add("header-agent-status");
  const themeLabel = createElement(doc, "label", "theme-control");
  const themeLabelText = createElement(doc, "span", "theme-label");
  themeLabelText.textContent = "Theme";
  const themeSelect = createElement(doc, "select", "theme-select");
  themeSelect.setAttribute("aria-label", "Color theme");
  themeSelect.dataset.themeSelect = "true";
  for (const [value, label] of [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ] as const satisfies readonly (readonly [ThemeMode, string])[]) {
    const option = createElement(doc, "option");
    option.value = value;
    option.textContent = label;
    themeSelect.append(option);
  }
  themeSelect.value = theme.getMode();
  themeLabel.append(themeLabelText, themeSelect);
  const headerControls = createElement(doc, "div", "header-controls");
  const collapseButton = createElement(
    doc,
    "button",
    "icon-button sidebar-collapse",
  );
  collapseButton.type = "button";
  collapseButton.dataset.shellAction = "collapse-sidebar";
  collapseButton.setAttribute("aria-controls", nav.id);
  collapseButton.setAttribute("aria-pressed", "false");
  collapseButton.setAttribute("aria-label", "Collapse sidebar");
  collapseButton.title = "Collapse sidebar";
  collapseButton.append(createIcon(doc, "projects", "control-icon"));
  headerControls.append(agentStatus, themeLabel, collapseButton);
  header.append(menuButton, headerText, headerControls);

  const main = createElement(doc, "main", "studio-main");
  main.id = "studio-content";
  main.tabIndex = -1;
  const content = createElement(doc, "div", "route-content");
  const history = createElement(doc, "div", "history-content");
  history.id = "history-content";
  history.hidden = true;
  const arkiv = createElement(doc, "div");
  arkiv.id = "studio-arkiv";
  const comparisonHeader = createElement(doc, "div", "section-heading");
  const comparisonTitle = createElement(doc, "h2");
  comparisonTitle.textContent = "RPC comparison";
  const comparisonDescription = createElement(doc, "p", "muted");
  comparisonDescription.textContent =
    "Read-only comparison records are rendered from a validated browser payload. Studio does not execute RPC requests.";
  comparisonHeader.append(comparisonTitle, comparisonDescription);
  const compare = createElement(doc, "div");
  compare.id = "studio-compare";
  const historyFooter = createElement(doc, "p", "history-footer muted");
  historyFooter.textContent =
    "Rabdi testnet · chain 0x76edaf · tGLM · approximately 2 s blocks. Evidence digests hash local evidence only.";
  history.append(arkiv, comparisonHeader, compare, historyFooter);
  main.append(content, history);
  frame.append(header, main);
  shell.append(sidebar, frame);
  const backdrop = createElement(doc, "button", "sidebar-backdrop");
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Close navigation");
  backdrop.tabIndex = -1;
  shell.append(backdrop);
  container.replaceChildren(shell);

  let route = initialRoute;
  let arkivState: StudioArkivState | undefined;
  let sidebarCollapsed = false;
  const updateSidebar = (): void => {
    shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    collapseButton.setAttribute("aria-pressed", String(sidebarCollapsed));
    collapseButton.setAttribute(
      "aria-label",
      sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
    );
    collapseButton.title = sidebarCollapsed
      ? "Expand sidebar"
      : "Collapse sidebar";
  };
  const updateAgentStatus = (): void => {
    const presentation = agentStatusPresentation(
      options.agent?.getState().connection,
    );
    updateStatus(agentStatus, presentation);
    updateStatus(sidebarAgentStatus, presentation);
  };
  const setMobileMenu = (open: boolean, restoreFocus = false): void => {
    sidebar.classList.toggle("mobile-open", open);
    backdrop.classList.toggle("visible", open);
    if (open) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
    }
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
    if (restoreFocus) menuButton.focus();
    else if (open) nav.querySelector<HTMLElement>("a")?.focus();
  };
  const setRoute = (nextRoute: StudioRoute, moveFocus = false): void => {
    route = nextRoute;
    const item = studioNavigation.find((entry) => entry.route === route);
    if (item === undefined) return;
    breadcrumbs.textContent = `Studio / ${item.label}`;
    title.textContent = item.label;
    description.textContent = item.description;
    for (const [itemRoute, link] of navItems) {
      const active = itemRoute === route;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    updateAgentStatus();
    const isHistory = route === "evidence-vault";
    history.hidden = !isHistory;
    content.hidden = isHistory;
    content.replaceChildren(
      route === "overview"
        ? renderOverviewDashboard(
            doc,
            createOverviewModel(options.agent?.getState(), arkivState),
          )
        : route === "projects"
          ? renderProjects(doc, options.agent)
          : renderPageState(doc, route, options.agent?.getState().connection),
    );
    setMobileMenu(false);
    if (moveFocus) title.focus();
  };
  const setArkivState = (state: StudioArkivState): void => {
    arkivState = state;
    if (route === "overview") setRoute("overview");
  };
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const shellAction = target.closest<HTMLElement>("[data-shell-action]");
    if (shellAction?.dataset.shellAction === "collapse-sidebar") {
      sidebarCollapsed = !sidebarCollapsed;
      updateSidebar();
      return;
    }
    const agentAction = target.closest<HTMLElement>("[data-agent-action]");
    if (agentAction !== null && options.agent !== undefined) {
      const action = agentAction.dataset.agentAction;
      if (action === "pair") {
        const endpoint = shell.querySelector<HTMLInputElement>(
          "[data-agent-endpoint]",
        );
        const code = shell.querySelector<HTMLInputElement>("[data-agent-code]");
        if (endpoint !== null && code !== null) {
          void options.agent.pair(endpoint.value, code.value);
        }
      } else if (action === "revoke") {
        void options.agent.revoke();
      } else if (action === "inspect") {
        const projectId = agentAction.dataset.projectId;
        if (projectId !== undefined) void options.agent.inspect(projectId);
      }
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href^='#/']");
    if (link !== null) {
      event.preventDefault();
      const nextRoute = routeFromHash(link.getAttribute("href") ?? "");
      window.history.replaceState({}, "", hashForRoute(nextRoute));
      setRoute(nextRoute, true);
    }
  };
  const onHashChange = (): void =>
    setRoute(routeFromHash(window.location.hash));
  const onMenuClick = (): void => {
    setMobileMenu(!sidebar.classList.contains("mobile-open"));
  };
  const onBackdropClick = (): void => setMobileMenu(false, true);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && sidebar.classList.contains("mobile-open")) {
      setMobileMenu(false, true);
      return;
    }
    if (event.key === "Tab" && sidebar.classList.contains("mobile-open")) {
      const focusable = sidebar.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      );
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  const onThemeChange = (): void => {
    theme.setMode(themeSelect.value as ThemeMode);
  };
  shell.addEventListener("click", onClick);
  shell.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", onHashChange);
  menuButton.addEventListener("click", onMenuClick);
  backdrop.addEventListener("click", onBackdropClick);
  themeSelect.addEventListener("change", onThemeChange);
  const unsubscribeAgent = options.agent?.subscribe(() => setRoute(route));
  updateSidebar();
  setRoute(initialRoute);

  return {
    content,
    history,
    compare,
    setRoute,
    getRoute: () => route,
    setArkivState,
    unmount: () => {
      shell.removeEventListener("click", onClick);
      shell.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("hashchange", onHashChange);
      menuButton.removeEventListener("click", onMenuClick);
      backdrop.removeEventListener("click", onBackdropClick);
      themeSelect.removeEventListener("change", onThemeChange);
      unsubscribeAgent?.();
      if (ownsTheme) theme.destroy();
    },
  };
}
