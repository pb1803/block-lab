import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
import { Writable } from "node:stream";
import { type ExperimentSchedule, runExperiment } from "@blocklab/application";
import {
  type BlackoutSchedule,
  type ConnectionFailureSchedule,
  compareEvidence,
  type EvidenceComparison,
  type EvidenceRecord,
  EvidenceValidationError,
  type IntermittentFailureSchedule,
  type LatencySchedule,
  type MalformedResponseSchedule,
  type RateLimitSchedule,
  readEvidence,
  toJsonReport,
  toReplayConfiguration,
} from "@blocklab/evidence";
import {
  InspectionError,
  type InspectionSummary,
  inspectProject,
} from "@blocklab/inspector";
import { createLocalAgent, projectIdForPath } from "@blocklab/local-agent";
import {
  rpcBlackoutScenario,
  rpcConnectionFailureScenario,
  rpcIntermittentFailureScenario,
  rpcLatencyScenario,
  rpcMalformedResponseScenario,
  rpcRateLimitScenario,
} from "@blocklab/scenarios";

export const CLI_VERSION = "0.2.0";
export const STUDIO_ORIGIN = "https://block-lab-eight.vercel.app";
export const SUPPORTED_SCENARIOS = [
  "rpc-blackout",
  "rpc-latency",
  "rpc-intermittent-failure",
  "rpc-rate-limit",
  "rpc-connection-failure",
  "rpc-malformed-response",
] as const;
export type SupportedScenario = (typeof SUPPORTED_SCENARIOS)[number];
export const SCENARIO_DESCRIPTIONS: Readonly<
  Record<SupportedScenario, string>
> = {
  "rpc-blackout": "Controlled RPC outage",
  "rpc-latency": "Deterministic response delay",
  "rpc-intermittent-failure": "Periodic failure windows",
  "rpc-rate-limit": "Quota and rate-limit enforcement",
  "rpc-connection-failure": "Socket reset or premature close",
  "rpc-malformed-response": "Invalid JSON-RPC response shapes",
};
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
  readonly interactive?: boolean;
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

function isSupportedScenario(value: string): value is SupportedScenario {
  return SUPPORTED_SCENARIOS.includes(value as SupportedScenario);
}

export function validateRpcUrl(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" &&
      (!/^\d+$/.test(url.port) ||
        Number(url.port) < 1 ||
        Number(url.port) > 65535))
  ) {
    return undefined;
  }
  return value;
}

function detectProjectDirectory(startPath: string): string | undefined {
  let current = resolve(startPath);
  for (;;) {
    if (
      [
        "package.json",
        "foundry.toml",
        "hardhat.config.ts",
        "hardhat.config.js",
      ].some((name) => existsSync(join(current, name)))
    ) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) return undefined;
    current = parent;
  }
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

function optionValues(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === `--${name}`) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new CliError(`Missing value for --${name}.`);
      values.push(value);
      index += 1;
    } else if (arg?.startsWith(`--${name}=`)) {
      const value = arg.slice(name.length + 3);
      if (value.length === 0)
        throw new CliError(`Missing value for --${name}.`);
      values.push(value);
    }
  }
  return values;
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
  output("  blocklab version\n");
  output("  blocklab scenarios [--json]\n");
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
  output("  blocklab studio <execution-id> [project-directory]\n");
  output(
    "  blocklab replay <execution-id> --upstream <loopback-url> [options]\n",
  );
  output("  blocklab compare <execution-id-a> <execution-id-b> [--json]\n");
  output("  blocklab config [--json]\n\n");
  output(
    "  blocklab agent start <project-directory> [--allowed-origin <origin>]...\n",
  );
  output(
    "Options: --evidence-dir, --port, --delay, --fault-mode, --max-requests, --window-ms, --failure-duration, --recovery-interval, --window-count, --start-offset, --duration, --experiment-duration, --timeout, --json\n",
  );
  output(
    "\nAnon-RPC is browser-only: the CLI never imports or emulates the harness.\nRun the sample dApp (apps/sample-dapp) or Studio for Anon-RPC measurements.\n",
  );
}

