import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type {
  DependencyEdge,
  DependencyNode,
  DependencyType,
  EvidenceConfidence,
} from "@blocklab/core";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface InspectionSummary {
  readonly schemaVersion: "1.0";
  readonly rootPath: string;
  readonly manifest: "present" | "missing" | "malformed";
  readonly packageManagers: readonly PackageManager[];
  readonly packageManagerConflict: boolean;
  readonly detectedStack: readonly string[];
  readonly dependencies: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
  readonly chainIds: readonly number[];
  readonly networkNames: readonly string[];
  readonly rpcReferences: readonly string[];
  readonly limitations: readonly string[];
}

export class InspectionError extends Error {
  public readonly code:
    | "INVALID_DIRECTORY"
    | "MISSING_MANIFEST"
    | "MALFORMED_MANIFEST";

  public constructor(
    code: "INVALID_DIRECTORY" | "MISSING_MANIFEST" | "MALFORMED_MANIFEST",
    message: string,
  ) {
    super(message);
    this.name = "InspectionError";
    this.code = code;
  }
}

interface PackageManifest {
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
}

interface FindingInput {
  readonly nodeId: string;
  readonly type: DependencyType;
  readonly name: string;
  readonly evidenceSource: string;
  readonly evidence: string;
  readonly confidence?: EvidenceConfidence;
  readonly metadata?: Readonly<Record<string, string>>;
}

const LOCKFILES: readonly [PackageManager, string][] = [
  ["npm", "package-lock.json"],
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
];

const INSPECTABLE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const SECRET_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
]);
const NETWORK_NAMES = new Set([
  "anvil",
  "localhost",
  "mainnet",
  "mumbai",
  "sepolia",
  "goerli",
  "holesky",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
]);

function sourcePath(rootPath: string, filePath: string): string {
  return (
    relative(rootPath, filePath).replaceAll("\\", "/") || basename(filePath)
  );
}

function readManifest(rootPath: string): PackageManifest | undefined {
  const manifestPath = join(rootPath, "package.json");
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("package.json must contain an object");
    }
    return parsed as PackageManifest;
  } catch {
    throw new InspectionError(
      "MALFORMED_MANIFEST",
      `Could not parse package.json in ${rootPath}.`,
    );
  }
}

function dependencyNames(manifest: PackageManifest): Set<string> {
  const names = new Set<string>();
  for (const field of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]) {
    if (field) {
      for (const name of Object.keys(field)) names.add(name);
    }
  }
  return names;
}

function node(input: FindingInput): DependencyNode {
  return {
    nodeId: input.nodeId,
    type: input.type,
    name: input.name,
    label: input.name,
    evidenceSource: input.evidenceSource,
    evidence: input.evidence,
    confidence: input.confidence ?? "detected",
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function findFiles(rootPath: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name))
        continue;
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (INSPECTABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
  };
  visit(rootPath);
  return files.sort();
}

function addFinding(
  findings: Map<string, DependencyNode>,
  input: FindingInput,
): void {
  if (!findings.has(input.nodeId)) findings.set(input.nodeId, node(input));
}

function detectPackageManagers(
  rootPath: string,
  findings: Map<string, DependencyNode>,
): PackageManager[] {
  const managers: PackageManager[] = [];
  for (const [manager, lockfile] of LOCKFILES) {
    if (!managers.includes(manager) && statSafe(join(rootPath, lockfile))) {
      managers.push(manager);
      addFinding(findings, {
        nodeId: `package-manager:${manager}`,
        type: "package-manager",
        name: manager,
        evidenceSource: lockfile,
        evidence: `Lockfile ${lockfile} is present.`,
      });
    }
  }
  return managers;
}

