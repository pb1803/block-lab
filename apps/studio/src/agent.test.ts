import { describe, expect, it } from "vitest";
import { createStudioAgentClient } from "./agent.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const health = {
  service: "blocklab-local-agent",
  runtimeId: "runtime-test",
  status: "ready",
  protocolVersions: ["1"],
};

const paired = {
  runtimeId: "runtime-test",
  protocolVersion: "1",
  accessToken: "a".repeat(43),
  expiresAt: "2026-11-06T16:10:00.000Z",
  scopes: ["projects:read", "projects:inspect"],
};

const projects = {
  projects: [
    {
      projectId: "local-project",
      name: "sample-dapp",
      rootIdentifier: "root-123",
      sourceType: "local",
      authorization: "explicit",
    },
  ],
};

const inspection = {
  project: projects.projects[0],
  inspection: {
    schemaVersion: "1.0",
    rootPath: "root-123",
    manifest: "present",
    packageManagers: ["pnpm"],
    packageManagerConflict: false,
    detectedStack: ["Vite"],
    dependencies: [],
    edges: [],
    chainIds: [],
    networkNames: [],
    rpcReferences: [],
    limitations: [],
  },
  inspectedAt: "2026-11-06T16:00:00.000Z",
};

describe("Studio Local Runtime client", () => {
  it("notifies subscribers across pairing and revocation", async () => {
    const client = createStudioAgentClient(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) return jsonResponse(health);
      if (url.endsWith("/v1/pair")) return jsonResponse(paired);
      if (url.endsWith("/v1/projects")) return jsonResponse({ projects: [] });
      if (url.endsWith("/v1/session") && init?.method === "DELETE") {
        return jsonResponse({ revoked: true });
      }
      return jsonResponse({});
    });
    const states: string[] = [];
    const unsubscribe = client.subscribe(() => {
      states.push(client.getState().connection);
    });

    await client.pair("http://127.0.0.1:8787", "AB".repeat(16));
    await client.revoke();
    unsubscribe();

    expect(states).toEqual(["pairing", "connected", "disconnected"]);
  });

  it("uses versioned contracts, validates payloads, and keeps tokens private", async () => {
    const calls: Array<{
      url: string;
      method: string;
      body?: string;
      authorization?: string;
    }> = [];
    const client = createStudioAgentClient(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
        ...(headers.has("authorization")
          ? { authorization: headers.get("authorization") ?? "" }
          : {}),
      });
      if (url.endsWith("/v1/health")) return jsonResponse(health);
      if (url.endsWith("/v1/pair")) return jsonResponse(paired);
      if (url.endsWith("/v1/projects/ local-project/inspect")) {
        return jsonResponse(inspection);
      }
      if (url.endsWith("/v1/projects/local-project/inspect")) {
        return jsonResponse(inspection);
      }
      return jsonResponse(projects);
    });

    await client.pair("http://127.0.0.1:8787/", "AB".repeat(16));
    await client.inspect("local-project");

    expect(client.getState().connection).toBe("connected");
    expect(client.getState().health?.agentId).toBe("runtime-test");
    expect(client.getState().health?.authorizedProjectCount).toBe(1);
    expect(client.getState().projects[0]?.name).toBe("sample-dapp");
    expect(client.getState().inspection?.inspection.detectedStack).toEqual([
      "Vite",
    ]);
    expect(JSON.stringify(client.getState())).not.toContain(paired.accessToken);
    expect(calls.map(({ url, method }) => `${url} ${method}`)).toEqual([
      "http://127.0.0.1:8787/v1/health GET",
      "http://127.0.0.1:8787/v1/pair POST",
      "http://127.0.0.1:8787/v1/projects GET",
      "http://127.0.0.1:8787/v1/projects/local-project/inspect POST",
    ]);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      pairingCode: "AB".repeat(16),
      protocolVersions: ["1"],
    });
    expect(calls[2]?.authorization).toBe(`Bearer ${paired.accessToken}`);
    expect(calls[3]?.body).toBe("{}");
  });

  it("rejects malformed health, project, and inspection responses", async () => {
    let responseKind: "health" | "projects" | "inspection" = "health";
    const client = createStudioAgentClient(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) {
        return jsonResponse(
          responseKind === "health"
            ? { ...health, unexpected: "field" }
            : health,
        );
      }
      if (url.endsWith("/v1/pair")) return jsonResponse(paired);
      if (url.endsWith("/v1/projects")) {
        return jsonResponse(
          responseKind === "projects"
            ? { projects: [{ ...projects.projects[0], unexpected: true }] }
            : projects,
        );
      }
      return jsonResponse(
        responseKind === "inspection"
          ? {
              ...inspection,
              inspection: { ...inspection.inspection, extra: 1 },
            }
          : inspection,
      );
    });

    await client.pair("http://127.0.0.1:8787", "AB".repeat(16));
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toContain("unknown field");

    responseKind = "projects";
    await client.pair("http://127.0.0.1:8787", "AB".repeat(16));
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toContain("unknown field");

    responseKind = "inspection";
    await client.pair("http://127.0.0.1:8787", "AB".repeat(16));
    await client.inspect("local-project");
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toContain("unknown field");
  });

  it("rejects non-loopback endpoints before sending a pairing code", async () => {
    let calls = 0;
    const client = createStudioAgentClient(async () => {
      calls += 1;
      return jsonResponse(health);
    });

    await client.pair("https://runtime.example", "AB".repeat(16));

    expect(calls).toBe(0);
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toContain("127.0.0.1");
  });

  it("surfaces the protocol error envelope and clears credentials on revoke", async () => {
    const client = createStudioAgentClient(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) return jsonResponse(health);
      if (url.endsWith("/v1/pair")) {
        return jsonResponse(
          {
            error: {
              code: "PAIRING_REJECTED",
              message: "Pairing code was rejected.",
              retryable: false,
              requestId: "request-1",
            },
          },
          401,
        );
      }
      if (url.endsWith("/v1/session") && init?.method === "DELETE") {
        return jsonResponse({ revoked: true });
      }
      return jsonResponse({ projects: [] });
    });

    await client.pair("http://127.0.0.1:8787", "bad");
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toBe("Pairing code was rejected.");
    await client.revoke();
    expect(client.getState().connection).toBe("disconnected");
    expect(client.getState().projects).toEqual([]);
  });
});
