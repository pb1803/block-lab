/**
 * Verification is only useful if it can fail. These tests drive the failure
 * paths (flipped byte, wrong owner, reverted receipt, missing receipt, malformed
 * hex) as hard as the success path.
 */

import { metadataToPayloadBytes } from "@blocklab/arkiv-metadata";
import { describe, expect, it } from "vitest";
import {
  ENTITY_KEY,
  makeRow,
  payloadHex,
  SIGNER,
  sampleMetadata,
} from "./test-fixtures.js";
import {
  buildPublicationEvidence,
  decodeHexStrict,
  payloadMatchesRecord,
  sha256Hex,
} from "./verify-publication.js";

const NETWORK = { name: "rabdi", chainId: 7_794_095, chainIdHex: "0x76edaf" };
const RECEIPT = {
  status: "success" as const,
  blockNumber: 269_199,
  gasUsed: 209_105,
  effectiveGasPriceWei: "1000000000",
};

function input(overrides: Record<string, unknown> = {}) {
  const metadata = sampleMetadata();
  return {
    experimentId: metadata.experimentId,
    network: NETWORK,
    signer: SIGNER,
    entityKey: ENTITY_KEY,
    row: makeRow(),
    canonical: metadata,
    receipt: RECEIPT,
    foundByExperimentId: ENTITY_KEY,
    txHash: "0x" + "11".repeat(32),
    explorerBase: "https://rabdi.explorer.arkiv.network/",
    ...overrides,
  };
}

describe("buildPublicationEvidence", () => {
  it("verifies a fully matching publication and records the gas", async () => {
    const evidence = await buildPublicationEvidence(input());
    expect(evidence.verified).toBe(true);
    expect(evidence.byteIdenticalToCanonical).toBe(true);
    expect(evidence.payloadBytes).toBe(
      metadataToPayloadBytes(sampleMetadata()).length,
    );
    expect(evidence.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.gas).toEqual({
      gasUsed: 209_105,
      effectiveGasPriceWei: "1000000000",
      costWei: "209105000000000",
      costTglm: 0.000209105,
    });
    expect(evidence.checks.filter((check) => !check.ok)).toEqual([]);
    expect(evidence.explorer).toBe(
      `https://rabdi.explorer.arkiv.network/entity/${ENTITY_KEY}`,
    );
  });

  it("fails when a single payload byte differs from the canonical record", async () => {
    const canonical = metadataToPayloadBytes(sampleMetadata());
    const mutated = Uint8Array.from(canonical);
    mutated[10] = mutated[10] === 0x30 ? 0x31 : 0x30;
    const hex = `0x${Buffer.from(mutated).toString("hex")}`;
    const evidence = await buildPublicationEvidence(
      input({ row: makeRow({ payload: { type: "bytes", value: hex } }) }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.byteIdenticalToCanonical).toBe(false);
    expect(
      evidence.checks.find((c) => c.name.includes("byte-identical"))?.ok,
    ).toBe(false);
  });

  it("fails when the payload does not revalidate against the shared contract", async () => {
    const broken = `0x${Buffer.from('{"schemaVersion":"1.0"}').toString("hex")}`;
    const evidence = await buildPublicationEvidence(
      input({ row: makeRow({ payload: { type: "bytes", value: broken } }) }),
    );
    expect(evidence.payloadDecodesAsRecord).toBe(false);
    expect(evidence.revalidatesAgainstSharedSchema).toBe(false);
    expect(evidence.verified).toBe(false);
  });

  it("fails when the payload is not valid hex or not UTF-8", async () => {
    await expect(
      buildPublicationEvidence(
        input({ row: makeRow({ payload: { type: "bytes", value: "0xzz" } }) }),
      ),
    ).rejects.toThrow(/well-formed 0x-prefixed hex/);

    const invalidUtf8 = "0xfffe";
    const evidence = await buildPublicationEvidence(
      input({
        row: makeRow({ payload: { type: "bytes", value: invalidUtf8 } }),
      }),
    );
    expect(evidence.verified).toBe(false);
  });

  it("fails when owner differs from the signer", async () => {
    const other = "0x0000000000000000000000000000000000000001";
    const evidence = await buildPublicationEvidence(
      input({ row: makeRow({ $owner: other }) }),
    );
    expect(evidence.ownerEqualsSigner).toBe(false);
    expect(evidence.verified).toBe(false);
  });

  it("fails when the receipt was reverted and when no receipt exists", async () => {
    const reverted = await buildPublicationEvidence(
      input({ receipt: { ...RECEIPT, status: "reverted" as const } }),
    );
    expect(reverted.verified).toBe(false);
    expect(reverted.receiptStatus).toBe("reverted");

    const unknown = await buildPublicationEvidence(
      input({ receipt: undefined }),
    );
    expect(unknown.verified).toBe(false);
    expect(unknown.gas.gasUsed).toBeNull();
  });

  it("fails when a canonical record is not supplied, so identity is unknown", async () => {
    const evidence = await buildPublicationEvidence(
      input({ canonical: undefined }),
    );
    expect(evidence.byteIdenticalToCanonical).toBeNull();
    expect(evidence.verified).toBe(false);
  });

  it("fails when the entity is not findable by experimentId", async () => {
    const evidence = await buildPublicationEvidence(
      input({ foundByExperimentId: "0x" + "bb".repeat(32) }),
    );
    expect(evidence.findableByExperimentId).toBe(false);
    expect(evidence.verified).toBe(false);

    const unqueried = await buildPublicationEvidence(
      input({ foundByExperimentId: undefined }),
    );
    expect(unqueried.findableByExperimentId).toBeNull();
    expect(unqueried.verified).toBe(true);
  });

  it("fails when the entity key does not match the published key", async () => {
    const evidence = await buildPublicationEvidence(
      input({ entityKey: "0x" + "cc".repeat(32) }),
    );
    expect(evidence.verified).toBe(false);
    expect(evidence.checks.find((c) => c.name.includes("entity key"))?.ok).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("rejects odd-length and non-hex payloads", () => {
    expect(() => decodeHexStrict("0xabc")).toThrow();
    expect(() => decodeHexStrict("0xgg")).toThrow();
    expect(() => decodeHexStrict("0x")).toThrow();
    expect(() => decodeHexStrict("abcd")).toThrow();
  });

  it("hashes deterministically", async () => {
    const bytes = new TextEncoder().encode("blocklab");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes));
    expect(await sha256Hex(bytes)).toHaveLength(64);
  });

  it("compares payload bytes to a record", () => {
    expect(payloadMatchesRecord(payloadHex(), sampleMetadata())).toBe(true);
    const altered = makeRow({
      payload: { type: "bytes", value: payloadHex().slice(0, -2) + "00" },
    });
    const hex = altered.payload?.value;
    expect(
      hex === undefined ? false : payloadMatchesRecord(hex, sampleMetadata()),
    ).toBe(false);
  });
});
