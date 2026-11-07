import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcBlackoutEvidence, writeEvidence } from "@blocklab/evidence";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../cli/src/cli.js";
import { createStudioAgentClient } from "../../studio/src/agent.js";
import {
  createLocalAgent,
  pathIsWithinAuthorizedRoot,
  projectIdForPath,
} from "./server.js";

const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5178";
const agents: Array<{ close: () => Promise<void> }> = [];
const upstreams: Array<{ close: () => Promise<void> }> = [];
const projectRoots: string[] = [];

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
  await Promise.all(upstreams.splice(0).map((server) => server.close()));
  for (const root of projectRoots.splice(0)) {
    if (root.startsWith(tmpdir()))
      rmSync(root, { force: true, recursive: true });
  }
});

async function request(
  url: string,
  init: RequestInit = {},
  origin = DEVELOPMENT_ORIGIN,
): Promise<{
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}> {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  let body: Record<string, unknown> = {};
  if (response.status !== 204) {
    body = (await response.json()) as Record<string, unknown>;
  }
  return { status: response.status, headers: response.headers, body };
}

async function listenRpcFixture(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const body: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) =>
      body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(body).toString("utf8")) as
        | { readonly id?: string | number | null }
        | readonly { readonly id?: string | number | null }[];
      const reply = (entry: { readonly id?: string | number | null }) => ({
        jsonrpc: "2.0",
        id: entry.id ?? null,
        result: "0x7a69",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          Array.isArray(payload)
            ? payload.map(reply)
            : reply(payload as { readonly id?: string | number | null }),
        ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Local JSON-RPC fixture did not start.");
  const handle = {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
  upstreams.push(handle);
  return handle;
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "blocklab-agent-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { vite: "^7.0.0", viem: "^2.0.0" } }),
  );
  writeFileSync(join(root, "vite.config.ts"), "export default {}");
  projectRoots.push(root);
  return root;
}

function evidenceDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "blocklab-evidence-"));
  projectRoots.push(root);
  return root;
}

async function createReport(directory: string, executionId = "execution-1") {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const evidence = createRpcBlackoutEvidence(
    {
      executionId,
      state: "completed",
      startedAt,
      finishedAt: "2026-01-01T00:00:01.000Z",
    },
    { startOffsetMs: 100, durationMs: 100, experimentDurationMs: 400 },
    [
      {
        executionId,
        scenarioId: "rpc-blackout",
        timestamp: startedAt,
        method: "eth_chainId",
        outcome: "forwarded_success",
        injected: false,
        latencyMs: 1,
        correlationId: `${executionId}-correlation`,
      },
    ],
  );
  await writeEvidence(join(directory, `${executionId}.json`), evidence);
  return evidence;
}

async function pair(agent: Awaited<ReturnType<typeof createLocalAgent>>) {
  return request(`${agent.url}/v1/pair`, {
    method: "POST",
    body: JSON.stringify({
      pairingCode: agent.pairingCode,
      protocolVersions: ["1"],
    }),
  });
}

function accessToken(response: { body: Record<string, unknown> }): string {
  return String(response.body.accessToken);
}

