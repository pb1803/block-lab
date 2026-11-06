/*
 * No shebang: vitest imports this module from a VM context, and a `#!` line
 * there is a syntax error. The wrappers that are executed directly keep theirs.
 */
/**
 * Canonical test records for real browser-wallet publications.
 *
 * Two ids are defined, one per requirement, so an id is never reused:
 *
 * - `studio-mm-001` — ARK-07, the wallet-publication probe (already published;
 *   its bytes must stay frozen, so its preimage is kept verbatim).
 * - `studio-mm-002` — ARK-05, the two-wallet ownership-transfer probe.
 *
 * Both are deliberately *probes*, not measured experiments:
 *
 * - `status: "idle"` and zero request counts, because nothing was measured.
 * - A fixed synthetic timestamp per id, so the bytes are deterministic and anyone
 *   can regenerate exactly the same payload.
 * - `evidenceDigest` is the SHA-256 of the documented preimage below (a note, not
 *   a measurement), and `evidenceRef` points at the local runbook.
 * - The record is labelled a Studio test in its scenario name.
 *
 * It never touches `poc-write-001`. The duplicate preflight in
 * `studio-arkiv-preflight.mjs` refuses to write a second entity with the same id,
 * so re-running is safe.
 *
 * Usage:
 *   pnpm --filter @blocklab/studio run record:test          # studio-mm-001
 *   pnpm --filter @blocklab/studio run record:ark05         # studio-mm-002
 *   STUDIO_EXPERIMENT_ID=studio-mm-002 pnpm --filter @blocklab/studio verify:live
 *
 * The output is the exact JSON pasted into Studio's record textarea.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateExperimentMetadata } from "@blocklab/arkiv-metadata";

/** One frozen profile per published test id. Adding an id adds a profile. */
const RECORDS = {
  "studio-mm-001": {
    label: "BLOCKLAB ARK-07 Studio browser-wallet publication test record",
    experimentType: "publish-probe",
    scenarioName: "Studio wallet-signed publication test",
    // 2026-11-06T00:00:00Z
    startedAtMs: 1_762_387_200_000,
    evidenceRef: "evidence/studio-mm-001/publish-test.md",
  },
  "studio-mm-002": {
    label: "BLOCKLAB ARK-05 two-wallet ownership transfer test record",
    experimentType: "publish-probe",
    scenarioName: "Studio ownership-transfer test (ARK-05)",
    // 2026-11-07T00:00:00Z — a distinct fixed instant, never "now".
    startedAtMs: 1_762_473_600_000,
    evidenceRef: "evidence/studio-mm-002/transfer-test.md",
  },
};

/** @typedef {keyof typeof RECORDS} TestRecordId */

const requested = process.env.STUDIO_EXPERIMENT_ID ?? "studio-mm-001";
if (!Object.hasOwn(RECORDS, requested)) {
  throw new Error(
    `unknown STUDIO_EXPERIMENT_ID "${requested}" (known: ${Object.keys(RECORDS).join(", ")})`,
  );
}

export const EXPERIMENT_ID = /** @type {TestRecordId} */ (requested);

/**
 * The documented digest preimage, per id. Keep it in sync with the runbook
 * (docs/arkiv-ark07.md, docs/arkiv-ark05.md): the digest is verifiable against it.
 * The ARK-07 line is unchanged from before parameterisation, so `studio-mm-001`
 * still reproduces its published payload byte for byte.
 */
export const DIGEST_PREIMAGE = `${RECORDS[EXPERIMENT_ID].label} ${EXPERIMENT_ID}`;

export const EVIDENCE_DIGEST = createHash("sha256")
  .update(DIGEST_PREIMAGE, "utf8")
  .digest("hex");

/** Builds and validates the record; throws with the validation issues. */
export function buildRecord() {
  const profile = RECORDS[EXPERIMENT_ID];
  const result = validateExperimentMetadata({
    schemaVersion: "1.0",
    experimentId: EXPERIMENT_ID,
    experimentType: profile.experimentType,
    scenarioName: profile.scenarioName,
    // The chain this record targets: Rabdi itself. Nothing was measured on it.
    targetChainId: 7_794_095,
    status: "idle",
    // Fixed so the canonical bytes are reproducible.
    startedAtMs: profile.startedAtMs,
    requestCount: 0,
    succeededCount: 0,
    failedCount: 0,
    rpcFailureCount: 0,
    evidenceDigest: EVIDENCE_DIGEST,
    evidenceRef: profile.evidenceRef,
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
