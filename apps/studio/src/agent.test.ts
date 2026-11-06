import { describe, expect, it } from "vitest";
import { createStudioAgentClient } from "./agent.js";

describe("Studio Local Agent client", () => {
  it("pairs and loads authorized projects without exposing the token to state", async () => {
    const calls: string[] = [];
    const client = createStudioAgentClient(async (input, init) => {
      calls.push(`${input} ${init.method ?? "GET"}`);
      if (String(input).endsWith("/health")) {
        return new Response(
          JSON.stringify({
            service: "blocklab-local-agent",
            protocolVersion: "1",
            agentId: "agent-test",
            status: "ready",
            authorizedProjectCount: 1,
          }),
          { status: 200 },
        );
      }
      if (String(input).endsWith("/pair")) {
        return new Response(JSON.stringify({ token: "secret-session-token" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          projects: [
            {
              projectId: "local-project",
              name: "sample-dapp",
              rootIdentifier: "c:\\sample-dapp",
              sourceType: "local",
              authorization: "explicit",
            },
          ],
        }),
        { status: 200 },
      );
    });

    await client.pair("http://127.0.0.1:8787/", "ABC123");

    expect(client.getState().connection).toBe("connected");
    expect(client.getState().projects[0]?.name).toBe("sample-dapp");
    expect(JSON.stringify(client.getState())).not.toContain(
      "secret-session-token",
    );
    expect(calls).toEqual([
      "http://127.0.0.1:8787/health GET",
      "http://127.0.0.1:8787/pair POST",
      "http://127.0.0.1:8787/projects GET",
    ]);
  });

  it("surfaces pairing failures and clears credentials on revoke", async () => {
    const client = createStudioAgentClient(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Pairing code was rejected." } }),
        { status: 401 },
      );
    });

    await client.pair("http://127.0.0.1:8787", "bad");
    expect(client.getState().connection).toBe("error");
    expect(client.getState().error).toBe("Pairing code was rejected.");
    await client.revoke();
    expect(client.getState().connection).toBe("disconnected");
    expect(client.getState().projects).toEqual([]);
  });
});
