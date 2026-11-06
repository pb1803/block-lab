import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApplicationProxy, runExperiment } from "./index.js";

const input = {
  evidenceDirectory: "C:\\evidence",
  upstream: "http://127.0.0.1:8545",
  scenario: "rpc-blackout" as const,
  schedule: {
    startOffsetMs: 0,
    durationMs: 1,
    experimentDurationMs: 10,
  },
  port: 0,
  timeoutMs: 100,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function proxy(
  options: { start?: () => Promise<void>; close?: () => Promise<void> } = {},
): ApplicationProxy {
  let started = false;
  const startedAt = new Date().toISOString();
  return {
    evidence: [],
    get experimentStartedAt() {
      return started ? startedAt : undefined;
    },
    get listeningAddress() {
      return started ? { url: "http://127.0.0.1:1" } : undefined;
    },
    start:
      options.start ??
      (async () => {
        started = true;
      }),
    close: options.close ?? (async () => undefined),
  };
}

function successfulWrite() {
  return vi.fn(async () => undefined);
}

describe("shared experiment application", () => {
  it("executes the controlled workload and persists one evidence record", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}"));
    const close = vi.fn(async () => undefined);
    const writeEvidence = successfulWrite();

    const evidence = await runExperiment(input, {
      createProxy: () => proxy({ close }),
      writeEvidence,
    });

    expect(evidence.scenarioId).toBe("rpc-blackout");
    expect(evidence.terminalState).toBe("completed");
    expect(close).toHaveBeenCalledTimes(1);
    expect(writeEvidence).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid RPC targets before starting a proxy", async () => {
    const createProxy = vi.fn(() => proxy());

    await expect(
      runExperiment(
        { ...input, upstream: "https://rpc.example" },
        { createProxy },
      ),
    ).rejects.toThrow("Only loopback targets are allowed");

    expect(createProxy).not.toHaveBeenCalled();
  });

  it("preserves proxy cleanup when startup fails", async () => {
    const writeEvidence = successfulWrite();
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => {
      throw new Error("proxy startup failed");
    });

    const evidence = await runExperiment(input, {
      createProxy: () => proxy({ start, close }),
      writeEvidence,
    });

    expect(evidence.terminalState).toBe("failed");
    expect(close).toHaveBeenCalledTimes(1);
    expect(writeEvidence).toHaveBeenCalledTimes(1);
  });

  it("surfaces evidence persistence failures after execution cleanup", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}"));
    const close = vi.fn(async () => undefined);
    const writeEvidence = vi.fn(async () => {
      throw new Error("evidence write failed");
    });

    await expect(
      runExperiment(input, {
        createProxy: () => proxy({ close }),
        writeEvidence,
      }),
    ).rejects.toThrow("evidence write failed");

    expect(close).toHaveBeenCalledTimes(1);
    expect(writeEvidence).toHaveBeenCalledTimes(1);
  });

  it("records cleanup failures without replacing the execution result", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}"));
    const writeEvidence = successfulWrite();
    const evidence = await runExperiment(input, {
      createProxy: () =>
        proxy({
          close: async () => {
            throw new Error("cleanup failed");
          },
        }),
      writeEvidence,
    });

    expect(evidence.terminalState).toBe("failed");
    expect(evidence.warnings).toContain("One or more cleanup handlers failed.");
  });
});
