import { describe, expect, it } from "vitest";
import {
  isRabdiChainId,
  RABDI_CHAIN_ID,
  RABDI_CHAIN_ID_HEX,
} from "../src/config.js";
import { classifyError } from "../src/wallet.js";

describe("classifyError", () => {
  it("maps a 4001 rejection to user-rejected", () => {
    const error = Object.assign(new Error("User rejected the request"), {
      code: 4001,
    });
    const classified = classifyError(error);
    expect(classified.category).toBe("user-rejected");
    expect(classified.message).toMatch(/rejected/);
  });

  it("maps HTTP/server/timing failures to network", () => {
    for (const message of [
      "request failed with status 503",
      "request failed with status 429",
      "fetch failed",
      "timeout exceeded",
      "the network is down",
    ]) {
      expect(classifyError(new Error(message)).category).toBe("network");
    }
  });

  it("surfaces an SDK-caused message as sdk", () => {
    const classified = classifyError(
      new Error("SchemaMismatchError: value does not fit"),
    );
    expect(classified.category).toBe("sdk");
  });

  it("falls back to unknown for non-errors", () => {
    expect(classifyError("boom").category).toBe("unknown");
  });
});

describe("chain id check", () => {
  it("recognises Rabdi exactly", () => {
    expect(isRabdiChainId(RABDI_CHAIN_ID_HEX)).toBe(true);
    expect(isRabdiChainId("0x76EDAF")).toBe(true);
    expect(isRabdiChainId("0x1")).toBe(false);
    expect(RABDI_CHAIN_ID).toBe(7_794_095);
  });
});
