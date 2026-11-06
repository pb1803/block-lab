/**
 * DOM mounting for the Studio Arkiv feature.
 *
 * This is the only module in the feature that touches the document. It builds
 * the panel once, keeps refs to inputs (so re-renders never wipe what the user
 * typed), and re-renders text/disabled state on each controller state change.
 * All clicks go through one delegated listener keyed on `data-action`, so the
 * wiring is testable with a fake element tree.
 */

import { type CompareSide, compareRecords } from "./compare.js";
import type { ArkivController } from "./controller.js";
import type { ArkivGateway } from "./gateway.js";
import type { StudioArkivState, StudioError } from "./types.js";
import { disclosureRows, studioArkivView, type Tone } from "./view.js";
import { classifyError } from "./wallet.js";

export interface ArkivWalletActions {
  readonly connect: () => void;
  readonly switchNetwork: () => void;
  readonly disconnect: () => void;
  readonly detect: () => void;
}

export interface MountStudioArkivOptions {
  readonly wallet: ArkivWalletActions;
  /** Parses+validates the pasted JSON; returns an error message or null. */
  readonly loadLocalRecord: (text: string) => string | null;
  /** Reads a record by typed key; returns an error message or null. */
  readonly openByKey: (key: string) => string | null;
}

export interface MountedStudioArkiv {
  readonly unmount: () => void;
}

interface PanelRefs {
  readonly publishButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly connectButton: HTMLButtonElement;
  readonly switchButton: HTMLButtonElement;
  readonly disconnectButton: HTMLButtonElement;
  readonly detectButton: HTMLButtonElement;
  readonly searchButton: HTMLButtonElement;
  readonly openButton: HTMLButtonElement;
  readonly recordInput: HTMLTextAreaElement;
  readonly searchValueInput: HTMLInputElement;
  readonly searchFieldSelect: HTMLSelectElement;
  readonly keyInput: HTMLInputElement;
  readonly publishPhase: HTMLElement;
  readonly publishError: HTMLElement;
  readonly disclosure: HTMLElement;
  readonly publishResult: HTMLElement;
  readonly readBack: HTMLElement;
  readonly walletStatus: HTMLElement;
  readonly walletChain: HTMLElement;
  readonly historyPhase: HTMLElement;
  readonly historyList: HTMLElement;
  readonly detailPhase: HTMLElement;
  readonly detailRows: HTMLElement;
  readonly detailError: HTMLElement;
  readonly disclosureTitle: HTMLElement;
}

function setTone(element: HTMLElement, tone: Tone | undefined): void {
  element.setAttribute("data-tone", tone === undefined ? "neutral" : tone);
}

function rowElement(
  doc: Document,
  label: string,
  value: string,
  tone?: Tone,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "sr-row";
  const labelNode = doc.createElement("span");
  labelNode.className = "sr-label";
  labelNode.textContent = label;
  const valueNode = doc.createElement("span");
  valueNode.className = "sr-value";
  valueNode.textContent = value;
  setTone(valueNode, tone);
  row.append(labelNode, valueNode);
  return row;
}

