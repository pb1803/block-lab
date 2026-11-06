import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalAgent, pathIsWithinAuthorizedRoot } from "./server.js";

const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5178";
const agents: Array<{ close: () => Promise<void> }> = [];
const projectRoots: string[] = [];

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
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

  it("consumes pairing codes once and rotates them for a new single-tab session", async () => {
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
    const newSession = await request(`${agent.url}/v1/projects`, {
      headers: auth(accessToken(second)),
    });

    expect(first.status).toBe(200);
    expect(nextCode).not.toBe(originalCode);
    expect(reused.status).toBe(401);
    expect(second.status).toBe(200);
    expect(oldSession.status).toBe(401);
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