function auth(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

function requestWithHost(url: string, host: string): Promise<number> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(parsed.port),
        path: "/v1/health",
        method: "GET",
        headers: { host, origin: DEVELOPMENT_ORIGIN },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("Local Runtime protocol boundary", () => {
  it("serves minimal unauthenticated health and binds only to loopback", async () => {
    const agent = await createLocalAgent({ projectPaths: [project()] });
    agents.push(agent);

    const health = await request(`${agent.url}/v1/health`);

    expect(agent.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      service: "blocklab-local-agent",
      runtimeId: agent.agentId,
      status: "ready",
      protocolVersions: ["1"],
    });
    expect(JSON.stringify(health.body)).not.toContain(projectRoots[0]);
    expect(JSON.stringify(health.body)).not.toContain(agent.pairingCode);
  });

  it("pairs and preserves authorized project listing and inspection", async () => {
    const agent = await createLocalAgent({ projectPaths: [project()] });
    agents.push(agent);
    const paired = await pair(agent);
    const token = accessToken(paired);

    const listed = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    expect(paired.status).toBe(200);
    expect(listed.status).toBe(200);
    const listedProject = (
      listed.body.projects as Array<Record<string, string>>
    )[0];
    expect(listedProject?.authorization).toBe("explicit");
    expect(listedProject?.rootIdentifier).not.toBe(projectRoots[0]);

    const inspected = await request(
      `${agent.url}/v1/projects/${listedProject?.projectId}/inspect`,
      { method: "POST", headers: auth(token), body: "{}" },
    );
    expect(inspected.status).toBe(200);
    expect(
      (inspected.body.inspection as Record<string, unknown>).detectedStack,
    ).toEqual(expect.arrayContaining(["Vite", "viem"]));
    expect(JSON.stringify(inspected.body)).not.toContain(projectRoots[0]);
  });

  it("lists and retrieves only verified reports for the authorized project", async () => {
    const root = project();
    const evidence = evidenceDirectory();
    await createReport(evidence);
    const agent = await createLocalAgent({
      projectPaths: [root],
      evidenceDirectories: [evidence],
    });
    agents.push(agent);
    const paired = await pair(agent);
    const token = accessToken(paired);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    const projectId = (
      projects.body.projects as Array<Record<string, string>>
    )[0]?.projectId;
    expect(projectId).toBe(projectIdForPath(root));

    const listed = await request(
      `${agent.url}/v1/projects/${projectId}/reports`,
      { headers: auth(token) },
    );
    const detail = await request(
      `${agent.url}/v1/projects/${projectId}/reports/execution-1`,
      { headers: auth(token) },
    );

    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect((listed.body.reports as unknown[]).length).toBe(1);
    expect(detail.status).toBe(200);
    expect((detail.body as Record<string, unknown>).integrityStatus).toBe(
      "verified",
    );
  });

  it("runs a real CLI experiment and auto-connects Studio through scoped bootstrap", async () => {
    const root = project();
    const evidence = evidenceDirectory();
    const rpc = await listenRpcFixture();
    const cliOutput: string[] = [];
    const cliError: string[] = [];
    const result = await runCli(
      [
        "test",
        "rpc-blackout",
        "--upstream",
        rpc.url,
        "--evidence-dir",
        evidence,
        "--start-offset",
        "100",
        "--duration",
        "200",
        "--experiment-duration",
        "400",
        "--timeout",
        "3000",
      ],
      {
        cwd: root,
        interactive: false,
        stdout: (value) => cliOutput.push(value),
        stderr: (value) => cliError.push(value),
      },
    );
    expect(result, cliError.join("")).toBe(0);
    expect(cliOutput.join("")).toContain("Evaluation:");
    const evidenceFiles = readdirSync(evidence);
    expect(evidenceFiles).toHaveLength(1);
    const executionId = evidenceFiles[0]?.replace(/\.json$/, "");
    expect(executionId).toBeDefined();
    const projectId = projectIdForPath(root);
    const agent = await createLocalAgent({
      projectPaths: [root],
      evidenceDirectories: [evidence],
      bootstrapProjectId: projectId,
    });
    agents.push(agent);
    expect(agent.bootstrapToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const studioFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("origin", DEVELOPMENT_ORIGIN);
      return fetch(input, { ...init, headers });
    };
    const firstTab = createStudioAgentClient(studioFetch);
    const secondTab = createStudioAgentClient(studioFetch);

    const rejectedOrigin = await request(
      `${agent.url}/v1/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({
          bootstrapToken: agent.bootstrapToken,
          protocolVersions: ["1"],
        }),
      },
      "https://attacker.example",
    );
    expect(rejectedOrigin.status).toBe(403);
    await firstTab.bootstrap(agent.url, agent.bootstrapToken ?? "");
    await firstTab.listReports(projectId);

    expect(firstTab.getState().connection, firstTab.getState().error).toBe(
      "connected",
    );
    expect(
      firstTab.getState().projects.map((entry) => entry.projectId),
    ).toEqual([projectId]);
    expect(firstTab.getState().reports?.reports[0]?.executionId).toBe(
      executionId,
    );
    await firstTab.getReport(projectId, executionId ?? "");
    expect(firstTab.getState().selectedReport?.integrityStatus).toBe(
      "verified",
    );
    expect(
      firstTab.getState().selectedReport?.evaluation.metrics.totalRequests,
    ).toBeGreaterThan(0);
    expect(
      firstTab.getState().selectedReport?.observations.length,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(firstTab.getState())).not.toContain("accessToken");

    await secondTab.bootstrap(agent.url, agent.bootstrapToken ?? "");
    expect(secondTab.getState().connection).toBe("connected");
    const invalidBootstrap = await request(`${agent.url}/v1/bootstrap`, {
      method: "POST",
      body: JSON.stringify({
        bootstrapToken: "A".repeat(43),
        protocolVersions: ["1"],
      }),
    });
    expect(invalidBootstrap.status).toBe(401);
    const invalidToken = await request(`${agent.url}/v1/projects`, {
      headers: auth("A".repeat(43)),
    });
    expect(invalidToken.status).toBe(401);
    await secondTab.revoke();
    await firstTab.listReports(projectId);
    expect(firstTab.getState().connection).toBe("connected");
    expect(firstTab.getState().reports?.totalCount).toBe(1);

    const refreshedTab = createStudioAgentClient(studioFetch);
    await refreshedTab.bootstrap(agent.url, agent.bootstrapToken ?? "");
    await refreshedTab.getReport(projectId, executionId ?? "");
    expect(refreshedTab.getState().selectedReport?.executionId).toBe(
      executionId,
    );
  });

  it("limits bootstrap sessions to their explicitly selected project", async () => {
    const first = project();
    const second = project();
    const projectId = projectIdForPath(first);
    const agent = await createLocalAgent({
      projectPaths: [first, second],
      bootstrapProjectId: projectId,
    });
    agents.push(agent);
    const bootstrapped = await request(`${agent.url}/v1/bootstrap`, {
      method: "POST",
      body: JSON.stringify({
        bootstrapToken: agent.bootstrapToken,
        protocolVersions: ["1"],
      }),
    });
    const token = accessToken(bootstrapped);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    const otherProject = await request(
      `${agent.url}/v1/projects/${projectIdForPath(second)}/reports`,
      { headers: auth(token) },
    );

    expect(bootstrapped.status, JSON.stringify(bootstrapped.body)).toBe(200);
    expect(
      (projects.body.projects as Array<Record<string, string>>).map(
        (item) => item.projectId,
      ),
    ).toEqual([projectId]);
    expect(otherProject.status).toBe(403);
    expect((otherProject.body.error as Record<string, string>).code).toBe(
      "PROJECT_NOT_IN_SESSION",
    );
  });

  it("rejects expired or exhausted bootstrap authorizations", async () => {
    let currentTime = 1_000;
    const root = project();
    const agent = await createLocalAgent({
      projectPaths: [root],
      bootstrapProjectId: projectIdForPath(root),
      now: () => currentTime,
    });
    agents.push(agent);
    currentTime += 5 * 60_000;
    const expired = await request(`${agent.url}/v1/bootstrap`, {
      method: "POST",
      body: JSON.stringify({
        bootstrapToken: agent.bootstrapToken,
        protocolVersions: ["1"],
      }),
    });

    expect(expired.status, JSON.stringify(expired.body)).toBe(401);
    expect((expired.body.error as Record<string, string>).code).toBe(
      "BOOTSTRAP_EXPIRED",
    );
  });

  it("rejects unauthenticated, unknown, malformed, and traversal report requests", async () => {
    const root = project();
    const evidence = evidenceDirectory();
    await createReport(evidence);
    const agent = await createLocalAgent({
      projectPaths: [root],
      evidenceDirectories: [evidence],
    });
    agents.push(agent);
    const unauthenticated = await request(
      `${agent.url}/v1/projects/local-project/reports`,
    );
    const paired = await pair(agent);
    const token = accessToken(paired);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    const projectId = (
      projects.body.projects as Array<Record<string, string>>
    )[0]?.projectId;

    const unknownProject = await request(
      `${agent.url}/v1/projects/unknown-project/reports`,
      { headers: auth(token) },
    );
    const malformed = await request(
      `${agent.url}/v1/projects/${projectId}/reports/../secret`,
      { headers: auth(token) },
    );
    const traversal = await request(
      `${agent.url}/v1/projects/${projectId}/reports/..%2Fsecret`,
      { headers: auth(token) },
    );
    const windowsPath = await request(
      `${agent.url}/v1/projects/${projectId}/reports/C:%5Csecret`,
      { headers: auth(token) },
    );
    const uncPath = await request(
      `${agent.url}/v1/projects/${projectId}/reports/%5C%5Cserver%5Cshare`,
      { headers: auth(token) },
    );

    expect(unauthenticated.status).toBe(401);
    expect(unknownProject.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(traversal.status).toBe(400);
    expect(windowsPath.status).toBe(400);
    expect(uncPath.status).toBe(400);
  });

  it("does not expose missing-digest or mismatched evidence as reports", async () => {
    const root = project();
    const evidence = evidenceDirectory();
    const valid = await createReport(evidence, "missing-digest");
    writeFileSync(
      join(evidence, "missing-digest.json"),
      JSON.stringify({ ...valid, evidenceDigest: undefined }),
    );
    const mismatch = await createReport(evidence, "digest-mismatch");
    writeFileSync(
      join(evidence, "digest-mismatch.json"),
      JSON.stringify({ ...mismatch, evidenceDigest: "f".repeat(64) }),
    );
    const agent = await createLocalAgent({
      projectPaths: [root],
      evidenceDirectories: [evidence],
    });
    agents.push(agent);
    const paired = await pair(agent);
    const token = accessToken(paired);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    const projectId = (
      projects.body.projects as Array<Record<string, string>>
    )[0]?.projectId;

    const listed = await request(
      `${agent.url}/v1/projects/${projectId}/reports`,
      { headers: auth(token) },
    );
    const missing = await request(
      `${agent.url}/v1/projects/${projectId}/reports/missing-digest`,
      { headers: auth(token) },
    );
    const mismatched = await request(
      `${agent.url}/v1/projects/${projectId}/reports/digest-mismatch`,
      { headers: auth(token) },
    );

    expect(listed.status).toBe(200);
    expect((listed.body.reports as unknown[]).length).toBe(0);
    expect(missing.status).toBe(422);
    expect(mismatched.status).toBe(422);
  });

  it("keeps report evidence isolated between explicitly authorized projects", async () => {
    const firstRoot = project();
    const secondRoot = project();
    const firstEvidence = evidenceDirectory();
    const secondEvidence = evidenceDirectory();
    await createReport(firstEvidence, "first-execution");
    await createReport(secondEvidence, "second-execution");
    const agent = await createLocalAgent({
      projectPaths: [firstRoot, secondRoot],
      evidenceDirectories: [firstEvidence, secondEvidence],
    });
    agents.push(agent);
    const paired = await pair(agent);
    const token = accessToken(paired);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });
    const projectIds = (
      projects.body.projects as Array<Record<string, string>>
    ).map((item) => item.projectId);

    const firstReports = await request(
      `${agent.url}/v1/projects/${projectIds[0]}/reports`,
      { headers: auth(token) },
    );
    const crossProject = await request(
      `${agent.url}/v1/projects/${projectIds[0]}/reports/second-execution`,
      { headers: auth(token) },
    );

    expect(firstReports.status).toBe(200);
    expect(
      (firstReports.body.reports as Array<Record<string, unknown>>)[0]
        ?.executionId,
    ).toBe("first-execution");
    expect(crossProject.status).toBe(404);
  });

  it("rejects unknown request fields with the protocol error envelope", async () => {
    const agent = await createLocalAgent({ projectPaths: [project()] });
    agents.push(agent);
    const paired = await pair(agent);
    const projects = await request(`${agent.url}/v1/projects`, {
      headers: auth(accessToken(paired)),
    });
    const projectId = (
      projects.body.projects as Array<Record<string, string>>
    )[0]?.projectId;

    const response = await request(
      `${agent.url}/v1/projects/${projectId}/inspect`,
      {
        method: "POST",
        headers: auth(accessToken(paired)),
        body: JSON.stringify({ unexpected: true }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error");
    expect((response.body.error as Record<string, unknown>).code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("rejects malformed JSON and unsupported content types", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);

    const malformed = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: "{",
    });
    const wrongType = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const invalidBodylessContentType = await request(`${agent.url}/v1/health`, {
      headers: { "content-type": "text/plain" },
    });
    const unexpectedBody = await request(`${agent.url}/v1/health`, {
      method: "POST",
      body: "{}",
    });

    expect(malformed.status).toBe(400);
    expect((malformed.body.error as Record<string, unknown>).code).toBe(
      "INVALID_JSON",
    );
    expect(wrongType.status).toBe(415);
    expect(invalidBodylessContentType.status).toBe(415);
    expect(unexpectedBody.status).toBe(400);
  });

  it("enforces request-body byte limits at the boundary", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);
    const validBody = JSON.stringify({
      pairingCode: agent.pairingCode,
      protocolVersions: ["1"],
    });
    const exactLimitBody =
      validBody + " ".repeat(16_384 - Buffer.byteLength(validBody));
    const atLimit = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: exactLimitBody,
    });
    const overLimit = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode: "A".repeat(17_000),
        protocolVersions: ["1"],
      }),
    });

    expect(atLimit.status).toBe(200);
    expect(overLimit.status).toBe(413);
    expect((overLimit.body.error as Record<string, unknown>).code).toBe(
      "BODY_TOO_LARGE",
    );
  });

  it("rejects unsupported protocol versions explicitly", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);

    const unsupportedPath = await request(`${agent.url}/v2/health`);
    const unsupportedPair = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode: agent.pairingCode,
        protocolVersions: ["2"],
      }),
    });

    expect(unsupportedPath.status).toBe(426);
    expect(unsupportedPair.status).toBe(426);
    expect((unsupportedPair.body.error as Record<string, unknown>).code).toBe(
      "PROTOCOL_UNSUPPORTED",
    );
  });

  it("consumes pairing codes once while keeping independent tab sessions isolated", async () => {
    const agent = await createLocalAgent({ projectPaths: [project()] });
    agents.push(agent);
    const originalCode = agent.pairingCode;
    const first = await pair(agent);
    const firstToken = accessToken(first);
    const nextCode = agent.pairingCode;
    const reused = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode: originalCode,
        protocolVersions: ["1"],
      }),
    });
    const second = await pair(agent);
    const oldSession = await request(`${agent.url}/v1/projects`, {
      headers: auth(firstToken),
    });
    const revokeFirst = await request(`${agent.url}/v1/session`, {
      method: "DELETE",
      headers: auth(firstToken),
    });
    const revokedSession = await request(`${agent.url}/v1/projects`, {
      headers: auth(firstToken),
    });
    const newSession = await request(`${agent.url}/v1/projects`, {
      headers: auth(accessToken(second)),
    });

    expect(first.status).toBe(200);
    expect(nextCode).not.toBe(originalCode);
    expect(reused.status).toBe(401);
    expect(second.status).toBe(200);
    expect(oldSession.status).toBe(200);
    expect(revokeFirst.status).toBe(200);
    expect(revokedSession.status).toBe(401);
    expect(newSession.status).toBe(200);
  });

  it("rejects expired pairing codes and sessions", async () => {
    let currentTime = 1_000;
    const agent = await createLocalAgent({
      now: () => currentTime,
    });
    agents.push(agent);
    const expiredCode = agent.pairingCode;
    currentTime += 5 * 60_000;
    const expiredPairing = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode: expiredCode,
        protocolVersions: ["1"],
      }),
    });

    expect(expiredPairing.status).toBe(401);

    let sessionTime = 1_000;
    const sessionAgent = await createLocalAgent({
      now: () => sessionTime,
    });
    agents.push(sessionAgent);
    const validPair = await pair(sessionAgent);
    sessionTime += 10 * 60_000;
    const expiredSession = await request(`${sessionAgent.url}/v1/projects`, {
      headers: auth(accessToken(validPair)),
    });
    expect(expiredSession.status).toBe(401);
  });

  it("rate-limits failed pairing attempts", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);
    const attempt = (): Promise<{
      status: number;
      headers: Headers;
      body: Record<string, unknown>;
    }> =>
      request(`${agent.url}/v1/pair`, {
        method: "POST",
        body: JSON.stringify({
          pairingCode: "0".repeat(32),
          protocolVersions: ["1"],
        }),
      });

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const throttled = await attempt();
    expect(throttled.status).toBe(429);
    expect((throttled.body.error as Record<string, unknown>).message).toBe(
      "Pairing is temporarily unavailable.",
    );
  });

  it("expires pairing throttles after their configured window", async () => {
    let currentTime = 10_000;
    const agent = await createLocalAgent({ now: () => currentTime });
    agents.push(agent);
    for (let index = 0; index < 5; index += 1) {
      await request(`${agent.url}/v1/pair`, {
        method: "POST",
        body: JSON.stringify({
          pairingCode: "0".repeat(32),
          protocolVersions: ["1"],
        }),
      });
    }
    currentTime += 60_000;
    const afterWindow = await pair(agent);
    expect(afterWindow.status).toBe(200);
  });

  it("revokes the active session explicitly", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);
    const paired = await pair(agent);
    const token = accessToken(paired);

    const revoked = await request(`${agent.url}/v1/session`, {
      method: "DELETE",
      headers: auth(token),
    });
    const denied = await request(`${agent.url}/v1/projects`, {
      headers: auth(token),
    });

    expect(revoked.status).toBe(200);
    expect(denied.status).toBe(401);
  });

  it("rejects unauthorized protected routes", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);

    const response = await request(`${agent.url}/v1/projects`);

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty("error");
  });

  it("rejects Origin and Host mismatches", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);

    const originMismatch = await request(
      `${agent.url}/v1/health`,
      {},
      "https://evil.example",
    );
    const hostMismatch = await requestWithHost(agent.url, "localhost:1");

    expect(originMismatch.status).toBe(403);
    expect(hostMismatch).toBe(400);
  });

  it("handles exact-origin CORS preflight without wildcard trust", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);

    const response = await request(`${agent.url}/v1/projects`, {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    const denied = await request(`${agent.url}/v1/projects`, {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-unapproved",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      DEVELOPMENT_ORIGIN,
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(denied.status).toBe(403);
  });

  it("rejects wildcard and non-exact configured origins", async () => {
    await expect(
      createLocalAgent({ allowedOrigins: ["https://*.vercel.app"] }),
    ).rejects.toThrow("exact HTTP or HTTPS origins");
    await expect(
      createLocalAgent({ allowedOrigins: ["https://studio.example/path"] }),
    ).rejects.toThrow("exact HTTP or HTTPS origins");
  });

  it("returns generic errors without codes, tokens, or absolute paths", async () => {
    const root = project();
    const agent = await createLocalAgent({ projectPaths: [root] });
    agents.push(agent);
    const secretCode = agent.pairingCode;
    const failure = await request(`${agent.url}/v1/pair`, {
      method: "POST",
      body: JSON.stringify({
        pairingCode: "0".repeat(32),
        protocolVersions: ["1"],
      }),
    });

    const responseText = JSON.stringify(failure.body);
    expect(responseText).not.toContain(secretCode);
    expect(responseText).not.toContain(root);
    expect(responseText).not.toContain("stack");
    expect(responseText).not.toContain("token");
  });

  it("does not treat a sibling path as authorized", () => {
    expect(
      pathIsWithinAuthorizedRoot(
        "C:\\workspace\\app",
        "C:\\workspace\\app-next",
      ),
    ).toBe(false);
    expect(
      pathIsWithinAuthorizedRoot(
        "C:\\workspace\\app",
        "C:\\workspace\\app\\src",
      ),
    ).toBe(true);
  });
});
