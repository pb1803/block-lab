import type { ExperimentMetadata } from "@blocklab/arkiv-metadata";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { ArkivGateway, PublishResult } from "../src/gateway.js";
import type { ArchivedRecord, WorkflowError } from "../src/status.js";
import { ArkivPocWorkflow } from "../src/workflow.js";

const ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const KEY = `0x${"ab".repeat(32)}` as Hex;
const TX = `0x${"cd".repeat(32)}` as Hex;
const RABDI = "0x76edaf" as Hex;

/** Mock gateway: no network, no wallet. Every call is observable. */
class MockGateway implements ArkivGateway {
  findCalls: string[] = [];
  publishCalls: ExperimentMetadata[] = [];
  readCalls: Hex[] = [];
  findResult: { entityKey: Hex | null } = { entityKey: null };
  findError: Error | undefined;
  publishError: Error | undefined;
  readError: Error | undefined;
  /** When set, publishExperiment parks on a gate the test opens by hand. */
  publishGate: (() => Promise<void>) | undefined;

  async findExperiment(experimentId: string) {
    this.findCalls.push(experimentId);
    if (this.findError !== undefined) throw this.findError;
    return this.findResult;
  }

  async publishExperiment(
    metadata: ExperimentMetadata,
  ): Promise<PublishResult> {
    this.publishCalls.push(metadata);
    if (this.publishGate !== undefined) await this.publishGate();
    if (this.publishError !== undefined) throw this.publishError;
    return { entityKey: KEY, txHash: TX, expiresAtBlock: 500n };
  }

  async readExperiment(entityKey: Hex): Promise<ArchivedRecord> {
    this.readCalls.push(entityKey);
    if (this.readError !== undefined) throw this.readError;
    return {
      entityKey,
      owner: ADDRESS,
      creator: ADDRESS,
      createdAtBlock: 400n,
      updatedAtBlock: 400n,
      expiresAtBlock: 500n,
      readonlyFlag: false,
      payloadJson: '{"experimentId":"run-001"}',
    };
  }
}

const META = (() => {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: "run-001",
    experimentType: "rpc-blackout",
    scenarioName: "RPC blackout",
    targetChainId: 31337,
    status: "passed",
    startedAtMs: 1_790_000_000_000,
    completedAtMs: 1_790_000_010_000,
    requestCount: 10,
    succeededCount: 8,
    failedCount: 2,
    rpcFailureCount: 2,
    evidenceDigest: "3f".repeat(32),
    expiryDays: 30,
  });
  if (!result.ok) throw new Error("fixture rejected");
  return result.metadata;
})();

