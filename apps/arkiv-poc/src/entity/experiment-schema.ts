import { bytes, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import {
  ARKIV_ENTITY_TAG,
  type ExperimentMetadata,
  metadataToPayloadBytes,
} from "@blocklab/arkiv-metadata";

/**
 * The named Arkiv schema every BLOCKLAB record is written through. The name
 * tags each write with an indexed `arkiv.schema` attribute, so a query through
 * this schema only ever sees BLOCKLAB's own entities.
 *
 * Indexed columns are the discovery subset; `payload` holds the canonical JSON
 * record and is stored but never indexed, matching the metadata contract.
 */
export const experimentSchema = defineSchema(ARKIV_ENTITY_TAG, {
  experimentId: str().indexed(),
  experimentType: str().indexed(),
  scenarioName: str().indexed(),
  status: str().indexed(),
  targetChainId: u64().indexed(),
  startedAtMs: u64().indexed(),
  completedAtMs: u64().optional(),
  payload: bytes(),
});

/** Maps the validated, allowlisted record onto schema values. */
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
