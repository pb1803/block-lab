import { describe, expect, it } from "vitest";
import {
  agentStatusPresentation,
  hashForReport,
  hashForRoute,
  reportTargetFromHash,
  routeFromHash,
  type StudioRoute,
  studioNavigation,
} from "./shell.js";

describe("Studio navigation contract", () => {
  it("defines the complete UI-09 destination set", () => {
    expect(studioNavigation.map((item) => item.route)).toEqual([
      "overview",
      "projects",
      "attack-lab",
      "experiments",
      "network-intelligence",
      "evidence-vault",
      "settings",
    ]);
  });

  it("normalizes route hashes and unknown paths to Overview", () => {
    expect(routeFromHash("#/projects")).toBe("projects");
    expect(routeFromHash("#/experiments/run-123")).toBe("experiments");
    expect(routeFromHash("")).toBe("overview");
    expect(routeFromHash("#/not-a-route")).toBe("overview");
  });

  it("creates stable, addressable hashes for every route", () => {
    for (const item of studioNavigation) {
      expect(hashForRoute(item.route as StudioRoute)).toBe(`#/${item.route}`);
    }
  });

  it("encodes project and execution identifiers in report deep links", () => {
    expect(hashForReport("root/project 1", "execution/2")).toBe(
      "#/experiments/root%2Fproject%201/execution%2F2",
    );
    expect(routeFromHash(hashForReport("root/project 1", "execution/2"))).toBe(
      "experiments",
    );
    expect(
      reportTargetFromHash(
        `${hashForReport("root/project 1", "execution/2")}?agent=http%3A%2F%2F127.0.0.1%3A8787&bootstrap=${"A".repeat(43)}`,
      ),
    ).toEqual({ projectId: "root/project 1", executionId: "execution/2" });
    expect(reportTargetFromHash("#/experiments/%E0%A4%A/run")).toBeUndefined();
  });

  it("keeps all current destinations available without enabling their operations", () => {
    expect(studioNavigation.map((item) => item.route)).toContain("projects");
    expect(studioNavigation.map((item) => item.route)).toContain(
      "evidence-vault",
    );
    expect(studioNavigation.map((item) => item.route)).toContain("attack-lab");
  });
});

describe("Local Agent status presentation", () => {
  it.each([
    ["disconnected", "Local Agent disconnected", "warning"],
    ["pairing", "Connecting to Local Agent", "info"],
    ["expired", "Local Agent session expired", "warning"],
    ["connected", "Local Agent connected", "success"],
    ["error", "Local Agent connection error", "error"],
  ] as const)(
    "labels %s state with text and a semantic tone",
    (state, label, tone) => {
      expect(agentStatusPresentation(state)).toEqual({ label, tone });
    },
  );

  it("treats a missing agent as disconnected", () => {
    expect(agentStatusPresentation(undefined)).toEqual({
      label: "Local Agent disconnected",
      tone: "warning",
    });
  });
});