export function studioReportUrl(
  projectId: string,
  executionId: string,
  launch?: { readonly endpoint: string; readonly bootstrapToken: string },
): string {
  const fragment = `#/experiments/${encodeURIComponent(projectId)}/${encodeURIComponent(executionId)}`;
  if (launch === undefined) return `${STUDIO_ORIGIN}/${fragment}`;
  const parameters = new URLSearchParams({
    agent: launch.endpoint,
    bootstrap: launch.bootstrapToken,
  });
  return `${STUDIO_ORIGIN}/${fragment}?${parameters.toString()}`;
}

function openExternalUrl(url: string): void {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const interactiveItems = [
  "Run an RPC resilience experiment",
  "View previous experiments",
  "Compare experiments",
  "Replay experiment",
  "Inspect project",
  "Custom Configuration",
  "Help and Exit",
] as const;

async function prompt(
  question: string,
  input: import("node:stream").Readable,
  output: (value: string) => void,
): Promise<string> {
  const reader = createInterface({
    input,
    output: new Writable({
      write(chunk, _encoding, callback) {
        output(String(chunk));
        callback();
      },
    }),
  });
  return new Promise<string>((resolveAnswer, rejectAnswer) => {
    const finish = (callback: () => void): void => {
      reader.close();
      callback();
    };
    reader.once("SIGINT", () =>
      finish(() => rejectAnswer(new CliCancelledError())),
    );
    reader.question(question, (answer) =>
      finish(() => resolveAnswer(answer.trim())),
    );
  });
}

function printBanner(output: (value: string) => void): void {
  output("\nBLOCKLAB — RPC RESILIENCE PLATFORM\n\n");
}

class CliCancelledError extends Error {
  public constructor() {
    super("Interactive operation cancelled.");
    this.name = "CliCancelledError";
  }
}

async function selectMenu(
  title: string,
  items: readonly string[],
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<number | undefined> {
  let selected = 0;
  return new Promise<number | undefined>((resolveMenu, rejectMenu) => {
    const render = (): void => {
      output(`\n${title}\n`);
      for (const [index, item] of items.entries())
        output(`${index === selected ? "❯" : " "} ${item}\n`);
      output("\nUse arrows, Enter to select, Escape to go back.\n");
    };
    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      if (input.isTTY === true) input.setRawMode(false);
    };
    const onKeypress = (
      _value: string,
      key: { name?: string; ctrl?: boolean },
    ): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        rejectMenu(new CliCancelledError());
      } else if (key.name === "up") {
        selected = (selected + items.length - 1) % items.length;
        render();
      } else if (key.name === "down") {
        selected = (selected + 1) % items.length;
        render();
      } else if (key.name === "escape") {
        cleanup();
        resolveMenu(undefined);
      } else if (key.name === "return") {
        cleanup();
        resolveMenu(selected);
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

async function promptRequired(
  question: string,
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<string> {
  for (;;) {
    const value = await prompt(question, input, output);
    if (value.length > 0) return value;
    output("A value is required. Please try again.\n");
  }
}

async function promptRpcUrl(
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<string> {
  for (;;) {
    const value = await prompt("Loopback RPC URL: ", input, output);
    const validated = validateRpcUrl(value);
    if (validated !== undefined) return validated;
    output("Invalid RPC URL. Example: http://127.0.0.1:8545\n");
  }
}

async function promptInteger(
  question: string,
  defaultValue: number,
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<string> {
  for (;;) {
    const value = await prompt(
      `${question} [${defaultValue}]: `,
      input,
      output,
    );
    if (value.length === 0) return String(defaultValue);
    if (/^[1-9]\d*$/.test(value)) return value;
    output("Enter a positive integer.\n");
  }
}

const parameterHelp: Readonly<Record<string, string>> = {
  delay: "milliseconds added to responses during the fault",
  "start-offset": "milliseconds before the fault starts",
  duration: "milliseconds the fault remains active",
  "experiment-duration": "total experiment time in milliseconds",
  "failure-duration": "milliseconds each failure window lasts",
  "recovery-interval": "milliseconds between failure windows",
  "window-count": "number of intermittent failure windows",
  "max-requests": "requests allowed in the rate-limit window",
  "window-ms": "rate-limit window length in milliseconds",
};

async function promptChoice(
  question: string,
  choices: readonly string[],
  defaultValue: string,
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<string> {
  for (;;) {
    const value = await prompt(
      `${question} (${choices.join(", ")}) [${defaultValue}]: `,
      input,
      output,
    );
    const selected = value || defaultValue;
    if (choices.includes(selected)) return selected;
    output(`Choose one of: ${choices.join(", ")}.\n`);
  }
}

async function interactiveScenarioArgs(
  scenario: SupportedScenario,
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<string[]> {
  const args: string[] = [];
  const integer = async (
    label: string,
    defaultValue: number,
  ): Promise<void> => {
    const description = parameterHelp[label];
    args.push(
      `--${label}`,
      await promptInteger(
        description === undefined ? label : `${label} — ${description}`,
        defaultValue,
        input,
        output,
      ),
    );
  };
  switch (scenario) {
    case "rpc-blackout":
      await integer("start-offset", 100);
      await integer("duration", 200);
      await integer("experiment-duration", 400);
      break;
    case "rpc-latency":
      await integer("delay", 100);
      await integer("start-offset", 100);
      await integer("duration", 200);
      await integer("experiment-duration", 400);
      break;
    case "rpc-intermittent-failure":
      await integer("start-offset", 100);
      await integer("failure-duration", 100);
      await integer("recovery-interval", 150);
      await integer("window-count", 2);
      await integer("experiment-duration", 600);
      break;
    case "rpc-rate-limit":
      await integer("max-requests", 2);
      await integer("window-ms", 250);
      await integer("experiment-duration", 500);
      break;
    case "rpc-connection-failure":
      args.push(
        "--fault-mode",
        await promptChoice(
          "Fault mode",
          ["connection-reset", "premature-close"],
          "connection-reset",
          input,
          output,
        ),
      );
      await integer("start-offset", 100);
      await integer("duration", 200);
      await integer("experiment-duration", 500);
      break;
    case "rpc-malformed-response":
      args.push(
        "--fault-mode",
        await promptChoice(
          "Fault mode",
          [
            "invalid-json",
            "missing-version",
            "missing-result-and-error",
            "missing-id",
            "mismatched-id",
            "invalid-structure",
          ],
          "invalid-json",
          input,
          output,
        ),
      );
      await integer("start-offset", 100);
      await integer("duration", 200);
      await integer("experiment-duration", 500);
      break;
  }
  return args;
}

function interactiveOption(
  args: readonly string[],
  name: string,
): number | undefined {
  const index = args.indexOf(`--${name}`);
  const value = args[index + 1];
  return value === undefined ? undefined : Number(value);
}

function validInteractiveSchedule(
  scenario: SupportedScenario,
  args: readonly string[],
): boolean {
  const start = interactiveOption(args, "start-offset");
  const duration = interactiveOption(args, "duration");
  const experimentDuration = interactiveOption(args, "experiment-duration");
  if (
    start !== undefined &&
    duration !== undefined &&
    experimentDuration !== undefined &&
    start + duration > experimentDuration
  )
    return false;
  if (scenario === "rpc-intermittent-failure") {
    const failure = interactiveOption(args, "failure-duration");
    const recovery = interactiveOption(args, "recovery-interval");
    const count = interactiveOption(args, "window-count");
    if (
      start !== undefined &&
      failure !== undefined &&
      recovery !== undefined &&
      count !== undefined &&
      experimentDuration !== undefined &&
      start + count * failure + Math.max(0, count - 1) * recovery >
        experimentDuration
    )
      return false;
  }
  return true;
}

const scenarioMenuItems = SUPPORTED_SCENARIOS.map(
  (scenario) => `${scenario} — ${SCENARIO_DESCRIPTIONS[scenario]}`,
);

type QuickRunSchedule = Readonly<Record<string, number | string>>;

const QUICK_RUN_DEFAULTS: Readonly<
  Record<SupportedScenario, QuickRunSchedule>
> = {
  "rpc-blackout": {
    "start-offset": 100,
    duration: 200,
    "experiment-duration": 400,
  },
  "rpc-latency": {
    delay: 100,
    "start-offset": 100,
    duration: 200,
    "experiment-duration": 400,
  },
  "rpc-intermittent-failure": {
    "start-offset": 100,
    "failure-duration": 100,
    "recovery-interval": 150,
    "window-count": 2,
    "experiment-duration": 600,
  },
  "rpc-rate-limit": {
    "max-requests": 2,
    "window-ms": 250,
    "experiment-duration": 500,
  },
  "rpc-connection-failure": {
    "fault-mode": "connection-reset",
    "start-offset": 100,
    duration: 200,
    "experiment-duration": 400,
  },
  "rpc-malformed-response": {
    "fault-mode": "invalid-json",
    "start-offset": 100,
    duration: 200,
    "experiment-duration": 400,
  },
};

function quickRunArgs(scenario: SupportedScenario): string[] {
  return Object.entries(QUICK_RUN_DEFAULTS[scenario]).flatMap(
    ([name, value]) => [`--${name}`, String(value)],
  );
}

async function rpcResponds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

interface ManagedRpc {
  readonly url: string;
  readonly process?: ChildProcess;
}

async function resolveQuickRunRpc(
  output: (value: string) => void,
): Promise<ManagedRpc> {
  for (const port of [8545, 8546, 9545]) {
    const url = `http://127.0.0.1:${port}`;
    if (await rpcResponds(url)) return { url };
  }
  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookup = spawn(command, ["anvil"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const available = await new Promise<boolean>((resolveLookup) => {
    lookup.once("close", (code) => resolveLookup(code === 0));
    lookup.once("error", () => resolveLookup(false));
  });
  if (!available) {
    throw new CliError(
      "No loopback RPC is running. Start Anvil (`anvil --host 127.0.0.1 --port 8545`) and run BlockLab again.",
    );
  }
  const managed = spawn("anvil", ["--host", "127.0.0.1", "--port", "8545"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const url = "http://127.0.0.1:8545";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await rpcResponds(url)) {
      output("Started a BlockLab-owned Anvil node on 127.0.0.1:8545.\n");
      return { url, process: managed };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  managed.kill();
  throw new CliError("Managed Anvil did not become ready within 2 seconds.");
}

async function interactiveExplore(
  directory: string,
  input: NodeJS.ReadStream,
  output: (value: string) => void,
): Promise<void> {
  const listing = await listRuns(directory);
  if (listing.records.length === 0) {
    output("No evidence runs found. Run an experiment to create a report.\n");
    if (listing.malformed.length > 0)
      output(`Unreadable evidence: ${listing.malformed.join(", ")}\n`);
    return;
  }
  if (listing.malformed.length > 0)
    output(
      `Warning: skipped malformed evidence: ${listing.malformed.join(", ")}\n`,
    );
  const labels = listing.records.map(
    (evidence) =>
      `${evidence.executionId} — ${evidence.scenarioId} — ${evidence.evaluation.status} — ${evidence.startedAt}`,
  );
  const selected = await selectMenu(
    "Previous experiments",
    labels,
    input,
    output,
  );
  if (selected === undefined) return;
  const evidence = listing.records[selected];
  if (evidence === undefined) return;
  output("\nSelected report:\n");
  printEvaluation(evidence, output);
}

async function handoffReport(
  projectDirectory: string,
  evidence: EvidenceRecord,
  evidenceDirectory: string,
  dependencies: CliDependencies,
  output: (value: string) => void,
): Promise<void> {
  const projectId = projectIdForPath(projectDirectory);
  const agent = await createLocalAgent({
    projectPaths: [projectDirectory],
    evidenceDirectories: [evidenceDirectory],
    allowedOrigins: [STUDIO_ORIGIN],
    bootstrapProjectId: projectId,
  });
  if (agent.bootstrapToken === undefined) {
    await agent.close();
    throw new Error(
      "Local Agent failed to create a Studio launch authorization.",
    );
  }
  const launchUrl = studioReportUrl(projectId, evidence.executionId, {
    endpoint: agent.url,
    bootstrapToken: agent.bootstrapToken,
  });
  const displayUrl = studioReportUrl(projectId, evidence.executionId);
  output(`\nLocal Agent started at ${agent.url}\n`);
  output(`Studio report: ${displayUrl}\n`);
  output(
    "Studio will connect automatically using a short-lived, project-scoped launch authorization. The Local Agent remains loopback-only and inspect-only.\n",
  );
  try {
    openExternalUrl(launchUrl);
    output("Opened Studio in your default browser.\n");
  } catch {
    output("Could not open a browser; use the Studio URL above.\n");
  }
  if (dependencies.signal?.aborted === true) {
    await agent.close();
    return;
  }
  await new Promise<void>((resolveAgent) => {
    dependencies.signal?.addEventListener(
      "abort",
      () => {
        void agent.close().then(resolveAgent, resolveAgent);
      },
      { once: true },
    );
  });
}

async function runInteractive(
  dependencies: CliDependencies,
  cwd: string,
): Promise<number> {
  const output =
    dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const input = process.stdin;
  const isRaw = input.isTTY === true;
  if (!isRaw) {
    output(
      "Interactive mode requires a TTY. Use `blocklab --help` for commands.\n",
    );
    return EXIT_CODES.usage;
  }
  printBanner(output);
  let sessionProject = detectProjectDirectory(cwd);
  try {
    for (;;) {
      const selected = await selectMenu(
        "What would you like to do?",
        interactiveItems,
        input,
        output,
      );
      if (selected === undefined) return EXIT_CODES.success;
      const run = async (
        command: readonly string[],
        commandCwd = cwd,
      ): Promise<number> =>
        runCli(command, {
          ...dependencies,
          cwd: commandCwd,
          interactive: false,
        });
      switch (interactiveItems[selected]) {
        case "Inspect project": {
          if (sessionProject === undefined)
            sessionProject = await promptRequired(
              `Project directory [${cwd}]: `,
              input,
              output,
            );
          await run(["inspect"], sessionProject);
          break;
        }
        case "Run an RPC resilience experiment": {
          if (sessionProject === undefined)
            sessionProject = await promptRequired(
              `Project directory [${cwd}]: `,
              input,
              output,
            );
          const scenarioIndex = await selectMenu(
            "Select a scenario",
            scenarioMenuItems,
            input,
            output,
          );
          if (scenarioIndex === undefined) break;
          const scenario = SUPPORTED_SCENARIOS[scenarioIndex];
          if (scenario === undefined) break;
          const scenarioArgs = quickRunArgs(scenario);
          const managedRpc = await resolveQuickRunRpc(output);
          const command = [
            "test",
            scenario,
            "--upstream",
            managedRpc.url,
            ...scenarioArgs,
          ];
          output(
            `\nQuick Run:\n  Project: ${sessionProject}\n  Upstream: ${managedRpc.url}\n  Scenario: ${scenario} — ${SCENARIO_DESCRIPTIONS[scenario]}\n`,
          );
          try {
            const confirmation = await promptChoice(
              "Execute experiment?",
              ["yes", "no"],
              "no",
              input,
              output,
            );
            if (confirmation === "yes") {
              output("Running experiment...\n");
              const result = await run(command, sessionProject);
              if (result === EXIT_CODES.success) {
                output("Experiment completed.\n");
                const latest = (
                  await listRuns(getCliConfig().evidenceDirectory)
                ).records.at(-1);
                if (latest !== undefined) {
                  output("\nGenerated report:\n");
                  printEvaluation(latest, output);
                  await handoffReport(
                    sessionProject,
                    latest,
                    getCliConfig().evidenceDirectory,
                    dependencies,
                    output,
                  );
                }
              }
            } else output("Experiment cancelled; no evidence was created.\n");
          } finally {
            managedRpc.process?.kill();
          }
          break;
        }
        case "View previous experiments":
          await interactiveExplore(
            getCliConfig().evidenceDirectory,
            input,
            output,
          );
          break;
        case "Compare experiments": {
          const left = await prompt("First run ID: ", input, output);
          const right = await prompt("Second run ID: ", input, output);
          await run(["compare", left, right]);
          break;
        }
        case "Replay experiment": {
          const runId = await prompt("Run ID: ", input, output);
          const upstream = await prompt(
            "Loopback upstream URL: ",
            input,
            output,
          );
          await run(["replay", runId, "--upstream", upstream]);
          break;
        }
        case "Custom Configuration": {
          if (sessionProject === undefined)
            sessionProject = await promptRequired(
              `Project directory [${cwd}]: `,
              input,
              output,
            );
          const upstream = await promptRpcUrl(input, output);
          const scenarioIndex = await selectMenu(
            "Select a scenario",
            scenarioMenuItems,
            input,
            output,
          );
          if (scenarioIndex === undefined) break;
          const scenario = SUPPORTED_SCENARIOS[scenarioIndex];
          if (scenario === undefined) break;
          let scenarioArgs: string[];
          for (;;) {
            scenarioArgs = await interactiveScenarioArgs(
              scenario,
              input,
              output,
            );
            if (validInteractiveSchedule(scenario, scenarioArgs)) break;
            output(
              "The fault window does not fit within the experiment duration. Please enter the parameters again.\n",
            );
          }
          await run(
            ["test", scenario, "--upstream", upstream, ...scenarioArgs],
            sessionProject,
          );
          break;
        }
        case "Help and Exit":
          await run(["help"]);
          return EXIT_CODES.success;
      }
    }
  } catch (error) {
    if (error instanceof CliCancelledError) {
      output("\nInteractive operation cancelled.\n");
      return EXIT_CODES.success;
    }
    throw error;
  }
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

type ScenarioSchedule = ExperimentSchedule;

async function executeExperiment(
  directory: string,
  upstream: string,
  scenario: SupportedScenario,
  schedule: ScenarioSchedule,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<EvidenceRecord> {
  return runExperiment({
    evidenceDirectory: directory,
    upstream,
    scenario,
    schedule,
    port,
    timeoutMs,
    ...(signal === undefined ? {} : { signal }),
  });
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
      parsed.positionals[0] === "version" ||
      option(parsed, "version") === true
    ) {
      stdout(`${CLI_VERSION}\n`);
      return EXIT_CODES.success;
    }
    if (parsed.positionals.length === 0) {
      if (
        dependencies.interactive !== false &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true
      ) {
        return runInteractive(dependencies, cwd);
      }
      printHelp(stdout);
      return EXIT_CODES.success;
    }
    if (parsed.positionals[0] === "help" || option(parsed, "help") === true) {
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
      const scenarios = [
        rpcBlackoutScenario,
        rpcLatencyScenario,
        rpcIntermittentFailureScenario,
        rpcRateLimitScenario,
        rpcConnectionFailureScenario,
        rpcMalformedResponseScenario,
      ];
      if (json) stdout(`${JSON.stringify(scenarios, null, 2)}\n`);
      else {
        stdout("Supported local scenarios:\n");
        for (const scenario of scenarios) {
          stdout(
            `- ${scenario.scenarioId} (${scenario.version}) — ${scenario.name}: ${scenario.description}\n`,
          );
        }
        stdout("All scenarios require an explicit loopback RPC upstream.\n");
      }
      return EXIT_CODES.success;
    }
    if (command === "agent") {
      if (parsed.positionals[1] !== "start" || parsed.positionals.length < 3)
        throw new CliError(
          "Usage: blocklab agent start <explicit-project-directory> [--allowed-origin <origin>]...",
        );
      const projectDirectory = resolve(cwd, parsed.positionals[2] ?? "");
      const allowedOrigins = optionValues(args, "allowed-origin");
      return await startAgent(
        projectDirectory,
        config.evidenceDirectory,
        allowedOrigins,
        dependencies,
        stdout,
      );
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
    if (command === "studio") {
      const executionId = parsed.positionals[1];
      if (executionId === undefined)
        throw new CliError(
          "Usage: blocklab studio <execution-id> [project-directory].",
        );
      const projectDirectory = resolve(cwd, parsed.positionals[2] ?? ".");
      const evidence = await loadRun(directory, executionId);
      await handoffReport(
        projectDirectory,
        evidence,
        directory,
        dependencies,
        stdout,
      );
      return EXIT_CODES.success;
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

async function startAgent(
  projectDirectory: string,
  evidenceDirectory: string,
  allowedOrigins: readonly string[],
  dependencies: CliDependencies,
  output: (value: string) => void,
): Promise<number> {
  const agent = await createLocalAgent({
    projectPaths: [projectDirectory],
    evidenceDirectories: [evidenceDirectory],
    allowedOrigins:
      allowedOrigins.length === 0 ? [STUDIO_ORIGIN] : allowedOrigins,
    onPairingCode: (code) => output(`New one-time pairing code: ${code}\n`),
  });
  output("BLOCKLAB Local Agent ready\n");
  output(`Agent: ${agent.agentId}\nURL: ${agent.url}\n`);
  output(
    `Pairing code: ${agent.pairingCode}\nProject authorization: explicit, inspect-only\n`,
  );
  output(
    "Pair this agent only from an explicitly allowed Studio origin. No experiment or filesystem execution endpoints are enabled.\n",
  );
  if (dependencies.signal?.aborted === true) {
    await agent.close();
    return EXIT_CODES.success;
  }
  await new Promise<void>((resolveAgent) => {
    dependencies.signal?.addEventListener(
      "abort",
      () => {
        void agent.close().then(resolveAgent, resolveAgent);
      },
      { once: true },
    );
  });
  return EXIT_CODES.success;
}
