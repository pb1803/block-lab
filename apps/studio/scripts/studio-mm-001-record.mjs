#!/usr/bin/env node
/**
 * Canonical ARK-07 test record for a real browser-wallet publication.
 *
 * This is deliberately a *publication probe*, not a measured experiment:
 *
 * - `status: "idle"` and zero request counts, because nothing was measured.
 * - A fixed synthetic timestamp, so the bytes are deterministic and anyone can
 *   regenerate exactly the same payload.
 * - `evidenceDigest` is the SHA-256 of the documented preimage below (a note,
 *   not a measurement), and `evidenceRef` points at the local runbook.
 * - The record is labelled a Studio publication test in its scenario name.
 *
 * It never touches `poc-write-001`. The duplicate preflight in
 * `studio-arkiv-preflight.mjs` refuses to write a second entity with the same
 * id, so re-running is safe.
 *
 * Usage:
 *   pnpm --filter @blocklab/studio exec node scripts/studio-mm-001-record.mjs
 *
 * The output is the exact JSON pasted into Studio's record textarea.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";

export const EXPERIMENT_ID = "studio-mm-001";

/**
 * The documented digest preimage. Keep this string and the runbook
 * (docs/arkiv-ark07.md) in sync: the digest is verifiable against it.
 */
export const DIGEST_PREIMAGE =
  "BLOCKLAB ARK-07 Studio browser-wallet publication test record studio-mm-001";

export const EVIDENCE_DIGEST = createHash("sha256")
  .update(DIGEST_PREIMAGE, "utf8")
  .digest("hex");

/** Builds and validates the record; throws with the validation issues. */
export function buildRecord() {
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: EXPERIMENT_ID,
    experimentType: "publish-probe",
    scenarioName: "Studio wallet-signed publication test",
    // The chain this record targets: Rabdi itself. Nothing was measured on it.
    targetChainId: 7_794_095,
    status: "idle",
    // 2026-11-06T00:00:00Z — fixed so the canonical bytes are reproducible.
    startedAtMs: 1_762_387_200_000,
    requestCount: 0,
    succeededCount: 0,
    failedCount: 0,
    rpcFailureCount: 0,
    evidenceDigest: EVIDENCE_DIGEST,
    evidenceRef: "evidence/studio-mm-001/publish-test.md",
    expiryDays: 7,
  });
  if (!result.ok) {
    throw new Error(
      result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "),
    );
  }
  return result.metadata;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const record = buildRecord();
  const json = JSON.stringify(record);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${json}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    process.stderr.write(`experimentId: ${EXPERIMENT_ID}\n`);
    process.stderr.write(`digest preimage: ${DIGEST_PREIMAGE}\n`);
    process.stderr.write(`evidence digest: ${EVIDENCE_DIGEST}\n`);
    process.stderr.write(
      `payload sha256: ${createHash("sha256").update(json).digest("hex")}\n`,
    );
  }
}