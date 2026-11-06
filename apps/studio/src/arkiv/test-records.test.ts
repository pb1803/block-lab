import { createHash } from "node:crypto";
import { metadataToPayloadBytes } from "@blocklab/arkiv-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the deterministic test-record bytes. The ids are already referenced from
 * runbooks and one of them is published on chain, so an accidental edit to a
 * profile, timestamp or digest preimage must fail here rather than silently
 * change a published payload or make the two probes collide.
 */
const RECORD_MODULE = "../../scripts/studio-mm-test-record.mjs";

const sha256 = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

async function load(id: string | undefined) {
  vi.resetModules();
  if (id === undefined) delete process.env.STUDIO_EXPERIMENT_ID;
  else process.env.STUDIO_EXPERIMENT_ID = id;
  return (await import(RECORD_MODULE)) as {
    readonly EXPERIMENT_ID: string;
    readonly buildRecord: () => Record<string, unknown>;
  };
}

afterEach(() => {
  delete process.env.STUDIO_EXPERIMENT_ID;
});

describe("test record profiles", () => {
  it("keeps studio-mm-001 byte-identical to the published payload", async () => {
    const { EXPERIMENT_ID, buildRecord } = await load(undefined);
    expect(EXPERIMENT_ID).toBe("studio-mm-001");
    const record = buildRecord();
    // The published on-chain payload was 493 bytes with this SHA-256.
    expect(sha256(metadataToPayloadBytes(record))).toBe(
      "59c090b8ea2a1818d9e2eba1395e8eda67a3e9795dce7aff5e961d0654d726a6",
    );
    expect(sha256(JSON.stringify(record))).toBe(
      "8c98ed2eb6e6b4f4ad7ee3dcb170e2a7347717b6f6814328efd353cf5a5e53e0",
    );
  });

  it("defines studio-mm-002 as a distinct ARK-05 probe", async () => {
    const { EXPERIMENT_ID, buildRecord } = await load("studio-mm-002");
    expect(EXPERIMENT_ID).toBe("studio-mm-002");
    const record = buildRecord();
    expect(record["scenarioName"]).toContain("ARK-05");
    expect(record["evidenceRef"]).toBe(
      "evidence/studio-mm-002/transfer-test.md",
    );
    // Distinct from every other record, so a run can never be mistaken for one.
    expect(sha256(metadataToPayloadBytes(record))).toBe(
      "dfe87f08922439924f3df6f8f34d1e4ec1a369da54c9cc707a3f5a7653391f9d",
    );
    expect(sha256(JSON.stringify(record))).toBe(
      "1985617a653b1f63cc0fa309ee18d4721afb6c37264574e31b5a358049542d8d",
    );
  });

  it("refuses an unknown id instead of falling back", async () => {
    await expect(load("studio-mm-999")).rejects.toThrow(
      /unknown STUDIO_EXPERIMENT_ID/,
    );
  });
});
