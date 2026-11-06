import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BlackoutSchedule,
  type ConnectionFailureSchedule,
  compareEvidence,
  createRpcBlackoutEvidence,
  createRpcConnectionFailureEvidence,
  createRpcIntermittentFailureEvidence,
  createRpcLatencyEvidence,
  createRpcMalformedResponseEvidence,
  createRpcRateLimitEvidence,
  type EvidenceComparison,
  type EvidenceRecord,
  EvidenceValidationError,
  type IntermittentFailureSchedule,
  type LatencySchedule,
  type MalformedResponseSchedule,
  type ProxyEvidenceLike,
  type RateLimitSchedule,
  readEvidence,
  toJsonReport,
  toReplayConfiguration,
  writeEvidence,
} from "@blocklab/evidence";
import {
  InspectionError,
  type InspectionSummary,
  inspectProject,
} from "@blocklab/inspector";
import { RpcProxy, startExecution } from "@blocklab/runner";
import {
  rpcBlackoutScenario,
  rpcConnectionFailureScenario,
  rpcIntermittentFailureScenario,
  rpcLatencyScenario,
  rpcMalformedResponseScenario,
  rpcRateLimitScenario,
  validateScenarioMode,
} from "@blocklab/scenarios";

export const CLI_VERSION = "0.1.0";
export const SUPPORTED_SCENARIOS = [
  "rpc-blackout",
  "rpc-latency",
  "rpc-intermittent-failure",
  "rpc-rate-limit",
  "rpc-connection-failure",
  "rpc-malformed-response",
] as const;
export type SupportedScenario = (typeof SUPPORTED_SCENARIOS)[number];
export const EXIT_CODES = {
  success: 0,
  usage: 2,
  operation: 3,
  inconclusive: 4,
} as const;

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

export interface CliDependencies {
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface CliConfig {
  readonly evidenceDirectory: string;
  readonly defaultProxy: {
    readonly host: "127.0.0.1";
    readonly port: 0;
    readonly upstream: "required";
  };
  readonly supportedScenarios: readonly string[];
  readonly precedence: readonly string[];
}

const scenarioDefinitionMap = {
  "rpc-blackout": rpcBlackoutScenario,
  "rpc-latency": rpcLatencyScenario,
  "rpc-intermittent-failure": rpcIntermittentFailureScenario,
  "rpc-rate-limit": rpcRateLimitScenario,
  "rpc-connection-failure": rpcConnectionFailureScenario,
  "rpc-malformed-response": rpcMalformedResponseScenario,
} as const satisfies Record<SupportedScenario, typeof rpcBlackoutScenario>;

function isSupportedScenario(value: string): value is SupportedScenario {
  return value in scenarioDefinitionMap;
}

function scenarioDefinition(value: SupportedScenario) {
  return scenarioDefinitionMap[value];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals > 2) {
      options.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
    }
  }
  return { positionals, options };
}

function option(parsed: ParsedArgs, name: string): string | true | undefined {
  return parsed.options.get(name);
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = option(parsed, name);
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`Missing required option: --${name}.`);
  }
  return value;
}

