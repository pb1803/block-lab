#!/usr/bin/env node
/**
 * ARK-05 variant of the canonical test record: prints `studio-mm-002`.
 *
 * A separate file exists only because `STUDIO_EXPERIMENT_ID` needs setting in a
 * cross-platform way (no `FOO=bar` prefix on Windows cmd). The variable is set
 * before the shared module is imported, and the record is printed here because a
 * dynamic import makes the shared module's own direct-run check false.
 *
 * Usage:
 *   pnpm --filter @blocklab/studio run record:ark05
 *   pnpm --filter @blocklab/studio run record:ark05 -- --json
 */
import { createHash } from "node:crypto";

process.env.STUDIO_EXPERIMENT_ID = "studio-mm-002";
const mod = await import("./studio-mm-test-record.mjs");

const record = mod.buildRecord();
const json = JSON.stringify(record);
if (process.argv.includes("--json")) {
  process.stdout.write(`${json}\n`);
} else {
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(`experimentId: ${mod.EXPERIMENT_ID}\n`);
  process.stderr.write(`digest preimage: ${mod.DIGEST_PREIMAGE}\n`);
  process.stderr.write(`evidence digest: ${mod.EVIDENCE_DIGEST}\n`);
  process.stderr.write(
    `payload sha256: ${createHash("sha256").update(json).digest("hex")}\n`,
  );
}