export function mountStudioArkiv(
  container: HTMLElement,
  controller: ArkivController,
  options: MountStudioArkivOptions,
): MountedStudioArkiv {
  const doc = container.ownerDocument;
  const refs = createPanel(doc, container);

  const render = (state: StudioArkivState): void => {
    const view = studioArkivView(state);

    refs.walletStatus.textContent = view.wallet.statusText;
    refs.walletChain.textContent = view.wallet.chainLine;
    setTone(refs.walletStatus, statusTone(view.wallet.status));
    refs.connectButton.hidden = !view.wallet.showConnect;
    refs.detectButton.hidden = !view.wallet.showDetect;
    refs.disconnectButton.hidden = !view.wallet.canDisconnect;
    refs.disconnectButton.disabled = !view.wallet.canDisconnect;
    refs.switchButton.hidden = !view.wallet.showSwitch;

    refs.publishPhase.textContent = view.publish.phaseText;
    setTone(refs.publishPhase, view.publish.phaseTone);
    refs.publishError.textContent = view.publish.error ?? "";
    refs.publishButton.disabled = !view.publish.canPublish;
    refs.resetButton.disabled = view.publish.canPublish;
    refs.disclosure.replaceChildren();
    if (
      view.publish.disclosureShown &&
      controller.state.publish.metadata !== undefined
    ) {
      const items = disclosureRows(controller.state.publish.metadata);
      for (const item of items) {
        const li = doc.createElement("li");
        li.textContent = item;
        refs.disclosure.append(li);
      }
    } else {
      const li = doc.createElement("li");
      li.textContent =
        "Paste a validated BLOCKLAB record above to preview what becomes public.";
      refs.disclosure.append(li);
    }
    refs.disclosureTitle.hidden = !view.publish.disclosureShown;
    refs.publishResult.replaceChildren();
    for (const row of view.publish.resultRows) {
      refs.publishResult.append(
        rowElement(doc, row.label, row.value, row.tone),
      );
    }
    refs.readBack.textContent = view.publish.readBackLine ?? "";
    setTone(refs.readBack, view.publish.readBackTone);

    refs.historyPhase.textContent = view.history.phaseText;
    setTone(refs.historyPhase, view.history.phaseTone);
    renderHistoryList(
      doc,
      refs.historyList,
      state.history.phase,
      view.history.rows,
    );

    refs.detailPhase.textContent = view.detail.phaseText;
    setTone(refs.detailPhase, view.detail.phaseTone);
    refs.detailError.textContent = view.detail.error ?? "";
    refs.detailRows.replaceChildren();
    for (const row of view.detail.rows) {
      refs.detailRows.append(rowElement(doc, row.label, row.value, row.tone));
    }
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest("[data-action]");
    const keyEl = target.closest("[data-open-key]");
    if (actionEl !== null) {
      const action = actionEl.getAttribute("data-action");
      switch (action) {
        case "connect":
          options.wallet.connect();
          break;
        case "switch-network":
          options.wallet.switchNetwork();
          break;
        case "disconnect":
          options.wallet.disconnect();
          break;
        case "detect":
          options.wallet.detect();
          break;
        case "publish":
          event.preventDefault();
          void controller.publish();
          break;
        case "reset-publish":
          controller.resetPublish();
          break;
        case "search": {
          event.preventDefault();
          const field = refs.searchFieldSelect.value;
          if (
            field !== "experimentId" &&
            field !== "scenarioName" &&
            field !== "status"
          )
            return;
          void controller.search(field, refs.searchValueInput.value);
          break;
        }
        case "open-key": {
          event.preventDefault();
          const key = refs.keyInput.value.trim();
          if (key === "") return;
          const error = options.openByKey(key);
          if (error === null) void controller.openRecord(key as `0x${string}`);
          else showDetailError(refs, error);
          break;
        }
      }
      return;
    }
    if (keyEl !== null) {
      const key = keyEl.getAttribute("data-open-key");
      if (key !== null) void controller.openRecord(key as `0x${string}`);
    }
  };

  const onRecordInput = (): void => {
    const error = options.loadLocalRecord(refs.recordInput.value);
    refs.publishError.textContent =
      error === null ? "" : `Record not loaded: ${error}`;
  };

  refs.recordInput.addEventListener("input", onRecordInput);
  container.addEventListener("click", onClick);
  render(controller.state);
  const unsubscribe = controller.subscribe(render);

  return {
    unmount: (): void => {
      unsubscribe();
      container.removeEventListener("click", onClick);
      refs.recordInput.removeEventListener("input", onRecordInput);
      container.replaceChildren();
    },
  };
}

function statusTone(status: string): Tone {
  if (status === "connected") return "ok";
  if (status === "wrong-network") return "warn";
  return "neutral";
}

function showDetailError(refs: PanelRefs, message: string): void {
  refs.detailError.textContent = message;
}

function renderHistoryList(
  doc: Document,
  list: HTMLElement,
  phase: string,
  rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly tone?: Tone | undefined;
  }[],
): void {
  list.replaceChildren();
  if (phase === "ok") {
    for (const row of rows) {
      const button = doc.createElement("button");
      button.setAttribute("data-open-key", "");
      button.className = "history-row";
      button.textContent = `${row.label} — ${row.value}`;
      setTone(button, row.tone);
      list.append(button);
    }
  } else {
    const li = doc.createElement("li");
    li.className = "history-placeholder";
    li.textContent =
      phase === "searching" ? "…" : "Run a query to list records.";
    list.append(li);
  }
}

