import type { PublicArkivClient } from "@arkiv-network/sdk";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { experimentSchema } from "./entity/experiment-schema.js";
import { findExistingExperimentKey, firstEntityKey } from "./repository.js";

/**
 * A fake SDK client whose query chain returns a canned page. The cast keeps the
 * test to the one method under test instead of faking a whole viem client.
 */
function clientWithPage(
  entities: readonly { readonly $key?: Hex }[],
): PublicArkivClient {
  const fake = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return {
                    async fetch() {
                      return { entities };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return fake as unknown as PublicArkivClient;
}

describe("firstEntityKey", () => {
  it("returns the first key from a page of entities", () => {
    expect(firstEntityKey([{ $key: "0xaaa" }, { $key: "0xbbb" }])).toBe(
      "0xaaa",
    );
  });

  it("returns null for an empty page", () => {
    expect(firstEntityKey([])).toBeNull();
  });

  it("returns null when the first entity has no key", () => {
    expect(firstEntityKey([{}, { $key: "0xbbb" }])).toBeNull();
  });
});

describe("findExistingExperimentKey", () => {
  it("returns the existing key when a duplicate exists", async () => {
    const key = await findExistingExperimentKey(
      clientWithPage([{ $key: "0xdead" }]),
      experimentSchema,
      "poc-write-001",
    );
    expect(key).toBe("0xdead");
  });

  it("returns null when no duplicate exists", async () => {
    const key = await findExistingExperimentKey(
      clientWithPage([]),
      experimentSchema,
      "poc-write-001",
    );
    expect(key).toBeNull();
  });

  it("propagates a throttled check as a throw (never a silent no)", async () => {
    const broken = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return {
                      async fetch() {
                        throw new Error("HTTP 429 ANON_COST_LIMITED");
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as PublicArkivClient;
    await expect(
      findExistingExperimentKey(broken, experimentSchema, "poc-write-001"),
    ).rejects.toThrow(/ANON_COST_LIMITED/);
  });
});
