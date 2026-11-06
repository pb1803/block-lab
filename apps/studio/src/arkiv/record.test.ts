import { describe, expect, it } from "vitest";
import {
  arkivRecordFromRow,
  decodePayloadHex,
  findSensitiveContent,
  isExpiredAt,
  publicDisclosure,
  redactSensitive,
  verifyReadBack,
} from "./record.js";
import {
  makeRow,
  payloadHex,
  SIGNER,
  sampleMetadata,
} from "./test-fixtures.js";

describe("decodePayloadHex", () => {
  it("decodes canonical payloads, rejects invalid UTF-8 and invalid JSON", () => {
    const metadata = sampleMetadata();
    const text = decodePayloadHex(payloadHex(metadata));
    expect(JSON.parse(text).experimentId).toBe("poc-write-001");
    expect(() =>
      decodePayloadHex(`0x${Buffer.from([0xff, 0xfe]).toString("hex")}`),
    ).toThrow(/not valid UTF-8/);
    expect(() =>
      decodePayloadHex(`0x${Buffer.from("not json").toString("hex")}`),
    ).toThrow(/not valid JSON/);
  });
});

describe("arkivRecordFromRow", () => {
  it("accepts a valid row and surfaces the decoded record", () => {
    const result = arkivRecordFromRow(makeRow());
    expect(result.ok).toBe(true);
    expect(result.ok ? result.record.owner : "").toBe(SIGNER);
    expect(result.ok ? result.record.expiresAtBlock : 0n).toBe(571_599n);
    expect(result.ok ? result.record.metadata.status : "").toBe("passed");
  });

  it("rejects an entity without a payload", () => {
    const result = arkivRecordFromRow(makeRow({ payload: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("malformed-response");
  });

  it("rejects a malformed payload with a redacted message", () => {
    const result = arkivRecordFromRow(
      makeRow({
        payload: {
          type: "bytes",
          value: `0x${Buffer.from("{broken").toString("hex")}`,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("malformed-response");
  });

  it("rejects a schema-invalid record as validation failure", () => {
    const bad = { ...sampleMetadata(), status: "not-a-status" };
    const result = arkivRecordFromRow(
      makeRow({ payload: { type: "bytes", value: payloadHex(bad) } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("validation");
  });

  it("rejects a syntactically valid but non-canonical payload", () => {
    const bytes = Buffer.from(`  ${JSON.stringify(sampleMetadata())}`);
    const result = arkivRecordFromRow(
      makeRow({
        payload: { type: "bytes", value: `0x${bytes.toString("hex")}` },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("canonical");
  });
});

describe("redactSensitive", () => {
  it("redacts URL credentials, 64-hex values, and secret-shaped assignments", () => {
    expect(redactSensitive("https://user:pass@host/x")).toBe(
      "https://[redacted]@host/x",
    );
    expect(
      redactSensitive(
        "key 0x1111111111111111111111111111111111111111111111111111111111111111 x",
      ),
    ).toContain("0x[redacted-64hex]");
    expect(redactSensitive("Authorization: Bearer abc123")).toContain(
      "[redacted]",
    );
    expect(redactSensitive("mnemonic = alpha bravo")).toContain("[redacted]");
  });
});

describe("isExpiredAt", () => {
  it("treats the expiry block as passed when it is the current block", () => {
    expect(isExpiredAt(10n, 10n)).toBe(true);
    expect(isExpiredAt(10n, 9n)).toBe(false);
  });
});

describe("verifyReadBack", () => {
  it("verifies byte-identical storage", () => {
    const metadata = sampleMetadata();
    const result = arkivRecordFromRow(makeRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(verifyReadBack(metadata, result.record)).toEqual({
        verified: true,
      });
    }
  });

  it("fails on a differing payload", () => {
    const metadata = sampleMetadata();
    const result = arkivRecordFromRow(makeRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const changed = verifyReadBack(
        { ...metadata },
        { ...result.record, payloadJson: "{}" },
      );
      expect(changed.verified).toBe(false);
    }
  });
});

describe("publicDisclosure", () => {
  it("enumerates exactly what becomes public and keeps the honest digest caveat", () => {
    const lines = publicDisclosure(sampleMetadata());
    expect(
      lines.some((line) =>
        line.includes('Experiment identifier "poc-write-001"'),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("Evidence digest"))).toBe(true);
    const digestLine = lines.find((line) => line.startsWith("Evidence digest"));
    expect(digestLine).toBeDefined();
    // Honest wording: the digest alone does not make the execution trustworthy.
    expect(digestLine).toContain(
      "does not by itself make the execution trustworthy",
    );
  });
});

describe("findSensitiveContent", () => {
  it("flags credential-shaped content and clean URLs with credentials", () => {
    expect(findSensitiveContent(sampleMetadata())).toEqual([]);
    const leaked = { ...sampleMetadata(), scenarioName: "api_key=abc" };
    expect(findSensitiveContent(leaked)).toContain("api_key");
    const url = {
      ...sampleMetadata(),
      evidenceRef: "https://user:secret@host/x",
    };
    expect(findSensitiveContent(url)).toContain("credential-in-url");
  });
});
