/**
 * The Arkiv schema Studio writes and reads. It must stay in lockstep with the
 * dependency-free `@blocklab/arkiv-metadata` allowlist: a drift test asserts
 * the indexed columns equal `DISCOVERY_ATTRIBUTES` and the payload carries the
 * canonical JSON bytes.
 *
 * This is the browser side of the same boundary the POC uses
 * (`apps/arkiv-poc/src/entity/experiment-schema.ts`); the SDK's `str`/`u64`/
 * `bytes` builders are imported here, never into the shared contract package.
 */

import {
  bytes,
  defineSchema,
  type Schema,
  str,
  u64,
} from "@arkiv-network/sdk/schema";
import {
  ARKIV_ENTITY_TAG,
  type ExperimentMetadata,
  metadataToPayloadBytes,
} from "@blocklab/arkiv-metadata";

export const experimentSchema: Schema = defineSchema(ARKIV_ENTITY_TAG, {
  experimentId: str().indexed(),
  experimentType: str().indexed(),
  scenarioName: str().indexed(),
  status: str().indexed(),
  targetChainId: u64().indexed(),
  startedAtMs: u64().indexed(),
  completedAtMs: u64().optional(),
  payload: bytes(),
});

/** Maps a validated allowlisted record onto schema values. */
export function experimentValues(metadata: ExperimentMetadata) {
  return {
    experimentId: str(metadata.experimentId),
    experimentType: str(metadata.experimentType),
    scenarioName: str(metadata.scenarioName),
    status: str(metadata.status),
    targetChainId: u64(metadata.targetChainId),
    startedAtMs: u64(metadata.startedAtMs),
    ...(metadata.completedAtMs === undefined
      ? {}
      : { completedAtMs: u64(metadata.completedAtMs) }),
    payload: bytes(metadataToPayloadBytes(metadata)),
  };
}
