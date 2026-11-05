import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InspectionError, inspectProject } from "./index.js";

const temporaryDirectories: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "blocklab-inspector-"));
  temporaryDirectories.push(root);
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(root, name);
    writeFileSync(filePath, content);
  }
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("safe project inspection", () => {
  it("detects a React Vite Wagmi Viem project with evidence", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { react: "^19.0.0", wagmi: "^2.0.0", viem: "^2.0.0" },
        devDependencies: { vite: "^7.0.0" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      "vite.config.ts": "export default {}",
      "src-config.ts":
        "export const chainId = 31337; export const rpc = process.env.VITE_RPC_URL;",
    });
    const result = inspectProject(root);
    expect(result.packageManagers).toEqual(["pnpm"]);
    expect(result.detectedStack).toEqual(
      expect.arrayContaining(["react", "Vite", "wagmi", "viem"]),
    );
    expect(result.chainIds).toEqual([31337]);
    expect(result.rpcReferences).toContain("environment variable VITE_RPC_URL");
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("detects Next.js, Ethers, Foundry, and Hardhat without executing files", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { next: "^15.0.0", ethers: "^6.0.0" },
      }),
      "next.config.mjs": "export default {}",
      "foundry.toml": "[profile.default]\nsrc = 'src'",
      "hardhat.config.ts": "throw new Error('must never execute')",
    });
    const result = inspectProject(root);
    expect(result.detectedStack).toEqual(
      expect.arrayContaining(["Next.js", "Ethers", "Foundry", "Hardhat"]),
    );
  });

  it("detects a Foundry project without requiring a JavaScript manifest", () => {
    const root = fixture({
      "foundry.toml": "[profile.default]\nsrc = 'src'",
    });
    const result = inspectProject(root);
    expect(result.manifest).toBe("missing");
    expect(result.detectedStack).toContain("Foundry");
  });

  it("does not infer frameworks from directory names", () => {
    const root = fixture({
      "package.json": JSON.stringify({}),
    });
    mkdirSync(join(root, "react"), { recursive: true });
    const result = inspectProject(root);
    expect(result.detectedStack).toEqual([]);
  });

  it("reports conflicting lockfiles and does not choose silently", () => {
    const root = fixture({
      "package.json": "{}",
      "package-lock.json": "{}",
      "yarn.lock": "",
    });
    const result = inspectProject(root);
    expect(result.packageManagerConflict).toBe(true);
    expect(result.packageManagers).toEqual(["npm", "yarn"]);
    expect(result.limitations.join(" ")).toContain(
      "Conflicting package manager",
    );
  });

  it("never exposes values from environment or secret configuration", () => {
    const root = fixture({
      "package.json": JSON.stringify({}),
      ".env":
        "PRIVATE_KEY=super-secret-private-key\nVITE_RPC_URL=https://key.example",
      "vite.config.ts":
        "const secret = process.env.PRIVATE_KEY; const rpc = process.env.VITE_RPC_URL; const token = 'never-print-this-token';",
    });
    const result = inspectProject(root);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-private-key");
    expect(serialized).not.toContain("never-print-this-token");
    expect(serialized).toContain("VITE_RPC_URL");
    expect(serialized).not.toContain("PRIVATE_KEY");
  });

  it("reports missing and malformed manifests clearly", () => {
    const missing = fixture({});
    expect(inspectProject(missing).manifest).toBe("missing");
    const malformed = fixture({ "package.json": "{" });
    expect(() => inspectProject(malformed)).toThrowError(InspectionError);
    expect(() => inspectProject(malformed)).toThrow(
      /Could not parse package\.json/,
    );
  });
});
