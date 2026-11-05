/**
 * Read-side repository helper for the POC and the write harness.
 *
 * Both the browser gateway and `scripts/try-write.mjs` must answer the same
 * question before signing anything: does an entity with this experiment id
 * already exist? Keeping the query in one place means the harness and the UI
 * cannot drift, and the duplicate rule is testable without a network.
 *
 * The client and the schema are passed in rather than imported, so this module
 * never decides which network, access key or schema is used. That also keeps it
 * loadable by Node's type stripping, which does not rewrite `.js` specifiers.
 */
import type { PublicArkivClient } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import type { Schema } from "@arkiv-network/sdk/schema";
import type { Hex } from "viem";

/**
 * Returns the key of an existing entity for `experimentId`, or null.
 *
 * A thrown error means the check could not run (throttled or offline). Callers
 * must treat that as "unknown", never as "no duplicate", and must not sign.
 */
export async function findExistingExperimentKey(
  client: PublicArkivClient,
  schema: Schema,
  experimentId: string,
): Promise<Hex | null> {
  const page = await client
    .select({ $key: true })
    .from(schema)
    .where(eq("experimentId", experimentId))
    .limit(5)
    .fetch();
  return firstEntityKey(page.entities);
}

/** Pure mapping from a query page onto the first usable key. */
export function firstEntityKey(
  entities: readonly { readonly $key?: Hex }[],
): Hex | null {
  const first = entities[0];
  if (first === undefined || first.$key === undefined) return null;
  return first.$key;
}
