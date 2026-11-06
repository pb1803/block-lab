import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalAgent, pathIsWithinAuthorizedRoot } from "./server.js";

const agents: Array<{ close: () => Promise<void> }> = [];
const projects: string[] = [];

afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.close()));
});

async function request(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      origin: "http://127.0.0.1:5178",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "blocklab-agent-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { vite: "^7.0.0", viem: "^2.0.0" } }),
  );
  writeFileSync(join(root, "vite.config.ts"), "export default {}");
  projects.push(root);
  return root;
}

describe("local agent", () => {
  it("pairs, lists an explicitly authorized project, and inspects it", async () => {
    const agent = await createLocalAgent({ projectPaths: [project()] });
    agents.push(agent);
    const health = await request(`${agent.url}/health`);
    expect(health.status).toBe(200);
    const paired = await request(`${agent.url}/pair`, {
      method: "POST",
      body: JSON.stringify({ code: agent.pairingCode }),
    });
    expect(paired.status).toBe(200);
    const token = paired.body.token as string;
    const listed = await request(`${agent.url}/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.status).toBe(200);
    const listedProject = (
      listed.body.projects as Array<Record<string, string>>
    )[0];
    expect(listedProject?.authorization).toBe("explicit");
    const inspected = await request(
      `${agent.url}/projects/${listedProject?.projectId}/inspect`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
    );
    expect(inspected.status).toBe(200);
    expect(
      (inspected.body.inspection as Record<string, unknown>).detectedStack,
    ).toEqual(expect.arrayContaining(["Vite", "viem"]));
  });

  it("rejects invalid origin and revoked sessions", async () => {
    const agent = await createLocalAgent();
    agents.push(agent);
    const invalid = await fetch(`${agent.url}/pair`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: agent.pairingCode }),
    });
    expect(invalid.status).toBe(403);
    const paired = await request(`${agent.url}/pair`, {
      method: "POST",
      body: JSON.stringify({ code: agent.pairingCode }),
    });
    const token = paired.body.token as string;
    const revoked = await request(`${agent.url}/revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.status).toBe(200);
    const denied = await request(`${agent.url}/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.status).toBe(401);
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