function createPanel(doc: Document, container: HTMLElement): PanelRefs {
  const section = (title: string, testId: string): HTMLElement => {
    const el = doc.createElement("section");
    el.className = "sr-panel";
    el.setAttribute("data-testid", testId);
    const heading = doc.createElement("h3");
    heading.textContent = title;
    el.append(heading);
    container.append(el);
    return el;
  };
  const line = (parent: HTMLElement, testId: string): HTMLElement => {
    const p = doc.createElement("p");
    p.className = "sr-line";
    p.setAttribute("data-testid", testId);
    parent.append(p);
    return p;
  };
  const button = (
    parent: HTMLElement,
    label: string,
    action: string,
  ): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.setAttribute("data-action", action);
    b.textContent = label;
    parent.append(b);
    return b;
  };

  const wallet = section("Wallet & network", "sr-wallet");
  const walletStatus = line(wallet, "sr-wallet-status");
  const walletChain = line(wallet, "sr-wallet-chain");
  const connectButton = button(wallet, "Connect wallet", "connect");
  const detectButton = button(wallet, "Detect wallet", "detect");
  const switchButton = button(wallet, "Switch to Rabdi", "switch-network");
  const disconnectButton = button(wallet, "Disconnect", "disconnect");
  detectButton.hidden = true;
  switchButton.hidden = true;
  disconnectButton.hidden = true;

  const publish = section("Publish to Arkiv", "sr-publish");
  const recordInput = doc.createElement("textarea");
  recordInput.className = "record-input";
  recordInput.setAttribute("data-testid", "sr-record-input");
  recordInput.rows = 6;
  recordInput.placeholder =
    "Paste a validated BLOCKLAB experiment metadata JSON here.";
  publish.append(recordInput);
  const publishPhase = line(publish, "sr-publish-phase");
  const disclosureTitle = line(publish, "sr-disclosure-title");
  disclosureTitle.textContent = "What becomes public on Arkiv:";
  const disclosure = doc.createElement("ul");
  disclosure.className = "disclosure";
  disclosure.setAttribute("data-testid", "sr-disclosure");
  publish.append(disclosure);
  const publishButton = button(
    publish,
    "Review & approve the publication",
    "publish",
  );
  const resetButton = button(publish, "Reset last publish", "reset-publish");
  const publishResult = doc.createElement("div");
  publishResult.className = "publish-result";
  publishResult.setAttribute("data-testid", "sr-publish-result");
  publish.append(publishResult);
  const publishError = line(publish, "sr-publish-error");
  const readBack = line(publish, "sr-read-back");

  const history = section("History", "sr-history");
  const fieldLabel = doc.createElement("label");
  fieldLabel.textContent = "Field ";
  const searchFieldSelect = doc.createElement("select");
  for (const option of ["experimentId", "scenarioName", "status"] as const) {
    const opt = doc.createElement("option");
    opt.value = option;
    opt.textContent = option;
    searchFieldSelect.append(opt);
  }
  const searchValueInput = doc.createElement("input");
  searchValueInput.type = "text";
  searchValueInput.setAttribute("data-testid", "sr-search-value");
  searchValueInput.placeholder = "value to search";
  const searchButton = button(history, "Search", "search");
  fieldLabel.append(searchFieldSelect);
  const searchRow = doc.createElement("div");
  searchRow.className = "search-row";
  searchRow.append(fieldLabel, searchValueInput, searchButton);
  history.append(searchRow);
  const historyPhase = line(history, "sr-history-phase");
  const historyList = doc.createElement("ul");
  historyList.className = "history-list";
  historyList.setAttribute("data-testid", "sr-history-list");
  history.append(historyList);

  const detail = section("Record details", "sr-detail");
  const keyInput = doc.createElement("input");
  keyInput.type = "text";
  keyInput.setAttribute("data-testid", "sr-key-input");
  keyInput.placeholder = "Entity key (0x… or experimentId)";
  const openButton = button(detail, "Open", "open-key");
  const keyRow = doc.createElement("div");
  keyRow.className = "search-row";
  keyRow.append(keyInput, openButton);
  detail.append(keyRow);
  const detailPhase = line(detail, "sr-detail-phase");
  const detailRows = doc.createElement("div");
  detailRows.className = "detail-rows";
  detailRows.setAttribute("data-testid", "sr-detail-rows");
  detail.append(detailRows);
  const detailError = line(detail, "sr-detail-error");
  const disclaimer = line(detail, "sr-disclaimer");
  disclaimer.textContent =
    "The evidence digest is a hash of local evidence only; the detailed traces stay local and are not on Arkiv.";

  return {
    publishButton,
    resetButton,
    connectButton,
    switchButton,
    disconnectButton,
    detectButton,
    searchButton,
    openButton,
    recordInput,
    searchValueInput,
    searchFieldSelect,
    keyInput,
    publishPhase,
    publishError,
    disclosure,
    publishResult,
    readBack,
    walletStatus,
    walletChain,
    historyPhase,
    historyList,
    detailPhase,
    detailRows,
    detailError,
    disclosureTitle,
  };
}

