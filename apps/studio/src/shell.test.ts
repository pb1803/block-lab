import { describe, expect, it } from "vitest";
import {
  hashForRoute,
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
});