function statSafe(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function detectStack(
  rootPath: string,
  manifest: PackageManifest,
  findings: Map<string, DependencyNode>,
): void {
  const names = dependencyNames(manifest);
  const packageEvidence = (name: string): FindingInput => {
    const displayName =
      name === "next"
        ? "Next.js"
        : name === "vite"
          ? "Vite"
          : name === "ethers"
            ? "Ethers"
            : name === "hardhat"
              ? "Hardhat"
              : name;
    return {
      nodeId: `dependency:${name}`,
      type:
        name === "react"
          ? "application"
          : ["wagmi", "viem", "ethers"].includes(name)
            ? "rpc"
            : "framework",
      name: displayName,
      evidenceSource: "package.json",
      evidence: `Dependency ${name} is declared in package.json.`,
    };
  };

  for (const name of [
    "react",
    "next",
    "vite",
    "wagmi",
    "viem",
    "ethers",
    "hardhat",
  ]) {
    if (names.has(name)) addFinding(findings, packageEvidence(name));
  }

  for (const config of [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.ts",
    "hardhat.config.js",
    "hardhat.config.ts",
    "foundry.toml",
  ]) {
    if (!statSafe(join(rootPath, config))) continue;
    const type: DependencyType =
      config === "foundry.toml"
        ? "contract"
        : config.startsWith("hardhat")
          ? "contract"
          : "framework";
    const name =
      config === "foundry.toml"
        ? "Foundry"
        : config.startsWith("hardhat")
          ? "Hardhat"
          : config.startsWith("next")
            ? "Next.js"
            : "Vite";
    addFinding(findings, {
      nodeId: `tool:${name.toLowerCase().replaceAll(".", "")}`,
      type,
      name,
      evidenceSource: config,
      evidence: `Configuration file ${config} is present.`,
    });
  }
}

function sanitizedText(raw: string): string {
  return raw
    .replace(
      /((?:private[_-]?key|mnemonic|password|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^"',\s}]+["']?/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^/\s"'`]+@[^\s"'`]+/gi, "$1[REDACTED_HOST]");
}

function inspectConfiguration(
  rootPath: string,
  findings: Map<string, DependencyNode>,
): {
  readonly chainIds: number[];
  readonly networkNames: string[];
  readonly rpcReferences: string[];
  readonly limitations: string[];
} {
  const chainIds = new Set<number>();
  const networkNames = new Set<string>();
  const rpcReferences = new Set<string>();
  const limitations = new Set<string>();

  for (const filePath of findFiles(rootPath)) {
    const relativePath = sourcePath(rootPath, filePath);
    if (SECRET_FILE_NAMES.has(basename(filePath).toLowerCase())) {
      limitations.add(`Skipped sensitive environment file ${relativePath}.`);
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      limitations.add(`Could not read ${relativePath}.`);
      continue;
    }
    const text = sanitizedText(raw);
    const chainMatches = text.matchAll(
      /(?:chainId|chain_id|networkId|network_id)["']?\s*[:=]\s*(\d+)/gi,
    );
    for (const match of chainMatches) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value)) chainIds.add(value);
    }
    for (const match of text.matchAll(
      /(?:network|chain)["']?\s*[:=]\s*["'`]([A-Za-z][A-Za-z0-9 _-]{1,30})["'`]/gi,
    )) {
      const name = match[1]?.trim();
      if (name) networkNames.add(name);
    }
    for (const match of text.matchAll(
      /(?:process\.env|import\.meta\.env|Bun\.env)\.([A-Z][A-Z0-9_]*)/g,
    )) {
      const variable = match[1];
      if (variable && /(RPC|URL|CHAIN|NETWORK)/i.test(variable)) {
        rpcReferences.add(`environment variable ${variable}`);
      }
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'`\\]+/g)) {
      try {
        const url = new URL(match[0].replace(/[),;]+$/, ""));
        rpcReferences.add(`URL origin ${url.origin}`);
      } catch {
        limitations.add(`Unparseable URL reference in ${relativePath}.`);
      }
    }
    for (const candidate of NETWORK_NAMES) {
      if (new RegExp(`\\b${candidate}\\b`, "i").test(text)) {
        networkNames.add(candidate);
      }
    }
    if (
      /(private[_-]?key|mnemonic|password|secret|token|api[_-]?key)\s*[:=]/i.test(
        raw,
      )
    ) {
      limitations.add(
        `Sensitive configuration values were redacted in ${relativePath}.`,
      );
    }
  }

  for (const chainId of [...chainIds].sort((a, b) => a - b)) {
    addFinding(findings, {
      nodeId: `chain:${chainId}`,
      type: "chain",
      name: String(chainId),
      evidenceSource: "configuration files",
      evidence: `Chain ID ${chainId} was found in a configuration file.`,
    });
  }
  for (const name of [...networkNames].sort()) {
    addFinding(findings, {
      nodeId: `network:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
      type: "chain",
      name,
      evidenceSource: "configuration files",
      evidence: `Network name ${name} was found in a configuration file.`,
    });
  }
  for (const reference of [...rpcReferences].sort()) {
    addFinding(findings, {
      nodeId: `rpc:${reference.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
      type: "rpc",
      name: reference,
      evidenceSource: "configuration files",
      evidence: "A non-secret RPC configuration reference was found.",
    });
  }
  return {
    chainIds: [...chainIds].sort((a, b) => a - b),
    networkNames: [...networkNames].sort(),
    rpcReferences: [...rpcReferences].sort(),
    limitations: [...limitations].sort(),
  };
}

