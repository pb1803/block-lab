import type { ExperimentMetadata } from "./schema.js";

/**
 * Discovery attribute a validated record maps to.
 *
 * Types intentionally follow Arkiv's schema types: `str` and `u64`. Values are
 * plain data so this module stays free of the Arkiv SDK (the SDK's `str()` /
 * `u64()` builders live on the browser side of the boundary).
 */
export type DiscoveryAttributeSpec =
  | { readonly name: string; readonly type: "str"; readonly value: string }
  | { readonly name: string; readonly type: "u64"; readonly value: number };

export type DiscoveryAttributeKind = "str" | "u64";

/**
 * The indexed subset of the record, enough for experiment discovery
 * (`scenario` + `status` + `experimentId`) without disclosing counts, latency
 * or the evidence digest on an index.
 */
export const DISCOVERY_ATTRIBUTES = [
  "experimentId",
  "experimentType",
  "scenarioName",
  "status",
  "targetChainId",
  "startedAtMs",
] as const;

export type DiscoveryAttributeName = (typeof DISCOVERY_ATTRIBUTES)[number];

/** Whether an attribute is indexed per the POC schema. */
export function isIndexedAttribute(name: string): boolean {
  return (DISCOVERY_ATTRIBUTES as readonly string[]).includes(name);
}

export function toDiscoveryAttributes(
  metadata: ExperimentMetadata,
): DiscoveryAttributeSpec[] {
  const specs: DiscoveryAttributeSpec[] = [];
  for (const name of DISCOVERY_ATTRIBUTES) {
    const value = metadata[name as keyof ExperimentMetadata];
    if (typeof value === "number") {
      specs.push({ name, type: "u64", value });
    } else if (typeof value === "string") {
      specs.push({ name, type: "str", value });
    }
  }
  return specs;
}
