import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLiveNetwork } from "./selftest.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeLiveNetwork", () => {
  it("fails with a named step when the network never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    await expect(probeLiveNetwork({ stepTimeoutMs: 30 })).rejects.toThrow(
      /probe step "chain-id" timed out after 30 ms/,
    );
  });

  it("reports each step through onStep before the call", async () => {
    const steps: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    await expect(
      probeLiveNetwork({
        stepTimeoutMs: 20,
        onStep: (step) => steps.push(step),
      }),
    ).rejects.toThrow(/timed out/);

    expect(steps).toEqual(["chain-id"]);
  });
});
