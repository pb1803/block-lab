import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareEvidence,
  createRpcBlackoutEvidence,
  type EvidenceComparison,
  EvidenceValidationError,
  type RpcBlackoutEvidence,
  readEvidence,
  replayConfiguration,
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
import { rpcBlackoutScenario, validateScenarioMode } from "@blocklab/scenarios";

export const CLI_VERSION = "0.1.0";
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
    supportedScenarios: ["rpc-blackout"],
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
  output("  blocklab runs list [--json]\n");
  output("  blocklab runs show <execution-id> [--json]\n");
  output("  blocklab report <execution-id> [--json]\n");
  output(
    "  blocklab replay <execution-id> --upstream <loopback-url> [options]\n",
  );
  output("  blocklab compare <execution-id-a> <execution-id-b> [--json]\n");
  output("  blocklab config [--json]\n\n");
  output(
    "Options: --evidence-dir, --port, --start-offset, --duration, --experiment-duration, --timeout, --json\n",
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
  output(`Configuration precedence: ${config.precedence.join(" > ")}\n`);
}

function evidencePath(directory: string, executionId: string): string {
  return join(directory, `${executionId}.json`);
}

async function loadRun(
  directory: string,
  executionId: string,
): Promise<RpcBlackoutEvidence> {
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
  readonly records: readonly RpcBlackoutEvidence[];
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
  const records: RpcBlackoutEvidence[] = [];
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
  evidence: RpcBlackoutEvidence,
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
    `Forwarded successes: ${metrics.successfulForwardedRequests}; injected failures: ${metrics.injectedBlackoutFailures}; upstream errors: ${metrics.upstreamErrors}\n`,
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

async function executeExperiment(
  directory: string,
  upstream: string,
  schedule: {
    readonly startOffsetMs: number;
    readonly durationMs: number;
    readonly experimentDurationMs: number;
  },
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RpcBlackoutEvidence> {
  validateScenarioMode(rpcBlackoutScenario, "local");
  let proxy: RpcProxy | undefined;
  let experimentStartedAt: string | undefined;
  const handle = startExecution(
    {
      scenarioId: "rpc-blackout",
      timeoutMs,
      target: upstream,
      parameters: schedule,
    },
    async (context) => {
      proxy = new RpcProxy({
        upstreamUrl: upstream,
        port,
        blackout: schedule,
        executionId: context.executionId,
        scenarioId: "rpc-blackout",
      });
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
      await request();
      await new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, schedule.startOffsetMs),
      );
      await request();
      await new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, schedule.durationMs),
      );
      if (!context.cancellationSignal.aborted) await request();
      return proxy.evidence;
    },
  );
  const onAbort = (): void => {
    handle.context.requestCancellation();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const result = await handle.result;
  signal?.removeEventListener("abort", onAbort);
  const records = Array.isArray(result.value)
    ? result.value
    : (proxy?.evidence ?? []);
  const evidence = createRpcBlackoutEvidence(
    {
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
    },
    schedule,
    records,
    {
      warnings:
        result.cleanupFailures.length > 0
          ? ["One or more cleanup handlers failed."]
          : [],
    },
  );
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
      stdout(`${JSON.stringify([rpcBlackoutScenario], null, 2)}\n`);
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
      const scenario =
        command === "test" ? parsed.positionals[1] : "rpc-blackout";
      if (scenario !== "rpc-blackout")
        throw new CliError("Only the rpc-blackout scenario is supported.");
      const upstream = requiredOption(parsed, "upstream");
      const source =
        command === "replay"
          ? await loadRun(directory, parsed.positionals[1] ?? "")
          : undefined;
      const replayedSchedule =
        source === undefined
          ? undefined
          : replayConfiguration(toReplayConfiguration(source)).configuration;
      const schedule = {
        startOffsetMs:
          replayedSchedule?.startOffsetMs ??
          integerOption(parsed, "start-offset", 100),
        durationMs:
          replayedSchedule?.durationMs ??
          integerOption(parsed, "duration", 200),
        experimentDurationMs:
          replayedSchedule?.experimentDurationMs ??
          integerOption(parsed, "experiment-duration", 400),
      };
      if (
        schedule.startOffsetMs + schedule.durationMs >
        schedule.experimentDurationMs
      ) {
        throw new CliError(
          "Blackout window must fit within experiment duration.",
        );
      }
      const evidence = await executeExperiment(
        directory,
        upstream,
        schedule,
        integerOption(parsed, "port", 0),
        integerOption(parsed, "timeout", schedule.experimentDurationMs + 1_000),
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
