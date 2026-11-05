#!/usr/bin/env node

import {
  InspectionError,
  type InspectionSummary,
  inspectProject,
} from "@blocklab/inspector";

const EXIT_USAGE = 2;
const EXIT_INSPECTION = 3;

function printHuman(summary: InspectionSummary): void {
  const managers =
    summary.packageManagers.length > 0
      ? summary.packageManagers.join(", ")
      : "none detected";
  process.stdout.write(`BLOCKLAB inspection\n\n`);
  process.stdout.write(`Root: ${summary.rootPath}\n`);
  process.stdout.write(`Package managers: ${managers}\n`);
  if (summary.packageManagerConflict) {
    process.stdout.write(
      "Warning: conflicting package manager lockfiles detected.\n",
    );
  }
  process.stdout.write(
    `Detected stack: ${summary.detectedStack.join(", ") || "none detected"}\n`,
  );
  process.stdout.write(
    `Chain IDs: ${summary.chainIds.join(", ") || "none detected"}\n`,
  );
  process.stdout.write(
    `Networks: ${summary.networkNames.join(", ") || "none detected"}\n`,
  );
  process.stdout.write(
    `RPC references: ${summary.rpcReferences.join(", ") || "none detected"}\n`,
  );
  process.stdout.write("\nEvidence:\n");
  for (const finding of summary.dependencies) {
    process.stdout.write(
      `- ${finding.name} [${finding.type}; ${finding.confidence}] — ${finding.evidenceSource}: ${finding.evidence}\n`,
    );
  }
  if (summary.limitations.length > 0) {
    process.stdout.write("\nLimitations:\n");
    for (const limitation of summary.limitations) {
      process.stdout.write(`- ${limitation}\n`);
    }
  }
}

function printUsage(): void {
  process.stderr.write(
    "Usage: blocklab inspect [directory] [--json]\n" +
      "       blocklab scenarios\n",
  );
}

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === "scenarios") {
    process.stdout.write(
      "Scenarios command is available in the foundation shell.\n",
    );
    return 0;
  }
  if (args[0] !== "inspect") {
    printUsage();
    return EXIT_USAGE;
  }
  const json = args.includes("--json");
  const paths = args.slice(1).filter((arg) => arg !== "--json");
  if (paths.length > 1) {
    process.stderr.write("Error: inspect accepts at most one directory.\n");
    return EXIT_USAGE;
  }
  try {
    const summary = inspectProject(paths[0] ?? ".");
    if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    else printHuman(summary);
    return 0;
  } catch (error) {
    if (error instanceof InspectionError) {
      process.stderr.write(`Error [${error.code}]: ${error.message}\n`);
      return EXIT_INSPECTION;
    }
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : "Inspection failed."}\n`,
    );
    return EXIT_INSPECTION;
  }
}

process.exitCode = main();
