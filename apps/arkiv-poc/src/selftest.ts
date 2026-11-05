/**
 * Read-only live network probe for the POC (self-test). It uses the real SDK
 * against the Rabdi public RPC: chain id, block number, block timing, and one
 * schema-tagged query. It signs nothing, writes nothing and never touches a
 * wallet.
 *
 * The public endpoint is heavily rate limited, so every call is bounded: a
 * stall becomes a named timeout error instead of a promise that never settles.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { ARKIV_ACCESS_KEY } from "./config.js";
import { experimentSchema } from "./entity/experiment-schema.js";

export type ProbeStep =
  | "chain-id"
  | "block-number"
  | "block-timing"
  | "schema-query";

export type NetworkProbeResult = {
  readonly chainId: number;
  readonly blockNumber: string;
  readonly currentBlock: string;
  readonly blockDurationSeconds: number;
  readonly schemaTag: string;
  readonly queryMatches: number;
};

export type ProbeOptions = {
  /** Per-call deadline. */
  readonly stepTimeoutMs?: number;
  /** Progress callback, used by the UI and the browser check. */
  readonly onStep?: (step: ProbeStep) => void;
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  step: ProbeStep,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`probe step "${step}" timed out after ${ms} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function probeLiveNetwork(
  options: ProbeOptions = {},
): Promise<NetworkProbeResult> {
  const stepTimeoutMs = options.stepTimeoutMs ?? 15_000;
  const chain = rabdi({ accessKey: ARKIV_ACCESS_KEY });
  // One attempt per call: a 429 must fail fast and visibly instead of waiting
  // out a long Retry-After.
  const client = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: stepTimeoutMs }),
  });

  const step = <T>(name: ProbeStep, call: () => Promise<T>): Promise<T> => {
    options.onStep?.(name);
    return withTimeout(call(), stepTimeoutMs, name);
  };

  const chainId = await step("chain-id", () => client.getChainId());
  const blockNumber = await step("block-number", () => client.getBlockNumber());
  const timing = await step("block-timing", () => client.getBlockTiming());
  const page = await step("schema-query", () =>
    client.select({ $key: true }).from(experimentSchema).limit(1).fetch(),
  );

  return {
    chainId,
    blockNumber: blockNumber.toString(),
    currentBlock: timing.currentBlock.toString(),
    blockDurationSeconds: timing.blockDuration,
    schemaTag: experimentSchema.tag?.value ?? "(untagged)",
    queryMatches: page.entities.length,
  };
}
