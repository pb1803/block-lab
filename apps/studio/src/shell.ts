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
  readonly icon: string;
}

export const studioNavigation: readonly StudioNavigationItem[] = [
  {
    route: "overview",
    label: "Overview",
    shortLabel: "Overview",
    description: "Start with the current workspace and next safe action.",
    icon: "⌂",
  },
  {
    route: "projects",
    label: "Projects",
    shortLabel: "Projects",
    description: "Inspect a project and review its detected boundaries.",
    icon: "▦",
  },
  {
    route: "attack-lab",
    label: "Attack Lab",
    shortLabel: "Attack Lab",
    description: "Review verified scenarios and their safety scope.",
    icon: "◇",
  },
  {
    route: "experiments",
    label: "Experiments",
    shortLabel: "Experiments",
    description: "Review runs, timelines, evidence, and recovery.",
    icon: "◌",
  },
  {
    route: "network-intelligence",
    label: "Network Intelligence",
    shortLabel: "Network",
    description: "Compare read-only RPC routes and their limitations.",
    icon: "⌁",
  },
  {
    route: "evidence-vault",
    label: "Evidence Vault",
    shortLabel: "Evidence",
    description: "Search local evidence and optional Arkiv metadata.",
    icon: "▤",
  },
  {
    route: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Review integrations and local permissions.",
    icon: "⚙",
  },
];

export interface StudioShellMount {
  readonly content: HTMLElement;
  readonly history: HTMLElement;
  readonly compare: HTMLElement;
  readonly setRoute: (route: StudioRoute) => void;
  readonly getRoute: () => StudioRoute;
  readonly unmount: () => void;
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

function createStatus(
  doc: Document,
  label: string,
  tone: "neutral" | "warning",
): HTMLElement {
  const status = createElement(doc, "span", `status status-${tone}`);
  status.setAttribute("role", "status");
  const dot = createElement(doc, "span", "status-dot");
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, doc.createTextNode(label));
  return status;
}

function renderPageState(doc: Document, route: StudioRoute): HTMLElement {
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
  const badge = createStatus(doc, "Not connected to a Local Agent", "warning");
  const note = createElement(doc, "p", "page-state-note");
  note.textContent =
    route === "settings"
      ? "Pairing and permission management are planned for the Local Agent phase. No local process or filesystem access is available in this browser surface."
      : "This workflow is not implemented yet. BLOCKLAB will keep it unavailable until its safety boundary and evidence contract are ready.";
  section.append(eyebrow, title, description, badge, note);
  return section;
}

function renderOverview(doc: Document): HTMLElement {
  const section = createElement(doc, "section", "overview-grid");
  section.setAttribute("aria-labelledby", "overview-title");
  const intro = createElement(doc, "div", "overview-intro");
  const eyebrow = createElement(doc, "p", "eyebrow");
  eyebrow.textContent = "RESILIENCE & PRIVACY TESTING";
  const title = createElement(doc, "h2");
  title.id = "overview-title";
  title.textContent = "Break your dApp before the real world does.";
  const copy = createElement(doc, "p", "lead");
  copy.textContent =
    "Inspect a local Ethereum project, run bounded experiments, and retain evidence you can explain. Start with the surfaces that are available today.";
  const actions = createElement(doc, "div", "overview-actions");
  const historyLink = createElement(doc, "a", "button button-primary");
  historyLink.href = hashForRoute("evidence-vault");
  historyLink.textContent = "Open Evidence Vault";
  const inspectLink = createElement(doc, "a", "button button-secondary");
  inspectLink.href = hashForRoute("projects");
  inspectLink.textContent = "Review project workflow";
  actions.append(historyLink, inspectLink);
  intro.append(eyebrow, title, copy, actions);

  const context = createElement(doc, "aside", "context-card");
  const contextLabel = createElement(doc, "p", "card-label");
  contextLabel.textContent = "CURRENT WORKSPACE";
  const contextTitle = createElement(doc, "h3");
  contextTitle.textContent = "No project selected";
  const contextCopy = createElement(doc, "p", "muted");
  contextCopy.textContent =
    "The browser Studio has no Local Agent connection, so it cannot inspect a filesystem or start a project.";
  const contextStatus = createStatus(doc, "Agent unavailable", "warning");
  context.append(contextLabel, contextTitle, contextCopy, contextStatus);
  section.append(intro, context);

  const next = createElement(doc, "div", "overview-next panel");
  const nextTitle = createElement(doc, "h3");
  nextTitle.textContent = "Next safe actions";
  const list = createElement(doc, "ul", "action-list");
  for (const [label, detail, route] of [
    [
      "Review evidence history",
      "Read validated Arkiv metadata and local comparison records.",
      "evidence-vault",
    ],
    [
      "Inspect a project",
      "Planned: explicit project selection through a reviewed Local Agent.",
      "projects",
    ],
    [
      "Choose a verified scenario",
      "Planned: RPC blackout remains the only verified attack scenario.",
      "attack-lab",
    ],
  ] as const) {
    const item = createElement(doc, "li");
    const link = createElement(doc, "a", "action-link");
    link.href = hashForRoute(route);
    link.textContent = label;
    const detailNode = createElement(doc, "span", "muted");
    detailNode.textContent = detail;
    item.append(link, detailNode);
    list.append(item);
  }
  next.append(nextTitle, list);
  section.append(next);
  return section;
}