/**
 * The compare section: two entity keys (or two history rows), read through the
 * gateway, diffed with the shared comparison model. Errors are classified and
 * shown inline; results are labelled "Arkiv record" or "Local record" so a pasted
 * local run is never presented as on-chain.
 */
export interface MountArkivCompareOptions {
  readonly readRecord: ArkivGateway["readRecord"];
  readonly readLocal: (text: string) => readonly CompareSide[] | string;
}

export interface MountedArkivCompare {
  readonly unmount: () => void;
}

export function mountArkivCompare(
  container: HTMLElement,
  options: MountArkivCompareOptions,
): MountedArkivCompare {
  const doc = container.ownerDocument;
  const leftInput = doc.createElement("input");
  leftInput.setAttribute("data-testid", "sr-compare-left");
  leftInput.placeholder = "Left: entity key or pasted local JSON";
  const rightInput = doc.createElement("input");
  rightInput.setAttribute("data-testid", "sr-compare-right");
  rightInput.placeholder = "Right: entity key or pasted local JSON";
  const compareButton = doc.createElement("button");
  compareButton.type = "button";
  compareButton.setAttribute("data-action", "compare");
  compareButton.textContent = "Compare";
  const result = doc.createElement("div");
  result.setAttribute("data-testid", "sr-compare-result");
  container.append(leftInput, rightInput, compareButton, result);

  const run = async (): Promise<void> => {
    const leftText = leftInput.value.trim();
    const rightText = rightInput.value.trim();
    if (leftText === "" || rightText === "") {
      result.textContent = "Both sides must be filled in.";
      return;
    }
    const leftSide = await sideOfRead(leftText, options);
    if (typeof leftSide === "string") {
      result.textContent = leftSide;
      return;
    }
    const rightSide = await sideOfRead(rightText, options);
    if (typeof rightSide === "string") {
      result.textContent = rightSide;
      return;
    }
    const model = compareRecords(leftSide, rightSide);
    result.replaceChildren();
    const summary = doc.createElement("p");
    summary.textContent = `${leftSide.kind === "arkiv" ? leftSide.label : "local"} vs ${
      rightSide.kind === "arkiv" ? rightSide.label : "local"
    }: ${model.differing} differing, ${model.identical} identical.`;
    result.append(summary);
    for (const row of model.rows) {
      const diffed = doc.createElement("div");
      diffed.className = "sr-row" + (row.same ? "" : " diff");
      const labelNode = doc.createElement("span");
      labelNode.className = "sr-label";
      labelNode.textContent = `${row.group === "system" ? "(on-chain) " : ""}${row.label}`;
      const valueNode = doc.createElement("span");
      valueNode.className = "sr-value";
      valueNode.textContent = row.same
        ? row.left
        : `${row.left} ≠ ${row.right}`;
      diffed.append(labelNode, valueNode);
      result.append(diffed);
    }
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-action='compare']") === null) return;
    event.preventDefault();
    void run();
  };
  container.addEventListener("click", onClick);
  return {
    unmount: (): void => {
      container.removeEventListener("click", onClick);
      container.replaceChildren();
    },
  };
}

async function sideOfRead(
  text: string,
  options: MountArkivCompareOptions,
): Promise<CompareSide | string> {
  const trimmed = text.trim();
  const isKey =
    /^0x[0-9a-fA-F]{64}$/.test(trimmed) || /^[0-9]{1,30}$/.test(trimmed);
  if (isKey) {
    try {
      const record = await options.readRecord(trimmed as `0x${string}`);
      return { kind: "arkiv", label: trimmed.slice(0, 10), record };
    } catch (error) {
      const classified: StudioError = classifyError(error);
      return `[${classified.category}] ${classified.message}`;
    }
  }
  const local = options.readLocal(trimmed);
  if (typeof local === "string") return local;
  const first = local[0];
  if (first === undefined)
    return "The local record yielded no side to compare.";
  return first;
}
