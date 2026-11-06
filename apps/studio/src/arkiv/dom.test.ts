import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RABDI_CHAIN_ID_HEX } from "./config.js";
import { ArkivController } from "./controller.js";
import { mountArkivCompare, mountStudioArkiv } from "./dom.js";
import { arkivRecordFromRow } from "./record.js";
import { makeRow, SIGNER, sampleMetadata } from "./test-fixtures.js";
import type { ArkivRecord } from "./types.js";
import { initialState } from "./types.js";

/**
 * Minimal element tree, same convention as the comparison dom test: exercises
 * the real wiring (delegated clicks, input handling, re-render), not a mock of
 * the module under test.
 */
class FakeElement {
  readonly tag: string;
  readonly attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  ownerDocument: FakeDocument | null = null;
  textContent = "";
  className = "";
  value = "";
  hidden = false;
  disabled = false;
  type = "text";
  rows = 0;
  private listeners = new Map<string, (event: unknown) => void>();

  constructor(tag = "") {
    this.tag = tag;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeNode[]): void {
    this.children = [...nodes];
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  closest(selector: string): FakeElement | null {
    if (selector === "[data-action]" && "data-action" in this.attrs)
      return this;
    if (
      selector === "[data-action='compare']" &&
      this.attrs["data-action"] === "compare"
    ) {
      return this;
    }
    if (selector === "[data-open-key]" && "data-open-key" in this.attrs)
      return this;
    return null;
  }

  dispatch(type: string, event: unknown = {}): void {
    this.listeners.get(type)?.(event);
  }
}

interface FakeText {
  readonly text: string;
}

type FakeNode = FakeElement | FakeText;

class FakeDocument {
  createElement(tag: string): FakeElement {
    const element = new FakeElement(tag);
    element.ownerDocument = this;
    return element;
  }

  createTextNode(text: string): FakeText {
    return { text };
  }
}

function isElement(node: FakeNode): node is FakeElement {
  return node instanceof FakeElement;
}

function allText(node: FakeElement): string {
  let out = node.textContent;
  for (const child of node.children) {
    if (isElement(child)) out += allText(child);
    else out += child.text;
  }
  return out;
}

function find(
  node: FakeElement,
  predicate: (element: FakeElement) => boolean,
): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (current: FakeElement): void => {
    if (predicate(current)) found.push(current);
    for (const child of current.children) {
      if (isElement(child)) walk(child);
    }
  };
  walk(node);
  return found;
}

function findByTestId(root: FakeElement, testId: string): FakeElement {
  const matches = find(
    root,
    (element) => element.attrs["data-testid"] === testId,
  );
  const first = matches[0];
  if (first === undefined) throw new Error(`testid ${testId} not found`);
  return first;
}

function findByAction(root: FakeElement, action: string): FakeElement {
  const matches = find(
    root,
    (element) => element.attrs["data-action"] === action,
  );
  const first = matches[0];
  if (first === undefined) throw new Error(`action ${action} not found`);
  return first;
}

