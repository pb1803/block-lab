import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLI_VERSION,
  EXIT_CODES,
  runCli,
  studioReportUrl,
  validateRpcUrl,
} from "./cli.js";

async function listenUpstream(onRequest?: () => void): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server: Server = createServer((request, response) => {
    onRequest?.();
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x7a69" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Upstream did not start.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function capture(): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly dependencies: {
    readonly stdout: (value: string) => void;
    readonly stderr: (value: string) => void;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dependencies: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

describe("blocklab CLI", () => {
  let directory: string | undefined;
  let upstream: Awaited<ReturnType<typeof listenUpstream>> | undefined;

  afterEach(async () => {
    const activeUpstream = upstream;
    upstream = undefined;
    await activeUpstream?.close();
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps automatic launch credentials in an expiring URL fragment only", () => {
    const reportUrl = studioReportUrl("root-project", "execution-1");
    const launchUrl = studioReportUrl("root-project", "execution-1", {
      endpoint: "http://127.0.0.1:8787",
      bootstrapToken: "A".repeat(43),
    });
    const parsed = new URL(launchUrl);

    expect(reportUrl).toBe(
      "https://block-lab-eight.vercel.app/#/experiments/root-project/execution-1",
    );
    expect(parsed.origin).toBe("https://block-lab-eight.vercel.app");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toContain("agent=http%3A%2F%2F127.0.0.1%3A8787");
    expect(parsed.hash).toContain(`bootstrap=${"A".repeat(43)}`);
    expect(launchUrl).not.toContain("accessToken");
  });

  it("validates interactive RPC URL values without rewriting them", () => {
    expect(validateRpcUrl("http://127.0.0.1:8545")).toBe(
      "http://127.0.0.1:8545",
    );
    expect(validateRpcUrl("https://localhost:443/rpc")).toBe(
      "https://localhost:443/rpc",
    );
    for (const value of [
      "",
      "5",
      "not a url",
      "ftp://127.0.0.1:8545",
      "http://",
      "http://127.0.0.1:0",
      "http://127.0.0.1:65536",
      "http://user:pass@127.0.0.1:8545",
    ])
      expect(validateRpcUrl(value)).toBeUndefined();
  });

  it("prints help, version, and rejects unknown commands", async () => {
    const packageManifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CLI_VERSION).toBe(packageManifest.version);

    const help = capture();
    expect(await runCli(["--help"], help.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(help.stdout.join("")).toContain("blocklab test rpc-blackout");
    expect(help.stdout.join("")).toContain("blocklab scenarios");

    const version = capture();
    expect(await runCli(["--version"], version.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(version.stdout.join("")).toMatch(/^\d+\.\d+\.\d+\n$/);
    const versionCommand = capture();
    expect(await runCli(["version"], versionCommand.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(versionCommand.stdout.join("")).toBe(version.stdout.join(""));

    const scenarios = capture();
    expect(await runCli(["scenarios"], scenarios.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(scenarios.stdout.join("")).toContain(
      "rpc-intermittent-failure (1.0.0)",
    );
    expect(scenarios.stdout.join("")).toContain(
      "explicit loopback RPC upstream",
    );

    const scenariosJson = capture();
    expect(
      await runCli(["scenarios", "--json"], scenariosJson.dependencies),
    ).toBe(EXIT_CODES.success);
    expect(JSON.parse(scenariosJson.stdout.join(""))).toHaveLength(6);

    const unknown = capture();
    expect(await runCli(["unknown"], unknown.dependencies)).toBe(
      EXIT_CODES.usage,
    );
    expect(unknown.stderr.join("")).toContain("Unknown command");
  });

  it("uses safe non-TTY behavior and reports empty or malformed evidence", async () => {
    const noArgs = capture();
    expect(await runCli([], noArgs.dependencies)).toBe(EXIT_CODES.success);
    expect(noArgs.stdout.join("")).toContain("BLOCKLAB 0.2.0");

    directory = await mkdtemp(join(tmpdir(), "blocklab-empty-cli-"));
    await writeFile(join(directory, "broken.json"), "{not-json");
    const listing = capture();
    expect(
      await runCli(
        ["runs", "list", "--evidence-dir", directory],
        listing.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect(listing.stdout.join("")).toContain("No evidence runs found.");
    expect(listing.stderr.join("")).toContain("broken.json");
  });

  it("starts the inspect-only Local Agent with explicit origins", async () => {
    const controller = new AbortController();
    const result = capture();
    const start = runCli(
      [
        "agent",
        "start",
        ".",
        "--allowed-origin",
        "http://127.0.0.1:5178",
        "--allowed-origin",
        "https://studio.example.test",
      ],
      {
        ...result.dependencies,
        cwd: process.cwd(),
        signal: controller.signal,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    expect(await start).toBe(EXIT_CODES.success);
    expect(result.stdout.join("")).toContain("BLOCKLAB Local Agent ready");
    expect(result.stdout.join("")).toContain("explicit, inspect-only");
    expect(result.stdout.join("")).not.toContain("accessToken");
  });

  it("inspects a project with JSON output without executing scripts", async () => {
    const result = capture();
    expect(
      await runCli(["inspect", ".", "--json"], {
        ...result.dependencies,
        cwd: process.cwd(),
      }),
    ).toBe(EXIT_CODES.success);
    const summary = JSON.parse(result.stdout.join("")) as {
      readonly schemaVersion: string;
    };
    expect(summary.schemaVersion).toBe("1.0");
  });

  it("runs, persists, reports, lists, replays, and compares a local experiment", async () => {
    directory = await mkdtemp(join(tmpdir(), "blocklab-cli-"));
    upstream = await listenUpstream();
    const args = [
      "test",
      "rpc-blackout",
      "--upstream",
      upstream.url,
      "--evidence-dir",
      directory,
      "--start-offset",
      "300",
      "--duration",
      "300",
      "--experiment-duration",
      "800",
      "--timeout",
      "3000",
    ];
    const first = capture();
    expect(await runCli(args, first.dependencies)).toBe(EXIT_CODES.success);
    expect(first.stdout.join("")).toContain("Evaluation: PASSED");

    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const executionId = files[0]?.replace(".json", "");
    expect(executionId).toBeDefined();

    const list = capture();
    expect(
      await runCli(
        ["runs", "list", "--evidence-dir", directory],
        list.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect(list.stdout.join("")).toContain(executionId);

    const report = capture();
    expect(
      await runCli(
        ["report", executionId ?? "", "--json", "--evidence-dir", directory],
        report.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect(JSON.parse(report.stdout.join("")).executionId).toBe(executionId);

    const replay = capture();
    expect(
      await runCli(
        [
          "replay",
          executionId ?? "",
          "--upstream",
          upstream.url,
          "--evidence-dir",
          directory,
          "--timeout",
          "3000",
        ],
        replay.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect((await readdir(directory)).length).toBe(2);

    const replayId = (await readdir(directory))
      .find((name) => name !== `${executionId}.json`)
      ?.replace(".json", "");
    expect(replayId).toBeDefined();
    const comparison = capture();
    expect(
      await runCli(
        [
          "compare",
          executionId ?? "",
          replayId ?? "",
          "--json",
          "--evidence-dir",
          directory,
        ],
        comparison.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect(JSON.parse(comparison.stdout.join("")).comparable).toBe(true);
  });

  it("requires an explicit upstream and rejects unsafe upstreams", async () => {
    directory = await mkdtemp(join(tmpdir(), "blocklab-cli-"));
    const missing = capture();
    expect(
      await runCli(
        ["test", "rpc-blackout", "--evidence-dir", directory],
        missing.dependencies,
      ),
    ).toBe(EXIT_CODES.usage);
    expect(missing.stderr.join("")).toContain("--upstream");

    const unsafe = capture();
    expect(
      await runCli(
        [
          "test",
          "rpc-blackout",
          "--upstream",
          "https://example.com",
          "--evidence-dir",
          directory,
        ],
        unsafe.dependencies,
      ),
    ).toBe(EXIT_CODES.operation);
    expect(unsafe.stderr.join("")).toContain("loopback");
  });

  it("runs rpc-latency with explicit delay configuration and persists latency evidence", async () => {
    directory = await mkdtemp(join(tmpdir(), "blocklab-cli-latency-"));
    upstream = await listenUpstream();
    const result = capture();
    expect(
      await runCli(
        [
          "test",
          "rpc-latency",
          "--upstream",
          upstream.url,
          "--delay",
          "80",
          "--start-offset",
          "200",
          "--duration",
          "300",
          "--experiment-duration",
          "900",
          "--timeout",
          "2000",
          "--evidence-dir",
          directory,
          "--json",
        ],
        result.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    const evidence = JSON.parse(result.stdout.join("")) as {
      readonly scenarioId: string;
      readonly configuration: { readonly delayMs: number };
      readonly evaluation: {
        readonly metrics: { readonly injectedRequestCount: number };
      };
    };
    expect(evidence.scenarioId).toBe("rpc-latency");
    expect(evidence.configuration.delayMs).toBe(80);
    expect(evidence.evaluation.metrics.injectedRequestCount).toBe(1);
  });

  it.each([
    [
      "rpc-intermittent-failure",
      [
        "--start-offset",
        "300",
        "--failure-duration",
        "100",
        "--recovery-interval",
        "100",
        "--window-count",
        "2",
        "--experiment-duration",
        "700",
      ],
    ],
    [
      "rpc-rate-limit",
      [
        "--max-requests",
        "2",
        "--window-ms",
        "1000",
        "--experiment-duration",
        "2000",
      ],
    ],
    [
      "rpc-connection-failure",
      [
        "--fault-mode",
        "premature-close",
        "--start-offset",
        "300",
        "--duration",
        "100",
        "--experiment-duration",
        "700",
      ],
    ],
    [
      "rpc-malformed-response",
      [
        "--fault-mode",
        "mismatched-id",
        "--start-offset",
        "300",
        "--duration",
        "300",
        "--experiment-duration",
        "700",
      ],
    ],
  ] as const)(
    "runs, persists, and replays %s through the CLI",
    async (scenario, scenarioOptions) => {
      directory = await mkdtemp(join(tmpdir(), "blocklab-attack-cli-"));
      upstream = await listenUpstream();
      const output = capture();
      const exitCode = await runCli(
        [
          "test",
          scenario,
          "--upstream",
          upstream.url,
          ...scenarioOptions,
          "--timeout",
          "2000",
          "--evidence-dir",
          directory,
          "--json",
        ],
        output.dependencies,
      );
      expect(
        exitCode,
        `${output.stderr.join("")}\n${output.stdout.join("")}`,
      ).toBe(EXIT_CODES.success);

      const evidence = JSON.parse(output.stdout.join("")) as {
        readonly executionId: string;
        readonly scenarioId: string;
        readonly scenarioVersion: string;
        readonly terminalState: string;
        readonly evaluation: {
          readonly metrics: { readonly totalRequests: number };
        };
      };
      expect(evidence.scenarioId).toBe(scenario);
      expect(evidence.scenarioVersion).toBe("1.0.0");
      expect(evidence.terminalState).toBe("completed");
      expect(evidence.evaluation.metrics.totalRequests).toBeGreaterThan(0);
      expect(await readdir(directory)).toContain(
        `${evidence.executionId}.json`,
      );

      const replay = capture();
      expect(
        await runCli(
          [
            "replay",
            evidence.executionId,
            "--upstream",
            upstream.url,
            "--evidence-dir",
            directory,
            "--timeout",
            "2000",
            "--json",
          ],
          replay.dependencies,
        ),
      ).toBe(EXIT_CODES.success);
      expect(
        (JSON.parse(replay.stdout.join("")) as { readonly scenarioId: string })
          .scenarioId,
      ).toBe(scenario);
      expect(await readdir(directory)).toHaveLength(2);
    },
  );

  it.each([
    [
      "rpc-intermittent-failure",
      ["--failure-duration", "0"],
      EXIT_CODES.operation,
    ],
    ["rpc-rate-limit", ["--max-requests", "0"], EXIT_CODES.operation],
    ["rpc-connection-failure", ["--duration", "0"], EXIT_CODES.operation],
    ["rpc-malformed-response", ["--fault-mode", "unknown"], EXIT_CODES.usage],
  ] as const)(
    "rejects invalid %s configuration with its stable exit code",
    async (scenario, invalidOptions, expectedExitCode) => {
      directory = await mkdtemp(join(tmpdir(), "blocklab-invalid-cli-"));
      upstream = await listenUpstream();
      const result = capture();
      const exitCode = await runCli(
        [
          "test",
          scenario,
          "--upstream",
          upstream.url,
          ...invalidOptions,
          "--evidence-dir",
          directory,
        ],
        result.dependencies,
      );
      expect(exitCode).toBe(expectedExitCode);
      expect(result.stderr.join("")).toContain("Error:");
      expect(await readdir(directory)).toHaveLength(0);
    },
  );

  it.each([
    "rpc-intermittent-failure",
    "rpc-rate-limit",
    "rpc-connection-failure",
    "rpc-malformed-response",
  ] as const)("requires an explicit upstream for %s", async (scenario) => {
    const result = capture();
    expect(await runCli(["test", scenario], result.dependencies)).toBe(
      EXIT_CODES.usage,
    );
    expect(result.stderr.join("")).toContain("--upstream");
  });

  it("supports human-readable output for malformed-response evidence", async () => {
    directory = await mkdtemp(join(tmpdir(), "blocklab-human-cli-"));
    upstream = await listenUpstream();
    const result = capture();
    expect(
      await runCli(
        [
          "test",
          "rpc-malformed-response",
          "--upstream",
          upstream.url,
          "--start-offset",
          "300",
          "--duration",
          "300",
          "--experiment-duration",
          "700",
          "--timeout",
          "2000",
          "--evidence-dir",
          directory,
        ],
        result.dependencies,
      ),
    ).toBe(EXIT_CODES.success);
    expect(result.stdout.join("")).toContain(
      "Scenario: rpc-malformed-response 1.0.0",
    );
    expect(result.stdout.join("")).toContain("injected requests: 1");
    expect(result.stdout.join("")).toContain("Evidence:");
  });

  it("persists cancelled attack evidence and cleans up the CLI execution", async () => {
    directory = await mkdtemp(join(tmpdir(), "blocklab-cancel-cli-"));
    const controller = new AbortController();
    upstream = await listenUpstream(() => controller.abort());
    const result = capture();
    const exitCode = await runCli(
      [
        "test",
        "rpc-intermittent-failure",
        "--upstream",
        upstream.url,
        "--start-offset",
        "100",
        "--failure-duration",
        "10",
        "--recovery-interval",
        "10",
        "--window-count",
        "2",
        "--experiment-duration",
        "200",
        "--evidence-dir",
        directory,
        "--json",
      ],
      { ...result.dependencies, signal: controller.signal },
    );
    expect(
      exitCode,
      `${result.stderr.join("")}\n${result.stdout.join("")}`,
    ).toBe(EXIT_CODES.inconclusive);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const evidence = JSON.parse(
      await readFile(join(directory, files[0] ?? ""), "utf8"),
    ) as {
      readonly terminalState: string;
      readonly evaluation: { readonly status: string };
    };
    expect(evidence.terminalState).toBe("cancelled");
    expect(evidence.evaluation.status).toBe("inconclusive");
  });
});