export function mountStudioShell(
  container: HTMLElement,
  initialRoute: StudioRoute = "overview",
): StudioShellMount {
  const doc = container.ownerDocument;
  const shell = createElement(doc, "div", "studio-shell");
  const sidebar = createElement(doc, "aside", "sidebar");
  sidebar.setAttribute("aria-label", "Primary navigation");
  const brand = createElement(doc, "a", "brand");
  brand.href = hashForRoute("overview");
  brand.innerHTML =
    '<span class="brand-mark" aria-hidden="true">B</span><span><strong>BLOCKLAB</strong><small>STUDIO</small></span>';
  const nav = createElement(doc, "nav", "sidebar-nav");
  nav.setAttribute("aria-label", "Studio destinations");
  const navItems = new Map<StudioRoute, HTMLAnchorElement>();
  for (const item of studioNavigation) {
    const link = createElement(doc, "a", "nav-item");
    link.href = hashForRoute(item.route);
    link.dataset.route = item.route;
    link.title = item.description;
    link.setAttribute("aria-label", item.label);
    const icon = createElement(doc, "span", "nav-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = createElement(doc, "span", "nav-label");
    label.textContent = item.label;
    link.append(icon, label);
    nav.append(link);
    navItems.set(item.route, link);
  }
  const sidebarFooter = createElement(doc, "div", "sidebar-footer");
  sidebarFooter.append(createStatus(doc, "Agent unavailable", "warning"));
  sidebar.append(brand, nav, sidebarFooter);

  const frame = createElement(doc, "div", "studio-frame");
  const header = createElement(doc, "header", "studio-header");
  const menuButton = createElement(doc, "button", "icon-button mobile-menu");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Toggle navigation");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.textContent = "☰";
  const headerText = createElement(doc, "div", "header-text");
  const breadcrumbs = createElement(doc, "p", "breadcrumbs");
  const title = createElement(doc, "h1");
  const description = createElement(doc, "p", "header-description");
  headerText.append(breadcrumbs, title, description);
  const agentStatus = createStatus(doc, "Local Agent unavailable", "warning");
  agentStatus.classList.add("header-agent-status");
  header.append(menuButton, headerText, agentStatus);

  const main = createElement(doc, "main", "studio-main");
  main.id = "studio-content";
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
  container.replaceChildren(shell);

  let route = initialRoute;
  const setRoute = (nextRoute: StudioRoute): void => {
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
    const isHistory = route === "evidence-vault";
    history.hidden = !isHistory;
    content.hidden = isHistory;
    content.replaceChildren(
      route === "overview" ? renderOverview(doc) : renderPageState(doc, route),
    );
    sidebar.classList.remove("mobile-open");
    menuButton.setAttribute("aria-expanded", "false");
  };
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href^='#/']");
    if (link === null) return;
    event.preventDefault();
    const nextRoute = routeFromHash(link.getAttribute("href") ?? "");
    window.history.replaceState({}, "", hashForRoute(nextRoute));
    setRoute(nextRoute);
  };
  const onHashChange = (): void =>
    setRoute(routeFromHash(window.location.hash));
  const onMenuClick = (): void => {
    const open = sidebar.classList.toggle("mobile-open");
    menuButton.setAttribute("aria-expanded", String(open));
  };
  shell.addEventListener("click", onClick);
  window.addEventListener("hashchange", onHashChange);
  menuButton.addEventListener("click", onMenuClick);
  setRoute(initialRoute);

  return {
    content,
    history,
    compare,
    setRoute,
    getRoute: () => route,
    unmount: () => {
      shell.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashChange);
      menuButton.removeEventListener("click", onMenuClick);
    },
  };
}