function integerOption(
  parsed: ParsedArgs,
  name: string,
  defaultValue: number,
): number {
  const value = option(parsed, name);
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new CliError(`Option --${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function jsonRequested(parsed: ParsedArgs): boolean {
  return option(parsed, "json") === true;
}

function defaultEvidenceDirectory(): string {
  const override = process.env.BLOCKLAB_EVIDENCE_DIR;
  if (override !== undefined && override.trim() !== "")
    return resolve(override);
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "blocklab",
      "evidence",
    );
  }
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "blocklab",
      "evidence",
    );
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "blocklab",
    "evidence",
  );
}

export function getCliConfig(): CliConfig {
  return {
    evidenceDirectory: defaultEvidenceDirectory(),
    defaultProxy: { host: "127.0.0.1", port: 0, upstream: "required" },
    supportedScenarios: [...SUPPORTED_SCENARIOS],
    precedence: [
      "Command-line options",
      "BLOCKLAB_EVIDENCE_DIR for evidence storage only",
      "Platform default evidence directory",
    ],
  };
}

export class CliError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

function printHumanInspection(
  summary: InspectionSummary,
  output: (value: string) => void,
): void {
  output("BLOCKLAB inspection\n");
  output(`Root: ${summary.rootPath}\n`);
  output(
    `Package managers: ${summary.packageManagers.join(", ") || "none detected"}\n`,
  );
  output(
    `Detected stack: ${summary.detectedStack.join(", ") || "none detected"}\n`,
  );
  output(`Chain IDs: ${summary.chainIds.join(", ") || "none detected"}\n`);
  output(`Networks: ${summary.networkNames.join(", ") || "none detected"}\n`);
  output(
    `RPC references: ${summary.rpcReferences.join(", ") || "none detected"}\n`,
  );
  if (summary.packageManagerConflict)
    output("Warning: conflicting package manager lockfiles detected.\n");
  output("\nEvidence:\n");
  for (const finding of summary.dependencies) {
    output(
      `- ${finding.name} [${finding.type}; ${finding.confidence}] — ${finding.evidenceSource}: ${finding.evidence}\n`,
    );
  }
  if (summary.limitations.length > 0) {
    output("\nLimitations:\n");
    for (const limitation of summary.limitations) output(`- ${limitation}\n`);
  }
}

function printHelp(output: (value: string) => void): void {
  output(`BLOCKLAB ${CLI_VERSION}\n\n`);
  output("Usage:\n");
  output("  blocklab inspect [directory] [--json]\n");
  output("  blocklab test rpc-blackout --upstream <loopback-url> [options]\n");
  output("  blocklab test rpc-latency --upstream <loopback-url> [options]\n");
  output(
    "  blocklab test rpc-intermittent-failure --upstream <loopback-url> [options]\n",
  );
  output(
    "  blocklab test rpc-rate-limit --upstream <loopback-url> [options]\n",
  );
  output(
    "  blocklab test rpc-connection-failure --upstream <loopback-url> [options]\n",
  );
  output(
    "  blocklab test rpc-malformed-response --upstream <loopback-url> [options]\n",
  );
  output("  blocklab runs list [--json]\n");
  output("  blocklab runs show <execution-id> [--json]\n");
  output("  blocklab report <execution-id> [--json]\n");
  output(
    "  blocklab replay <execution-id> --upstream <loopback-url> [options]\n",
  );
  output("  blocklab compare <execution-id-a> <execution-id-b> [--json]\n");
  output("  blocklab config [--json]\n\n");
  output(
    "Options: --evidence-dir, --port, --delay, --fault-mode, --max-requests, --window-ms, --failure-duration, --recovery-interval, --window-count, --start-offset, --duration, --experiment-duration, --timeout, --json\n",
  );
  output(
    "\nAnon-RPC is browser-only: the CLI never imports or emulates the harness.\nRun the sample dApp (apps/sample-dapp) or Studio for Anon-RPC measurements.\n",
  );
}

function printConfig(
  config: CliConfig,
  json: boolean,
  output: (value: string) => void,
): void {
  if (json) {
    output(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  output(`Evidence directory: ${config.evidenceDirectory}\n`);
  output(
    `Proxy binding: ${config.defaultProxy.host}:${config.defaultProxy.port} (0 = ephemeral)\n`,
  );
  output(`Upstream: ${config.defaultProxy.upstream}\n`);
  output(`Supported scenarios: ${config.supportedScenarios.join(", ")}\n`);
  output(
    "Anon-RPC: browser-only integration; unavailable from the CLI and never simulated.\n",
  );
  output(`Configuration precedence: ${config.precedence.join(" > ")}\n`);
}

function evidencePath(directory: string, executionId: string): string {
  return join(directory, `${executionId}.json`);
}

async function loadRun(
  directory: string,
  executionId: string,
): Promise<EvidenceRecord> {
  if (!/^[0-9a-f-]{20,}$/i.test(executionId)) {
    throw new CliError("Execution ID is invalid.");
  }
  try {
    return await readEvidence(evidencePath(directory, executionId));
  } catch (error) {
    if (error instanceof EvidenceValidationError) {
      throw new CliError(
        `Could not load execution ${executionId}: ${error.message}`,
      );
    }
    throw error;
  }
}

async function listRuns(directory: string): Promise<{
  readonly records: readonly EvidenceRecord[];
  readonly malformed: readonly string[];
}> {
  let names: readonly string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { records: [], malformed: [] };
    }
    throw error;
  }
  const records: EvidenceRecord[] = [];
  const malformed: string[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      records.push(await readEvidence(join(directory, name)));
    } catch {
      malformed.push(name);
    }
  }
  return {
    records: records.sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt),
    ),
    malformed,
  };
}

function printEvaluation(
  evidence: EvidenceRecord,
  output: (value: string) => void,
): void {
  const metrics = evidence.evaluation.metrics;
  output(`Execution: ${evidence.executionId}\n`);
  output(`Scenario: ${evidence.scenarioId} ${evidence.scenarioVersion}\n`);
  output(`Started: ${evidence.startedAt}\n`);
  output(`Terminal state: ${evidence.terminalState}\n`);
  output(`Evaluation: ${evidence.evaluation.status.toUpperCase()}\n`);
  output(
    `Baseline: ${evidence.evaluation.baseline.status} — ${evidence.evaluation.baseline.explanation}\n`,
  );
  output(
    `Fault: ${evidence.evaluation.fault.status} — ${evidence.evaluation.fault.explanation}\n`,
  );
  output(
    `Recovery: ${evidence.evaluation.recovery.status} — ${evidence.evaluation.recovery.explanation}\n`,
  );
  output(
    `Requests: ${metrics.totalRequests} (baseline ${metrics.requestsByPhase.baseline}, fault ${metrics.requestsByPhase.fault}, recovery ${metrics.requestsByPhase.recovery})\n`,
  );
  output(
    `Forwarded successes: ${metrics.successfulForwardedRequests}; injected requests: ${metrics.injectedRequestCount}; blackout failures: ${metrics.injectedBlackoutFailures}; upstream errors: ${metrics.upstreamErrors}\n`,
  );
  output(
    `Latency: average ${metrics.averageLatencyMs ?? "n/a"}ms; median ${metrics.medianLatencyMs ?? "n/a"}ms\n`,
  );
  if (evidence.warnings.length > 0 || evidence.evaluation.warnings.length > 0) {
    output(
      `Warnings: ${[...evidence.warnings, ...evidence.evaluation.warnings].join(" | ")}\n`,
    );
  }
  output(`Limitations: ${evidence.limitations.join(" | ")}\n`);
}

type ScenarioSchedule =
  | {
      readonly startOffsetMs: number;
      readonly durationMs: number;
      readonly experimentDurationMs: number;
    }
  | {
      readonly delayMs: number;
      readonly startOffsetMs: number;
      readonly durationMs: number;
      readonly experimentDurationMs: number;
    }
  | {
      readonly startOffsetMs: number;
      readonly failureDurationMs: number;
      readonly recoveryIntervalMs: number;
      readonly windowCount: number;
      readonly experimentDurationMs?: number;
      readonly httpStatus?: number;
    }
  | {
      readonly maxRequests: number;
      readonly windowMs: number;
      readonly cooldownMs?: number;
      readonly retryAfterSeconds?: number;
      readonly experimentDurationMs?: number;
    }
  | {
      readonly faultMode: "connection-reset" | "premature-close";
      readonly startOffsetMs: number;
      readonly durationMs: number;
      readonly experimentDurationMs?: number;
    }
  | {
      readonly faultMode:
        | "invalid-json"
        | "missing-version"
        | "missing-result-and-error"
        | "missing-id"
        | "mismatched-id"
        | "invalid-structure";
      readonly startOffsetMs: number;
      readonly durationMs: number;
      readonly experimentDurationMs?: number;
    };

async function executeExperiment(
  directory: string,
  upstream: string,
  scenario: SupportedScenario,
  schedule: ScenarioSchedule,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<EvidenceRecord> {
  validateScenarioMode(scenarioDefinition(scenario), "local");
  let proxy: RpcProxy | undefined;
  let experimentStartedAt: string | undefined;
  const handle = startExecution(
    {
      scenarioId: scenario,
      timeoutMs,
      target: upstream,
      parameters: schedule,
    },
    async (context) => {
      let proxyConfig: ConstructorParameters<typeof RpcProxy>[0];
      switch (scenario) {
        case "rpc-blackout": {
          const blackoutSchedule = schedule as Extract<
            ScenarioSchedule,
            { startOffsetMs: number; durationMs: number }
          >;
          if ("delayMs" in blackoutSchedule) {
            throw new CliError(
              "Latency configuration cannot run as rpc-blackout.",
            );
          }
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            blackout: blackoutSchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        case "rpc-latency": {
          const latencySchedule = schedule as Extract<
            ScenarioSchedule,
            { delayMs: number }
          >;
          if (!("delayMs" in latencySchedule)) {
            throw new CliError("Latency configuration requires --delay.");
          }
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            latency: latencySchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        case "rpc-intermittent-failure": {
          const intermittentSchedule = schedule as Extract<
            ScenarioSchedule,
            { startOffsetMs: number; failureDurationMs: number }
          >;
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            intermittent: intermittentSchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        case "rpc-rate-limit": {
          const rateLimitSchedule = schedule as Extract<
            ScenarioSchedule,
            { maxRequests: number; windowMs: number }
          >;
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            rateLimit: rateLimitSchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        case "rpc-connection-failure": {
          const connectionFailureSchedule = schedule as Extract<
            ScenarioSchedule,
            { faultMode: "connection-reset" | "premature-close" }
          >;
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            connectionFailure: connectionFailureSchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        case "rpc-malformed-response": {
          const malformedResponseSchedule = schedule as Extract<
            ScenarioSchedule,
            { faultMode: string }
          >;
          proxyConfig = {
            upstreamUrl: upstream,
            port,
            malformed: malformedResponseSchedule,
            executionId: context.executionId,
            scenarioId: scenario,
          } as ConstructorParameters<typeof RpcProxy>[0];
          break;
        }
        default:
          throw new CliError(`Unsupported scenario: ${scenario}.`);
      }
      proxy = new RpcProxy(proxyConfig);
      await proxy.start();
      experimentStartedAt = proxy.experimentStartedAt;
      context.registerCleanup("rpc-proxy", () => proxy?.close());
      const address = proxy.listeningAddress;
      if (address === undefined) throw new CliError("Proxy did not start.");
      const request = (): Promise<Response> =>
        fetch(address.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
          signal: context.cancellationSignal,
        });
      const baselineDelay =
        "startOffsetMs" in schedule ? schedule.startOffsetMs : 0;
      const waitUntilElapsed = async (targetMs: number): Promise<void> => {
        const startedAtMs = Date.parse(
          experimentStartedAt ?? context.startedAt ?? new Date().toISOString(),
        );
        const remainingMs = targetMs - (Date.now() - startedAtMs);
        if (remainingMs > 0) {
          await new Promise<void>((resolvePromise) =>
            setTimeout(resolvePromise, remainingMs),
          );
        }
      };
      await request();
      if (scenario === "rpc-rate-limit") {
        const rateLimitSchedule = schedule as Extract<
          ScenarioSchedule,
          { maxRequests: number }
        >;
        for (
          let index = 0;
          index < Math.max(2, rateLimitSchedule.maxRequests);
          index += 1
        ) {
          await request();
        }
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, rateLimitSchedule.windowMs),
        );
        if (!context.cancellationSignal.aborted) await request();
      } else if (scenario === "rpc-intermittent-failure") {
        const intermittentSchedule = schedule as Extract<
          ScenarioSchedule,
          { failureDurationMs: number }
        >;
        await waitUntilElapsed(baselineDelay);
        for (
          let index = 0;
          index < intermittentSchedule.windowCount &&
          !context.cancellationSignal.aborted;
          index += 1
        ) {
          await request();
          await new Promise<void>((resolvePromise) =>
            setTimeout(resolvePromise, intermittentSchedule.failureDurationMs),
          );
          if (!context.cancellationSignal.aborted) await request();
          if (index + 1 < intermittentSchedule.windowCount) {
            await new Promise<void>((resolvePromise) =>
              setTimeout(
                resolvePromise,
                intermittentSchedule.recoveryIntervalMs,
              ),
            );
          }
        }
      } else {
        await waitUntilElapsed(baselineDelay);
        if (scenario === "rpc-connection-failure") {
          try {
            await request();
          } catch (error) {
            if (
              proxy.evidence.at(-1)?.outcome !== "injected_connection_failure"
            ) {
              throw error;
            }
          }
        } else {
          await request();
        }
        const faultDuration =
          "durationMs" in schedule
            ? schedule.durationMs
            : "failureDurationMs" in schedule
              ? schedule.failureDurationMs
              : 100;
        await new Promise<void>((resolvePromise) =>
          setTimeout(resolvePromise, faultDuration),
        );
        if (!context.cancellationSignal.aborted) await request();
      }
      return proxy.evidence;
    },
  );
  const onAbort = (): void => {
    handle.context.requestCancellation();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const result = await handle.result;
  signal?.removeEventListener("abort", onAbort);
  const records = (
    Array.isArray(result.value) ? result.value : (proxy?.evidence ?? [])
  ) as readonly ProxyEvidenceLike[];
  const execution = {
    executionId: result.executionId,
    state:
      result.state === "completed" ||
      result.state === "failed" ||
      result.state === "cancelled" ||
      result.state === "timed_out"
        ? result.state
        : "failed",
    ...(experimentStartedAt === undefined &&
    handle.context.startedAt === undefined
      ? {}
      : { startedAt: experimentStartedAt ?? handle.context.startedAt }),
    ...(handle.context.finishedAt === undefined
      ? {}
      : { finishedAt: handle.context.finishedAt }),
  } as const;
  const warnings =
    result.cleanupFailures.length > 0
      ? ["One or more cleanup handlers failed."]
      : [];
  const evidence = (() => {
    switch (scenario) {
      case "rpc-blackout": {
        const blackoutSchedule = schedule as BlackoutSchedule;
        if ("delayMs" in blackoutSchedule) {
          throw new CliError(
            "Latency configuration cannot create blackout evidence.",
          );
        }
        return createRpcBlackoutEvidence(execution, blackoutSchedule, records, {
          warnings,
        });
      }
      case "rpc-latency": {
        const latencySchedule = schedule as LatencySchedule;
        if (!("delayMs" in latencySchedule)) {
          throw new CliError("Latency evidence requires a delay.");
        }
        return createRpcLatencyEvidence(execution, latencySchedule, records, {
          warnings,
        });
      }
      case "rpc-intermittent-failure": {
        const intermittentSchedule = schedule as IntermittentFailureSchedule;
        return createRpcIntermittentFailureEvidence(
          execution,
          intermittentSchedule,
          records,
          { warnings },
        );
      }
      case "rpc-rate-limit": {
        const rateLimitSchedule = schedule as RateLimitSchedule;
        return createRpcRateLimitEvidence(
          execution,
          rateLimitSchedule,
          records,
          { warnings },
        );
      }
      case "rpc-connection-failure": {
        const connectionFailureSchedule = schedule as ConnectionFailureSchedule;
        return createRpcConnectionFailureEvidence(
          execution,
          connectionFailureSchedule,
          records,
          { warnings },
        );
      }
      case "rpc-malformed-response": {
        const malformedResponseSchedule = schedule as MalformedResponseSchedule;
        return createRpcMalformedResponseEvidence(
          execution,
          malformedResponseSchedule,
          records,
          { warnings },
        );
      }
      default:
        throw new CliError(`Unsupported scenario: ${scenario}.`);
    }
  })();
  await writeEvidence(evidencePath(directory, evidence.executionId), evidence);
  return evidence;
}

function printComparison(
  comparison: EvidenceComparison,
  output: (value: string) => void,
): void {
  output(`Comparable: ${comparison.comparable ? "yes" : "no"}\n`);
  if (comparison.differences.length > 0)
    output(`Differences: ${comparison.differences.join(", ")}\n`);
  output(
    `Evaluation: ${comparison.evaluation.left} -> ${comparison.evaluation.right}\n`,
  );
  for (const metric of comparison.metrics) {
    output(
      `${metric.name}: ${metric.left ?? "n/a"} -> ${metric.right ?? "n/a"}${metric.comparable ? "" : " (not comparable)"}\n`,
    );
  }
  for (const warning of comparison.warnings) output(`Warning: ${warning}\n`);
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout =
    dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const stderr =
    dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  const cwd = dependencies.cwd ?? process.cwd();
  const config = getCliConfig();
  const parsed = parseArgs(args);
  const json = jsonRequested(parsed);
  try {
    if (
      parsed.positionals[0] === "--version" ||
      option(parsed, "version") === true
    ) {
      stdout(`${CLI_VERSION}\n`);
      return EXIT_CODES.success;
    }
    if (
      parsed.positionals.length === 0 ||
      parsed.positionals[0] === "help" ||
      option(parsed, "help") === true
    ) {
      printHelp(stdout);
      return EXIT_CODES.success;
    }
    const command = parsed.positionals[0];
    if (command === "inspect") {
      const path = resolve(cwd, parsed.positionals[1] ?? ".");
      const summary = inspectProject(path);
      if (json) stdout(`${JSON.stringify(summary, null, 2)}\n`);
      else printHumanInspection(summary, stdout);
      return EXIT_CODES.success;
    }
    if (command === "config") {
      const evidenceOverride = option(parsed, "evidence-dir");
      const configured =
        typeof evidenceOverride === "string"
          ? { ...config, evidenceDirectory: resolve(cwd, evidenceOverride) }
          : config;
      printConfig(configured, json, stdout);
      return EXIT_CODES.success;
    }
    if (command === "scenarios") {
      stdout(
        `${JSON.stringify(
          [
            rpcBlackoutScenario,
            rpcLatencyScenario,
            rpcIntermittentFailureScenario,
            rpcRateLimitScenario,
            rpcConnectionFailureScenario,
            rpcMalformedResponseScenario,
          ],
          null,
          2,
        )}\n`,
      );
      return EXIT_CODES.success;
    }
    const evidenceDirectory = option(parsed, "evidence-dir");
    const directory =
      typeof evidenceDirectory === "string"
        ? resolve(cwd, evidenceDirectory)
        : config.evidenceDirectory;
    if (command === "runs") {
      const subcommand = parsed.positionals[1];
      if (subcommand !== "list" && subcommand !== "show")
        throw new CliError("Usage: blocklab runs list|show <execution-id>.");
      if (subcommand === "show") {
        const evidence = await loadRun(directory, parsed.positionals[2] ?? "");
        if (json) stdout(`${toJsonReport(evidence)}\n`);
        else printEvaluation(evidence, stdout);
        return evidence.evaluation.status === "inconclusive"
          ? EXIT_CODES.inconclusive
          : EXIT_CODES.success;
      }
      const listing = await listRuns(directory);
      if (json) stdout(`${JSON.stringify(listing.records, null, 2)}\n`);
      else if (listing.records.length === 0)
        stdout("No evidence runs found.\n");
      else
        for (const evidence of listing.records)
          stdout(
            `${evidence.executionId} ${evidence.startedAt} ${evidence.scenarioId} ${evidence.evaluation.status}\n`,
          );
      if (listing.malformed.length > 0)
        stderr(
          `Warning: skipped malformed evidence: ${listing.malformed.join(", ")}\n`,
        );
      return EXIT_CODES.success;
    }
    if (command === "report") {
      const evidence = await loadRun(directory, parsed.positionals[1] ?? "");
      if (json) stdout(`${toJsonReport(evidence)}\n`);
      else printEvaluation(evidence, stdout);
      return evidence.evaluation.status === "inconclusive"
        ? EXIT_CODES.inconclusive
        : EXIT_CODES.success;
    }
    if (command === "compare") {
      const left = await loadRun(directory, parsed.positionals[1] ?? "");
      const right = await loadRun(directory, parsed.positionals[2] ?? "");
      const comparison = compareEvidence(left, right);
      if (json) stdout(`${JSON.stringify(comparison, null, 2)}\n`);
      else printComparison(comparison, stdout);
      return EXIT_CODES.success;
    }
    if (command === "test" || command === "replay") {
      const upstream = requiredOption(parsed, "upstream");
      const source =
        command === "replay"
          ? await loadRun(directory, parsed.positionals[1] ?? "")
          : undefined;
      const scenario =
        command === "test" ? parsed.positionals[1] : source?.scenarioId;
      if (scenario === undefined || !isSupportedScenario(scenario))
        throw new CliError(
          `Supported scenarios are ${SUPPORTED_SCENARIOS.join(", ")}.`,
        );
      if (source !== undefined && source.scenarioId !== scenario)
        throw new CliError(
          "Replay scenario does not match the requested scenario.",
        );
      const replayedSchedule =
        source === undefined
          ? undefined
          : (() => {
              const config = toReplayConfiguration(source);
              return config.configuration;
            })();
      const schedule = (() => {
        switch (scenario) {
          case "rpc-blackout": {
            const replayed = replayedSchedule as
              | Partial<BlackoutSchedule>
              | undefined;
            return {
              startOffsetMs:
                replayed?.startOffsetMs ??
                integerOption(parsed, "start-offset", 100),
              durationMs:
                replayed?.durationMs ?? integerOption(parsed, "duration", 200),
              experimentDurationMs:
                replayed?.experimentDurationMs ??
                integerOption(parsed, "experiment-duration", 400),
            } as BlackoutSchedule;
          }
          case "rpc-latency": {
            const replayed = replayedSchedule as
              | Partial<LatencySchedule>
              | undefined;
            return {
              delayMs: replayed?.delayMs ?? integerOption(parsed, "delay", 100),
              startOffsetMs:
                replayed?.startOffsetMs ??
                integerOption(parsed, "start-offset", 100),
              durationMs:
                replayed?.durationMs ?? integerOption(parsed, "duration", 200),
              experimentDurationMs:
                replayed?.experimentDurationMs ??
                integerOption(parsed, "experiment-duration", 400),
            } as LatencySchedule;
          }
          case "rpc-intermittent-failure": {
            const replayed = replayedSchedule as
              | Partial<IntermittentFailureSchedule>
              | undefined;
            return {
              startOffsetMs:
                replayed?.startOffsetMs ??
                integerOption(parsed, "start-offset", 100),
              failureDurationMs:
                replayed?.failureDurationMs ??
                integerOption(parsed, "failure-duration", 100),
              recoveryIntervalMs:
                replayed?.recoveryIntervalMs ??
                integerOption(parsed, "recovery-interval", 150),
              windowCount:
                replayed?.windowCount ??
                integerOption(parsed, "window-count", 2),
              ...(replayed?.experimentDurationMs !== undefined
                ? { experimentDurationMs: replayed.experimentDurationMs }
                : {
                    experimentDurationMs: integerOption(
                      parsed,
                      "experiment-duration",
                      600,
                    ),
                  }),
              ...(replayed?.httpStatus !== undefined
                ? { httpStatus: replayed.httpStatus }
                : {}),
            } as IntermittentFailureSchedule;
          }
          case "rpc-rate-limit": {
            const replayed = replayedSchedule as
              | Partial<RateLimitSchedule>
              | undefined;
            return {
              maxRequests:
                replayed?.maxRequests ??
                integerOption(parsed, "max-requests", 2),
              windowMs:
                replayed?.windowMs ?? integerOption(parsed, "window-ms", 250),
              ...(replayed?.cooldownMs !== undefined
                ? { cooldownMs: replayed.cooldownMs }
                : {}),
              ...(replayed?.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: replayed.retryAfterSeconds }
                : {}),
              ...(replayed?.experimentDurationMs !== undefined
                ? { experimentDurationMs: replayed.experimentDurationMs }
                : {
                    experimentDurationMs: integerOption(
                      parsed,
                      "experiment-duration",
                      500,
                    ),
                  }),
            } as RateLimitSchedule;
          }
          case "rpc-connection-failure": {
            const replayed = replayedSchedule as
              | Partial<ConnectionFailureSchedule>
              | undefined;
            const requestedMode = option(parsed, "fault-mode");
            if (
              requestedMode !== undefined &&
              requestedMode !== "connection-reset" &&
              requestedMode !== "premature-close"
            ) {
              throw new CliError(
                "--fault-mode for rpc-connection-failure must be connection-reset or premature-close.",
              );
            }
            return {
              faultMode:
                replayed?.faultMode ?? requestedMode ?? "connection-reset",
              startOffsetMs:
                replayed?.startOffsetMs ??
                integerOption(parsed, "start-offset", 100),
              durationMs:
                replayed?.durationMs ?? integerOption(parsed, "duration", 200),
              ...(replayed?.experimentDurationMs !== undefined
                ? { experimentDurationMs: replayed.experimentDurationMs }
                : {
                    experimentDurationMs: integerOption(
                      parsed,
                      "experiment-duration",
                      500,
                    ),
                  }),
            } as ConnectionFailureSchedule;
          }
          case "rpc-malformed-response": {
            const replayed = replayedSchedule as
              | Partial<MalformedResponseSchedule>
              | undefined;
            const requestedMode = option(parsed, "fault-mode");
            const malformedModes: readonly MalformedResponseSchedule["faultMode"][] =
              [
                "invalid-json",
                "missing-version",
                "missing-result-and-error",
                "missing-id",
                "mismatched-id",
                "invalid-structure",
              ];
            if (
              requestedMode !== undefined &&
              (typeof requestedMode !== "string" ||
                !malformedModes.includes(
                  requestedMode as MalformedResponseSchedule["faultMode"],
                ))
            ) {
              throw new CliError(
                "--fault-mode for rpc-malformed-response must be a supported malformed-response mode.",
              );
            }
            return {
              faultMode:
                replayed?.faultMode ??
                (typeof requestedMode === "string"
                  ? (requestedMode as MalformedResponseSchedule["faultMode"])
                  : "invalid-json"),
              startOffsetMs:
                replayed?.startOffsetMs ??
                integerOption(parsed, "start-offset", 100),
              durationMs:
                replayed?.durationMs ?? integerOption(parsed, "duration", 200),
              ...(replayed?.experimentDurationMs !== undefined
                ? { experimentDurationMs: replayed.experimentDurationMs }
                : {
                    experimentDurationMs: integerOption(
                      parsed,
                      "experiment-duration",
                      500,
                    ),
                  }),
            } as MalformedResponseSchedule;
          }
          default:
            throw new CliError(`Unsupported scenario: ${scenario}.`);
        }
      })() as ScenarioSchedule;
      if (scenario === "rpc-blackout" || scenario === "rpc-latency") {
        const timingSchedule = schedule as Extract<
          ScenarioSchedule,
          { startOffsetMs: number; durationMs: number }
        >;
        if (
          timingSchedule.startOffsetMs + timingSchedule.durationMs >
          (timingSchedule.experimentDurationMs ??
            timingSchedule.startOffsetMs + timingSchedule.durationMs)
        ) {
          throw new CliError(
            "Fault window must fit within experiment duration.",
          );
        }
      }
      const evidence = await executeExperiment(
        directory,
        upstream,
        scenario,
        schedule,
        integerOption(parsed, "port", 0),
        integerOption(
          parsed,
          "timeout",
          (() => {
            if (
              "experimentDurationMs" in schedule &&
              schedule.experimentDurationMs !== undefined
            )
              return schedule.experimentDurationMs + 1_000;
            return 2_000;
          })(),
        ),
        dependencies.signal,
      );
      if (json) stdout(`${toJsonReport(evidence)}\n`);
      else {
        printEvaluation(evidence, stdout);
        outputEvidenceLocation(
          evidencePath(directory, evidence.executionId),
          stdout,
        );
        if (source !== undefined)
          stdout(`Replayed from: ${source.executionId}\n`);
      }
      return evidence.evaluation.status === "inconclusive"
        ? EXIT_CODES.inconclusive
        : EXIT_CODES.success;
    }
    throw new CliError(`Unknown command: ${command}.`);
  } catch (error) {
    if (error instanceof InspectionError) {
      stderr(`Error [${error.code}]: ${error.message}\n`);
      return EXIT_CODES.operation;
    }
    stderr(
      `Error: ${error instanceof Error ? error.message : "Operation failed."}\n`,
    );
    return error instanceof CliError ? EXIT_CODES.usage : EXIT_CODES.operation;
  }
}

function outputEvidenceLocation(
  path: string,
  output: (value: string) => void,
): void {
  output(`Evidence: ${path}\n`);
}