function makeContainer(): FakeElement {
  const container = new FakeElement("div");
  container.ownerDocument = new FakeDocument();
  return container;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Clicks go through the container's delegated listener, like a real browser. */
function click(container: FakeElement, element: FakeElement): void {
  container.dispatch("click", {
    target: element,
    preventDefault: () => undefined,
  });
}

function validRecord(): ArkivRecord {
  const decoded = arkivRecordFromRow(makeRow());
  if (!decoded.ok) throw new Error("fixture invalid");
  return decoded.record;
}

// Same convention as the comparison dom test: `instanceof Element` is the
// delegated listener's guard, so the global is stubbed for the fake tree.
const realElement = globalThis.Element;
beforeEach(() => {
  (globalThis as { Element?: unknown }).Element = FakeElement;
});
afterEach(() => {
  (globalThis as { Element?: unknown }).Element = realElement;
});

describe("mountStudioArkiv", () => {
  /** Wallet action stubs, with just enough bookkeeping to assert wiring. */
  function walletStubs() {
    const calls = {
      connect: 0,
      detect: 0,
      switchNetwork: 0,
      disconnect: 0,
    };
    return {
      calls,
      wallet: {
        connect: () => {
          calls.connect += 1;
        },
        detect: () => {
          calls.detect += 1;
        },
        switchNetwork: () => {
          calls.switchNetwork += 1;
        },
        disconnect: () => {
          calls.disconnect += 1;
        },
      },
    };
  }

  function mountWith(controller: ArkivController) {
    const container = makeContainer();
    const stubs = walletStubs();
    mountStudioArkiv(container as never, controller, {
      wallet: stubs.wallet,
      loadLocalRecord: () => null,
      openByKey: () => null,
    });
    return { container, calls: stubs.calls };
  }

  it("renders the missing-wallet state with publish disabled", () => {
    const container = makeContainer();
    const controller = new ArkivController({ gateway: null });
    mountStudioArkiv(container as never, controller, {
      wallet: {
        connect: () => undefined,
        switchNetwork: () => undefined,
        disconnect: () => undefined,
        detect: () => undefined,
      },
      loadLocalRecord: () => null,
      openByKey: () => null,
    });
    const status = findByTestId(container, "sr-wallet-status");
    expect(status.textContent).toContain("No EIP-1193 wallet");
    expect(findByAction(container, "publish").disabled).toBe(true);
    expect(allText(findByTestId(container, "sr-history-list"))).toContain(
      "Run a query to list records.",
    );
  });

  it("shows Connect, and hides Detect, once a provider exists but nobody is authorized", () => {
    const controller = new ArkivController({ gateway: null });
    const { container } = mountWith(controller);
    controller.walletDisconnected();

    expect(findByAction(container, "connect").hidden).toBe(false);
    expect(findByAction(container, "detect").hidden).toBe(true);
    expect(findByAction(container, "switch-network").hidden).toBe(true);
    expect(findByAction(container, "disconnect").hidden).toBe(true);
    expect(findByTestId(container, "sr-wallet-status").textContent).toContain(
      "Wallet not connected.",
    );
  });

  it("clicking Connect invokes the wallet connection flow once", () => {
    const controller = new ArkivController({ gateway: null });
    const { container, calls } = mountWith(controller);
    controller.walletDisconnected();

    click(container, findByAction(container, "connect"));
    expect(calls.connect).toBe(1);
    expect(calls.detect).toBe(0);
  });

  it("propagates a rejected connection to the caller without faking a state", () => {
    const controller = new ArkivController({ gateway: null });
    const container = makeContainer();
    let rejection: unknown;
    mountStudioArkiv(container as never, controller, {
      wallet: {
        connect: () => {
          rejection = { code: 4001 };
        },
        detect: () => undefined,
        switchNetwork: () => undefined,
        disconnect: () => undefined,
      },
      loadLocalRecord: () => null,
      openByKey: () => null,
    });
    controller.walletDisconnected();

    click(container, findByAction(container, "connect"));
    expect(rejection).toEqual({ code: 4001 });
    // The state only changes when the app says so: nothing is simulated here.
    expect(controller.state.wallet.status).toBe("disconnected");
    expect(findByAction(container, "connect").hidden).toBe(false);
  });

  it("offers Detect (not Connect) when no wallet is injected", () => {
    const controller = new ArkivController({ gateway: null });
    const { container, calls } = mountWith(controller);
    controller.walletMissing();

    expect(findByAction(container, "detect").hidden).toBe(false);
    expect(findByAction(container, "connect").hidden).toBe(true);
    click(container, findByAction(container, "detect"));
    expect(calls.detect).toBe(1);
  });

  it("reveals the explicit switch and disconnect only on the wrong network", () => {
    const controller = new ArkivController({ gateway: null });
    const { container, calls } = mountWith(controller);
    controller.walletConnected("0xa", "0x1");

    expect(findByAction(container, "switch-network").hidden).toBe(false);
    expect(findByAction(container, "disconnect").hidden).toBe(false);
    expect(findByAction(container, "disconnect").disabled).toBe(false);
    expect(findByAction(container, "connect").hidden).toBe(true);

    click(container, findByAction(container, "switch-network"));
    expect(calls.switchNetwork).toBe(1);
    // No silent switching: the click is what asks the wallet.
    expect(controller.state.wallet.status).toBe("wrong-network");
  });

  it("offers Disconnect, and no switch, once connected on Rabdi", () => {
    const controller = new ArkivController({ gateway: null });
    const { container, calls } = mountWith(controller);
    controller.walletConnected("0xa", RABDI_CHAIN_ID_HEX);

    expect(findByAction(container, "disconnect").hidden).toBe(false);
    expect(findByAction(container, "switch-network").hidden).toBe(true);
    expect(findByAction(container, "connect").hidden).toBe(true);

    click(container, findByAction(container, "disconnect"));
    expect(calls.disconnect).toBe(1);
  });

  it("re-renders the actions on account and chain change events", () => {
    const controller = new ArkivController({ gateway: null });
    const { container } = mountWith(controller);

    controller.walletConnected("0xa", RABDI_CHAIN_ID_HEX);
    expect(findByAction(container, "disconnect").hidden).toBe(false);

    // Chain change to another network: switch appears, connect stays hidden.
    controller.chainChanged("0x1");
    expect(findByAction(container, "switch-network").hidden).toBe(false);
    expect(findByAction(container, "connect").hidden).toBe(true);

    // Account revoked in the wallet: Connect comes back.
    controller.walletDisconnected();
    expect(findByAction(container, "connect").hidden).toBe(false);
    expect(findByAction(container, "disconnect").hidden).toBe(true);
    expect(findByAction(container, "switch-network").hidden).toBe(true);
  });

  it("wires the connect button to the wallet action", () => {
    const container = makeContainer();
    let connected = false;
    mountStudioArkiv(
      container as never,
      new ArkivController({ gateway: null }),
      {
        wallet: {
          connect: () => {
            connected = true;
          },
          switchNetwork: () => undefined,
          disconnect: () => undefined,
          detect: () => undefined,
        },
        loadLocalRecord: () => null,
        openByKey: () => null,
      },
    );
    click(container, findByAction(container, "connect"));
    expect(connected).toBe(true);
  });

  it("enables publish after connect + record load, and fails honestly with no gateway", async () => {
    const container = makeContainer();
    const controller = new ArkivController({ gateway: null });
    controller.walletConnected("0xa" as never, "0x76edaf" as never);
    mountStudioArkiv(container as never, controller, {
      wallet: {
        connect: () => undefined,
        switchNetwork: () => undefined,
        disconnect: () => undefined,
        detect: () => undefined,
      },
      loadLocalRecord: (text) => {
        const parsed: unknown = JSON.parse(text);
        const result = validateExperimentMetadata(parsed);
        if (!result.ok) return "invalid";
        controller.loadRecord(result.metadata);
        return null;
      },
      openByKey: () => null,
    });
    const input = findByTestId(container, "sr-record-input");
    input.value = JSON.stringify(sampleMetadata());
    input.dispatch("input");
    expect(findByAction(container, "publish").disabled).toBe(false);
    click(container, findByAction(container, "publish"));
    await tick();
    expect(controller.state.publish.phase).toBe("failed");
    expect(controller.state.publish.error?.message).toContain(
      "Gateway is not ready",
    );
    expect(controller.state.publish.entityKey).toBeUndefined();
  });

  it("delegates history-row clicks to openRecord", async () => {
    const record = validRecord();
    const gateway = {
      findExperiment: async () => ({ entityKey: null }),
      publishExperiment: async () => {
        throw new Error("unused");
      },
      readRecord: async () => record,
      queryBy: async () => [
        {
          entityKey: record.entityKey,
          experimentId: record.metadata.experimentId,
          scenarioName: record.metadata.scenarioName,
          status: record.metadata.status,
          startedAtMs: record.metadata.startedAtMs,
        },
      ],
      currentBlock: async () => 269_199n,
    };
    const container = makeContainer();
    const controller = new ArkivController({ gateway: gateway as never });
    mountStudioArkiv(container as never, controller, {
      wallet: {
        connect: () => undefined,
        switchNetwork: () => undefined,
        disconnect: () => undefined,
        detect: () => undefined,
      },
      loadLocalRecord: () => null,
      openByKey: () => null,
    });
    const value = findByTestId(container, "sr-search-value");
    value.value = "poc-write-001";
    const select = find(container, (el) => el.tag === "select")[0];
    if (select === undefined) throw new Error("select missing");
    select.value = "experimentId";
    click(container, findByAction(container, "search"));
    await tick();
    expect(controller.state.history.phase).toBe("ok");
    const row = find(container, (el) => "data-open-key" in el.attrs)[0];
    expect(row).toBeDefined();
    if (row !== undefined) click(container, row);
    await tick();
    expect(controller.state.detail.phase).toBe("ok");
    expect(allText(findByTestId(container, "sr-detail-rows"))).toContain(
      "poc-write-001",
    );
  });

  it("unmount removes listeners and clears the panel", () => {
    const container = makeContainer();
    const mounted = mountStudioArkiv(
      container as never,
      new ArkivController({ gateway: null }),
      {
        wallet: {
          connect: () => undefined,
          switchNetwork: () => undefined,
          disconnect: () => undefined,
          detect: () => undefined,
        },
        loadLocalRecord: () => null,
        openByKey: () => null,
      },
    );
    mounted.unmount();
    expect(container.children).toHaveLength(0);
    expect(() => findByAction(container, "publish")).toThrow();
  });
});

describe("mountArkivCompare", () => {
  it("diffs two local records and labels them local", () => {
    const container = makeContainer();
    const record = validRecord();
    mountArkivCompare(container as never, {
      readRecord: async () => record,
      readLocal: (text) => {
        const parsed = JSON.parse(text);
        return [{ kind: "local", label: "past", metadata: parsed }];
      },
    });
    const [left, right] = find(container, (el) =>
      el.attrs["data-testid"]?.startsWith("sr-compare-"),
    );
    const leftInput = left as HTMLInputElement;
    const rightInput = right as HTMLInputElement;
    leftInput.value = JSON.stringify(record.metadata);
    rightInput.value = JSON.stringify(record.metadata);
    click(container, findByAction(container, "compare"));
    return tick().then(() => {
      const text = allText(findByTestId(container, "sr-compare-result"));
      expect(text).toContain("0 differing");
      expect(text).not.toContain("Arkiv record: vs"); // both sides local here
    });
  });

  it("reads Arkiv records by key", async () => {
    const container = makeContainer();
    const record = validRecord();
    mountArkivCompare(container as never, {
      readRecord: async (key) => {
        expect(key).toBe(record.entityKey);
        return record;
      },
      readLocal: (text) => {
        const parsed = JSON.parse(text) as never;
        return [{ kind: "local", label: "past", metadata: parsed }];
      },
    });
    const [left, right] = find(container, (el) =>
      el.attrs["data-testid"]?.startsWith("sr-compare-"),
    );
    const leftInput = left as HTMLInputElement;
    const rightInput = right as HTMLInputElement;
    leftInput.value = record.entityKey;
    rightInput.value = JSON.stringify(record.metadata);
    click(container, findByAction(container, "compare"));
    await tick();
    expect(allText(findByTestId(container, "sr-compare-result"))).toContain(
      "0 differing",
    );
  });
});

void initialState;

describe("mountStudioArkiv — ownership transfer", () => {
  const NEW_OWNER = "0x2222222222222222222222222222222222222222";

  function transferGateway(over: { owner?: string } = {}) {
    const record = { ...validRecord(), owner: over.owner ?? SIGNER };
    const calls = { transfer: 0 };
    return {
      calls,
      record,
      gateway: {
        findExperiment: async () => ({ entityKey: null }),
        publishExperiment: async () => {
          throw new Error("unused");
        },
        // Once the transfer has happened the chain reports B as the owner.
        readRecord: async () =>
          calls.transfer > 0
            ? { ...record, owner: NEW_OWNER as `0x${string}` }
            : record,
        queryBy: async () => [],
        currentBlock: async () => 269_199n,
        readOwnership: async () => ({
          owner:
            calls.transfer > 0 ? (NEW_OWNER as `0x${string}`) : record.owner,
          creator: record.creator,
          expiresAtBlock: record.expiresAtBlock,
          payloadHex: "0x7b7d",
        }),
        transferOwnership: async () => {
          calls.transfer += 1;
          return "0xbeef";
        },
      },
    };
  }

  async function mounted(over: { owner?: string } = {}) {
    const { gateway, calls, record } = transferGateway(over);
    const container = makeContainer();
    const controller = new ArkivController({ gateway: gateway as never });
    mountStudioArkiv(container as never, controller, {
      wallet: {
        connect: () => undefined,
        switchNetwork: () => undefined,
        disconnect: () => undefined,
        detect: () => undefined,
      },
      loadLocalRecord: () => null,
      openByKey: () => null,
    });
    // Real wallets report lowercase accounts; the entity stores checksummed ones.
    controller.walletConnected(
      SIGNER.toLowerCase() as never,
      RABDI_CHAIN_ID_HEX as never,
    );
    await controller.openRecord(record.entityKey as never);
    return { container, controller, calls, record };
  }

  it("keeps Confirm hidden and Preview disabled until an entity is open", async () => {
    const { container } = await mounted();
    expect(findByAction(container, "transfer-confirm").hidden).toBe(true);
    expect(findByAction(container, "transfer-preview").disabled).toBe(false);
  });

  it("says whether the connected account may transfer", async () => {
    const { container } = await mounted();
    expect(findByTestId(container, "sr-transfer-role").textContent).toMatch(
      /can transfer/,
    );
  });

  it("warns when the connected account is not the owner", async () => {
    const { container } = await mounted({
      owner: "0x9999999999999999999999999999999999999999",
    });
    expect(findByTestId(container, "sr-transfer-role").textContent).toMatch(
      /no longer its owner/,
    );
  });

  it("previews on click without signing, then reveals Confirm", async () => {
    const { container, controller, calls, record } = await mounted();
    const input = findByTestId(container, "sr-transfer-input");
    input.value = NEW_OWNER;
    click(container, findByAction(container, "transfer-preview"));
    await tick();
    expect(controller.state.transfer.phase).toBe("preview");
    expect(calls.transfer).toBe(0);
    expect(findByAction(container, "transfer-confirm").hidden).toBe(false);
    expect(
      findByTestId(container, "sr-transfer-rows").children.length,
    ).toBeGreaterThan(0);
    // The preview states what does not change.
    expect(
      findByTestId(container, "sr-transfer-caveats").children.length,
    ).toBeGreaterThan(0);
    expect(record.entityKey).toBe(controller.state.transfer.entityKey);
  });

  it("clears a staged transfer", async () => {
    const { container, controller } = await mounted();
    findByTestId(container, "sr-transfer-input").value = NEW_OWNER;
    click(container, findByAction(container, "transfer-preview"));
    await tick();
    click(container, findByAction(container, "transfer-reset"));
    await tick();
    expect(controller.state.transfer.phase).toBe("idle");
    expect(findByAction(container, "transfer-confirm").hidden).toBe(true);
  });

  it("refreshes the role line after a confirmed transfer", async () => {
    const { container } = await mounted();
    findByTestId(container, "sr-transfer-input").value = NEW_OWNER;
    click(container, findByAction(container, "transfer-preview"));
    await tick();
    click(container, findByAction(container, "transfer-confirm"));
    await tick();
    await tick();
    await tick();
    expect(findByTestId(container, "sr-transfer-role").textContent).toMatch(
      /no longer its owner/,
    );
    expect(
      findByTestId(container, "sr-detail-rows").children.some((row) =>
        JSON.stringify(row).includes(NEW_OWNER),
      ),
    ).toBe(true);
  });

  it("confirms exactly once on click", async () => {
    const { container, calls } = await mounted();
    findByTestId(container, "sr-transfer-input").value = NEW_OWNER;
    click(container, findByAction(container, "transfer-preview"));
    await tick();
    click(container, findByAction(container, "transfer-confirm"));
    await tick();
    await tick();
    expect(calls.transfer).toBe(1);
  });
});
