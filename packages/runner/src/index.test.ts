import { describe, expect, it } from "vitest";
import {
  CleanupError,
  ExecutionCancelledError,
  ExecutionContext,
  ExecutionTimeoutError,
  InvalidTransitionError,
  PreflightError,
  preflightExecution,
  preflightRpcProxy,
  startExecution,
} from "./index.js";

const config = {
  scenarioId: "test-scenario",
  timeoutMs: 100,
};

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("execution state machine", () => {
  it("accepts valid transitions and rejects invalid transitions", () => {
    const context = new ExecutionContext(config);
    context.transition("preparing");
    context.transition("running");
    context.transition("completed");
    expect(() => context.transition("running")).toThrow(InvalidTransitionError);
  });

  it("records lifecycle timestamps in event order", async () => {
    let time = 1_700_000_000_000;
    const handle = startExecution(
      config,
      () => undefined,
      () => time++,
    );
    const result = await handle.result;
    const timestamps = result.events.map((event) =>
      Date.parse(event.timestamp),
    );
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(handle.context.startedAt).toBeDefined();
    expect(handle.context.finishedAt).toBeDefined();
  });

  it("prevents duplicate starts and repeated cancellation", () => {
    const context = new ExecutionContext(config);
    context.transition("preparing");
    context.transition("running");
    expect(() => context.transition("running")).toThrow(InvalidTransitionError);
    expect(context.requestCancellation()).toBe(true);
    expect(context.requestCancellation()).toBe(false);
  });
});

describe("execution lifecycle", () => {
  it("completes successfully and records ordered events", async () => {
    const handle = startExecution(config, async (context) => {
      context.registerCleanup("resource-a", () => undefined);
      return "ok";
    });
    const result = await handle.result;
    expect(result.state).toBe("completed");
    expect(result.events.map((event) => event.type)).toEqual([
      "execution.created",
      "preflight.started",
      "preflight.completed",
      "execution.started",
      "cleanup.started",
      "cleanup.handler.completed",
      "execution.completed",
    ]);
  });

  it("runs cleanup in reverse order and only once", async () => {
    const order: string[] = [];
    const handle = startExecution(config, async (context) => {
      context.registerCleanup("first", () => {
        order.push("first");
      });
      context.registerCleanup("second", () => {
        order.push("second");
      });
    });
    await handle.result;
    await handle.context.cleanup();
    expect(order).toEqual(["second", "first"]);
  });

  it("continues cleanup after a handler failure and preserves the primary error", async () => {
    const order: string[] = [];
    const handle = startExecution(config, async (context) => {
      context.registerCleanup("first", () => {
        order.push("first");
      });
      context.registerCleanup("failing", () => {
        order.push("failing");
        throw new Error("cleanup failed");
      });
      throw new Error("operation failed");
    });
    const result = await handle.result;
    expect(result.state).toBe("failed");
    expect(result.error).toEqual(new Error("operation failed"));
    expect(result.cleanupFailures).toHaveLength(1);
    expect(order).toEqual(["failing", "first"]);
    expect(result.error).not.toBeInstanceOf(CleanupError);
  });

  it("times out, aborts the context, and cleans up", async () => {
    const gate = deferred<void>();
    let cleaned = false;
    const handle = startExecution(
      { ...config, timeoutMs: 10 },
      async (context) => {
        context.registerCleanup("resource", () => {
          cleaned = true;
        });
        await gate.promise;
      },
    );
    const result = await handle.result;
    expect(result.state).toBe("timed_out");
    expect(result.error).toBeInstanceOf(ExecutionTimeoutError);
    expect(handle.context.cancellationSignal.aborted).toBe(true);
    expect(cleaned).toBe(true);
    gate.resolve();
  });

  it("supports explicit cancellation and distinguishes it from timeout", async () => {
    const gate = deferred<void>();
    const handle = startExecution(config, async () => gate.promise);
    await Promise.resolve();
    expect(handle.context.requestCancellation()).toBe(true);
    gate.resolve();
    const result = await handle.result;
    expect(result.state).toBe("cancelled");
    expect(result.error).toBeInstanceOf(ExecutionCancelledError);
  });

  it("uses the first competing terminal request", async () => {
    const gate = deferred<void>();
    const handle = startExecution(
      { ...config, timeoutMs: 1000 },
      async () => gate.promise,
    );
    expect(handle.context.requestCancellation()).toBe(true);
    expect(handle.context.triggerTimeout()).toBe(false);
    gate.resolve();
    const result = await handle.result;
    expect(result.state).toBe("cancelled");
  });
});

describe("runner preflight", () => {
  it("accepts loopback and rejects unsafe targets", () => {
    expect(() =>
      preflightExecution({ ...config, target: "http://127.0.0.1:8545" }),
    ).not.toThrow();
    expect(() =>
      preflightExecution({ ...config, target: "https://example.com" }),
    ).toThrow(PreflightError);
    expect(() =>
      preflightExecution({
        ...config,
        parameters: { privateKey: "not-allowed" },
      }),
    ).toThrow(PreflightError);
  });

  it("rejects malformed limits and disabled staging authorization", () => {
    expect(() => preflightExecution({ ...config, timeoutMs: 0 })).toThrow(
      PreflightError,
    );
    expect(() =>
      preflightExecution({
        ...config,
        target: "https://staging.example",
        authorization: {
          authorizationId: "auth-1",
          authorizedTarget: "https://staging.example",
          confirmedBy: "developer",
        },
      }),
    ).toThrow(/not enabled/);
  });

  it("rejects invalid latency schedules and accepts a bounded loopback schedule", () => {
    expect(() =>
      preflightRpcProxy({
        upstreamUrl: "http://127.0.0.1:8545",
        latency: { delayMs: 0, startOffsetMs: 0, durationMs: 10 },
      }),
    ).toThrow(PreflightError);
    expect(() =>
      preflightRpcProxy({
        upstreamUrl: "http://127.0.0.1:8545",
        latency: { delayMs: 25, startOffsetMs: 10, durationMs: 20 },
      }),
    ).not.toThrow();
  });

  it("rejects cleanup registration after cleanup begins", async () => {
    const context = new ExecutionContext(config);
    await context.cleanup();
    expect(() => context.registerCleanup("late", () => undefined)).toThrow(
      /cleanup has started/,
    );
  });
});
