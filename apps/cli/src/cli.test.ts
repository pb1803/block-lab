import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_CODES, runCli } from "./cli.js";

async function listenUpstream(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server: Server = createServer((request, response) => {
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

  it("prints help, version, and rejects unknown commands", async () => {
    const help = capture();
    expect(await runCli(["--help"], help.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(help.stdout.join("")).toContain("blocklab test rpc-blackout");

    const version = capture();
    expect(await runCli(["--version"], version.dependencies)).toBe(
      EXIT_CODES.success,
    );
    expect(version.stdout.join("")).toMatch(/^\d+\.\d+\.\d+\n$/);

    const unknown = capture();
    expect(await runCli(["unknown"], unknown.dependencies)).toBe(
      EXIT_CODES.usage,
    );
    expect(unknown.stderr.join("")).toContain("Unknown command");
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
});