export function inspectProject(inputPath: string = "."): InspectionSummary {
  const rootPath = resolve(inputPath);
  if (!directoryExists(rootPath)) {
    throw new InspectionError(
      "INVALID_DIRECTORY",
      `Inspection target is not a directory: ${rootPath}`,
    );
  }
  const manifest = readManifest(rootPath);
  const findings = new Map<string, DependencyNode>();
  const packageManagers = detectPackageManagers(rootPath, findings);
  addFinding(findings, {
    nodeId: "manifest:package-json",
    type: "application",
    name: "package.json",
    evidenceSource: "package.json",
    evidence: "Project manifest is present and valid JSON.",
  });
  detectStack(rootPath, manifest ?? {}, findings);
  if (!manifest) {
    findings.delete("manifest:package-json");
  }
  const configuration = inspectConfiguration(rootPath, findings);
  const dependencies = [...findings.values()].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId),
  );
  const manifestNode = findings.get("manifest:package-json");
  const edges: DependencyEdge[] = dependencies
    .filter((finding) => finding.nodeId !== manifestNode?.nodeId)
    .filter((finding) => finding.evidenceSource === "package.json")
    .map((finding) => ({
      edgeId: `edge:manifest-package-json:${finding.nodeId}`,
      fromNodeId: "manifest:package-json",
      toNodeId: finding.nodeId,
      relationship: "declares",
      evidenceSource: "package.json",
      confidence: "detected",
    }));

  const detectedStack = dependencies
    .filter(
      (finding) =>
        finding.nodeId.startsWith("dependency:") ||
        finding.nodeId.startsWith("tool:"),
    )
    .map((finding) => finding.name)
    .sort();
  const limitations = [
    ...(packageManagers.length > 1
      ? [
          `Conflicting package manager lockfiles detected: ${packageManagers.join(", ")}.`,
        ]
      : []),
    ...configuration.limitations,
    "Inspection reads manifests and configuration only; it does not execute project scripts.",
  ];
  return {
    schemaVersion: "1.0",
    rootPath,
    manifest: manifest ? "present" : "missing",
    packageManagers,
    packageManagerConflict: packageManagers.length > 1,
    detectedStack,
    dependencies,
    edges,
    chainIds: configuration.chainIds,
    networkNames: configuration.networkNames,
    rpcReferences: configuration.rpcReferences,
    limitations: [
      ...new Set([
        ...(manifest
          ? []
          : [
              "No package.json found; package dependency detection is unavailable.",
            ]),
        ...limitations,
      ]),
    ].sort(),
  };
}

export function createEmptyInspection(rootPath: string): InspectionSummary {
  return {
    schemaVersion: "1.0",
    rootPath,
    manifest: "missing",
    packageManagers: [],
    packageManagerConflict: false,
    detectedStack: [],
    dependencies: [],
    edges: [],
    chainIds: [],
    networkNames: [],
    rpcReferences: [],
    limitations: ["No inspection has been run."],
  };
}