function connected(
  gateway: ArkivGateway,
  classify?: (error: unknown) => WorkflowError,
) {
  const workflow =
    classify === undefined
      ? new ArkivPocWorkflow({ gateway })
      : new ArkivPocWorkflow({ gateway, classify });
  workflow.loadRecord(META);
  workflow.walletConnected(ADDRESS, RABDI);
  return workflow;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("publish workflow", () => {
  it("confirms only after the gateway resolves, then reads the entity back", async () => {
    const gateway = new MockGateway();
    const workflow = connected(gateway);

    expect(workflow.state.publish.status).toBe("idle");
    await workflow.publish();

    expect(gateway.findCalls).toEqual(["run-001"]);
    expect(gateway.publishCalls).toHaveLength(1);
    expect(workflow.state.publish.status).toBe("confirmed");
    expect(workflow.state.publish.entityKey).toBe(KEY);
    expect(workflow.state.publish.txHash).toBe(TX);
    expect(workflow.state.publish.expiresAtBlock).toBe(500n);

    await workflow.queryEntity(KEY);
    expect(gateway.readCalls).toEqual([KEY]);
    expect(workflow.state.query.status).toBe("ok");
    expect(
      JSON.parse(workflow.state.query.record?.payloadJson ?? "{}"),
    ).toEqual({
      experimentId: "run-001",
    });
  });

  it("does not confirm before the SDK returns", async () => {
    const gateway = new MockGateway();
    let release: () => void = () => {};
    gateway.publishGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const workflow = connected(gateway);

    const pending = workflow.publish();
    await waitFor(
      () => workflow.state.publish.status === "awaiting-signature",
      "signature request",
    );
    expect(workflow.state.publish.entityKey).toBeUndefined();

    release();
    await pending;
    expect(workflow.state.publish.status).toBe("confirmed");
  });

  it("stops at an existing entity and never writes", async () => {
    const gateway = new MockGateway();
    gateway.findResult = { entityKey: KEY };
    const workflow = connected(gateway);

    await workflow.publish();
    expect(gateway.publishCalls).toHaveLength(0);
    expect(workflow.state.publish.status).toBe("existing");
    expect(workflow.state.publish.alreadyPublished).toBe(true);
  });

  it("does not write when the duplicate check fails", async () => {
    const gateway = new MockGateway();
    gateway.findError = new Error("request failed: 503");
    const workflow = connected(gateway, () => ({
      category: "network",
      message: "request failed: 503",
    }));

    await workflow.publish();
    expect(gateway.publishCalls).toHaveLength(0);
    expect(workflow.state.publish.status).toBe("failed");
    expect(workflow.state.publish.error?.category).toBe("network");
  });

  it("reports a wallet rejection without a confirmation", async () => {
    const gateway = new MockGateway();
    gateway.publishError = Object.assign(
      new Error("User rejected the request"),
      { code: 4001 },
    );
    const workflow = connected(gateway, () => ({
      category: "user-rejected",
      message: "rejected",
    }));

    await workflow.publish();
    expect(workflow.state.publish.status).toBe("failed");
    expect(workflow.state.publish.entityKey).toBeUndefined();
    expect(workflow.state.publish.error?.category).toBe("user-rejected");
  });

  it("does not submit when disconnected or on the wrong network", async () => {
    const gateway = new MockGateway();
    const workflow = new ArkivPocWorkflow({ gateway });
    workflow.loadRecord(META);
    workflow.walletConnected(ADDRESS, "0x1" as Hex);

    await workflow.publish();
    expect(gateway.findCalls).toHaveLength(0);
    expect(gateway.publishCalls).toHaveLength(0);
    expect(workflow.state.publish.error?.category).toBe("wrong-network");
  });

  it("allows only one write while a publish is in flight", async () => {
    const gateway = new MockGateway();
    let release: () => void = () => {};
    gateway.publishGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const workflow = connected(gateway);

    const first = workflow.publish();
    await waitFor(
      () => workflow.state.publish.status === "awaiting-signature",
      "signature request",
    );
    await workflow.publish(); // second click while in flight

    release();
    await first;

    expect(gateway.publishCalls).toHaveLength(1);
    expect(workflow.state.publish.status).toBe("confirmed");
  });

  it("ignores a late result after the wallet disconnects", async () => {
    const gateway = new MockGateway();
    let release: () => void = () => {};
    gateway.publishGate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const workflow = connected(gateway);

    const pending = workflow.publish();
    await waitFor(
      () => workflow.state.publish.status === "awaiting-signature",
      "signature request",
    );
    workflow.walletDisconnected();

    release();
    await pending;

    expect(workflow.state.wallet.status).toBe("disconnected");
    expect(workflow.state.publish.status).toBe("awaiting-signature");
    expect(workflow.state.publish.entityKey).toBeUndefined();
  });

  it("notifies subscribers of every state change and can unsubscribe", async () => {
    const gateway = new MockGateway();
    const workflow = connected(gateway);
    const seen: string[] = [];
    const unsubscribe = workflow.subscribe((state) =>
      seen.push(state.publish.status),
    );
    await workflow.publish();
    unsubscribe();
    await workflow.queryEntity(KEY);
    expect(seen).toContain("preflight");
    expect(seen).toContain("confirmed");
    expect(seen).not.toContain("querying");
  });

  it("reports a query failure distinctly from a publish failure", async () => {
    const gateway = new MockGateway();
    gateway.readError = Object.assign(new Error("NoEntityFound"), {
      name: "NoEntityFoundError",
    });
    const workflow = connected(gateway);
    await workflow.publish();
    await workflow.queryEntity(KEY);
    expect(workflow.state.publish.status).toBe("confirmed");
    expect(workflow.state.query.status).toBe("failed");
  });

  it("blocks publish when no gateway is available", async () => {
    const workflow = new ArkivPocWorkflow({ gateway: null });
    workflow.loadRecord(META);
    workflow.walletConnected(ADDRESS, RABDI);
    await workflow.publish();
    expect(workflow.state.publish.status).toBe("failed");
    expect(workflow.state.publish.error?.category).toBe("validation");
  });
});
