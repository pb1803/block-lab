# ARK-06 — real entity expiry, investigation and experiment plan

**Status: INVESTIGATION ONLY — PARTIAL.** No transaction was broadcast, no wallet
was connected or asked to sign, no entity was created, extended or deleted. Every
chain number below was read over RPC. Nothing here claims that an expiry
transition was *observed*; ARK-06 stays PARTIAL until the experiment in
[§7](#7-experiment-design) has run and an expired entity has been read back and
independently checked.

## 1. Objective and boundaries

ARK-06 is "verify expiry". Expiry has been *configured* three times (`expiryDays`
7 on all three entities, `expiresAt == createdAt + 302400`), but no entity has
ever been seen to die, so the post-expiry read behaviour is only unit-tested.

This document settles what the protocol actually does from SDK source, states what
the live records currently show, and designs the cheapest safe way to observe a
real transition while leaving every existing record untouched.

Not in scope: any write, any signature, any UI change.

## 2. Verified from SDK and protocol source

`@arkiv-network/sdk@1.0.1`, read in `apps/studio/node_modules/@arkiv-network/sdk`.
Line references are to that copy, so they are reproducible at this commit.
Everything here is source evidence, not inference from UI or from our own config.

### 2.1 Representation: two `uint64` block values, not a timestamp

Create and extend both carry the same pair on the wire:

```ts
// src/entity/operations.ts:38-45
[OperationType.Create]: parseAbiParameters(
  `(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, ${ATTRIBUTE_TUPLE} attributes)`,
),
[OperationType.ExtendExpiry]: parseAbiParameters(
  "(bytes32 entityKey, uint64 expiresAt, uint64 minLifetime)",
),
```

Both values are **block heights / block counts**, not wall-clock. The SDK turns
durations into blocks at `BLOCK_TIME = 2` seconds (`src/consts.ts:5`) and rejects a
duration that is not a whole multiple of it (`src/entity/expiry.ts:152-176`).

The read side exposes the resolved result as `$expiresAt`, a queried/selected
`u64` (`src/query/expression.ts:143`, `src/query/selection.ts:30`).

### 2.2 Resolution: `max(expiresAt, landingBlock + minLifetime)`

> "the engine resolves it as `max(expiresAt, currentBlock + minLifetime)` —
> whichever is later" — `src/entity/expiry.ts:15-17`

The same rule is applied to creates and extensions, and the bound checks are done
twice — in the SDK before sending, and by the engine at execution
(`src/utils/arkivTransactions.ts:138-140`). A deadline (`atBlock`/`atDate`) is
therefore only a *lower* bound unless it is paired with a floor; the `family`
helpers (`fromDays` etc.) put everything in `minLifetime` and leave `expiresAt` at
`0n` (`src/entity/expiry.ts:37`, `src/utils/expirationTime.ts:19-31`).

### 2.3 Maximum lifetime

`MAX_LIFETIME = 7_884_000n` blocks ≈ 182.5 days at 2 s (`src/consts.ts:9-11`),
counted from the block the transaction lands in. Over it, the engine reverts
`ExpiryBeyondMaxLifetime(target, currentBlock, maxLifetime)`
(`src/utils/arkivTransactions.ts:69`, text in `src/utils/revert.ts:94-97`); the SDK
refuses it first (`src/entity/expiry.ts:112-126`). `ExpirationTime.max()` is the
sanctioned maximum.

### 2.4 Minimum lifetime

There is **no minimum-lifetime constant** anywhere in the SDK. The only lower bound
is the dead-on-arrival rule:

```ts
// src/entity/expiry.ts:132-137
if (target <= currentBlock) {
  throw new InvalidExpiryError(
    `the entity would expire at block ${target}, which is not after the current block ` +
      `${currentBlock}, so it would be dead on arrival`,
  )
}
```

The engine has the matching revert `ExpiryDeadOnArrival(target, currentBlock)`
(`src/utils/arkivTransactions.ts:68`, text `src/utils/revert.ts:88-92`).

Because the engine re-resolves against the *landing* block (§2.2) while the SDK
only checks against the block it built on, `minLifetime: 1` is always safe: the
target becomes `landingBlock + 1`, strictly after the landing block, however late
the transaction lands. **The shortest expressible lifetime is one block, ≈ 2
seconds**, via `ExpirationTime.fromBlocks(1)` (`src/utils/expirationTime.ts:108-121`).

The one-block case is only unsafe when it is expressed as an absolute deadline with
no floor, since then nothing is re-resolved.

### 2.5 Shortening after creation: no

```ts
// src/actions/wallet/extendEntity.ts:15-21
 * An extension **sets a new expiry**; it does not add to the existing one. …
 * The engine rejects an extension that would move the expiry earlier, so extending an entity by
 * less than it already has left is an error rather than a silent shortening. One that resolves to
 * the current expiry changes nothing.
```

Engine revert: `ExpiryNotExtended(entityKey, newExpiresAt, currentExpiresAt)` —
"already expires at block X, so extending it to Y would shorten its life"
(`src/utils/arkivTransactions.ts:70`, `src/utils/revert.ts:98-104`).

So `studio-mm-001` and `studio-mm-002` **cannot** be shortened: their 7-day windows
have to be waited out (or extended), which is exactly why a dedicated short-lived
entity is the only cheap option.

There is no "reduce expiry" operation at all — only `ExtendExpiry`.

### 2.6 Enforcement layering

| Layer | Rule it enforces | Evidence |
|---|---|---|
| Contract (protocol) | max lifetime, dead-on-arrival, no shortening, and a declared revert for writing to an expired entity (`EntityExpired(entityKey, expiresAt)`, never yet triggered) | `src/utils/arkivTransactions.ts:61-70`; `src/utils/revert.ts:69-104` |
| SDK | same bounds before sending, so most mistakes never reach the chain | `src/entity/expiry.ts:104-137` |
| Node/indexer | *readability*: an expired entity simply stops being returned | `src/types/rpcSchema.ts:99-102` |

Nothing on chain flips a flag when an entity dies: there is **no expiry event**.
`ENTITY_EVENTS_ABI` carries only `EntityCreated`, `EntityPatched`, `ExpiryExtended`,
`OwnershipTransferred`, `EntityDeleted` (`src/entity/events.ts:8-12`). Expiry is
silent — it changes what reads and writes see, and emits nothing.

### 2.7 Read behaviour of an expired entity: indistinguishable from never-existed

```ts
// src/types/rpcSchema.ts:99-102
Method: "arkiv_getEntity"
Parameters: [entityKey: Hex]
/** Every field except `attributeSchema`, or `null` if no live entity has the key. */
ReturnType: RpcEntity | null
```

`getEntity` turns `null` into `NoEntityFoundError` with a message that names all
three causes at once ("never created, or … deleted or … expired",
`src/errors.ts:13-25`; `src/actions/public/getEntity.ts:19-22,44`). The SDK-level
`select` docs use the same wording (`src/clients/decorators/arkivPublic.ts:67-68`).

Consequence for this phase: **there is no "expired" RPC result to assert on.** The
only observable is a `null`/`NoEntityFoundError` that must be *timed* against
`$expiresAt` to be meaningful. A read that arrives after the deadline cannot by
itself distinguish "expired" from "wrong key".

### 2.8 Boundary

An entity is live while `block.number < $expiresAt` and is already expired at
`block.number == $expiresAt`. Two independent pieces of evidence: the
dead-on-arrival rule rejects a target equal to the current block (§2.4), and the
revert text reads "entity … **expired at block** N" (§2.6), i.e. block N is
expired, not the last live block.

That the boundary sits at `expiresAt` and not `expiresAt - 1` is the one rule in
this document that still needs the live run to confirm (§7.6, §11).

### 2.9 Extension while readonly

`readonly` freezes attributes, not life: "Its expiry can still be extended, and it
can be transferred or deleted" (`src/utils/revert.ts:77-80`), and
`permissionlessExtension` lets a third party extend without owning
(`src/entity/flags.ts:17-23`). Neither flag is used by any current record.

## 3. Existing records: what they show (read-only, 2026-11-07)

Head was `286885` at the time of these reads; 500 blocks spanned 1002 s, so the
chain is producing at `2.00 s/block` (≈ 43 200 blocks/day).

| Entity | `createdAt` | `$expiresAt` | Blocks left | ≈ time left |
|---|---|---|---|---|
| `poc-write-001` | 269199 | 571599 | 284714 | 6.6 days |
| `studio-mm-001` | 283822 | 586222 | 299337 | 6.9 days |
| `studio-mm-002` | 285811 | 588211 | 301326 | 7.0 days |

All three: lifetime `302400` blocks, exactly `expiryDays: 7`. All three are still
inside their windows, so they contribute *configuration* evidence only, no
transition.

`poc-write-001` is the nearest deadline (6.6 days). It is also the cheapest
observation that needs **zero** transactions — but it costs 6.6 days of waiting and
a sparse poll (§8).

## 4. Verified vs assumed

| Claim | Status |
|---|---|
| Expiry is two `uint64` block values; resolved `max(...)` | **verified** (§2.1, §2.2) |
| Max lifetime 7 884 000 blocks, 182.5 days | **verified** (§2.3) |
| No protocol minimum; 1 block is the floor | **verified** by absence of any minimum plus the DoA rule (§2.4) |
| Cannot shorten; `ExpiryNotExtended` | **verified** (§2.5) |
| No expiry event; `getEntity` returns `null` | **verified** (§2.6, §2.7) |
| Boundary is `block == expiresAt` | **assumed** from the DoA rule and revert wording (§2.8) |
| `select` also stops returning an expired entity | **assumed** from "no live entity" (§2.7); not measured |
| An expired entity's row is gone for good (no tombstone read) | **assumed**; `deleteEntity` has its own event, expiry has none (§2.6) |
| A 1-block lifetime survives a real transaction | **unverified**; follows from the landing-block resolution but unobserved |
| A write against an expired entity reverts | **assumed** — `EntityExpired` is declared in the engine error ABI but never seen triggered (§2.6) |
| Indexer behaviour after the deadline (immediate? lagging?) | **unverified**, and the main measurement target |

## 5. Constraints this puts on the design

1. **The three existing records cannot be reused as a *short* experiment.** No
   shortening (§2.5). They can only be waited out (§8).
2. **The probe cannot go through Studio's publish panel** as it stands: the shared
   metadata contract stores `expiryDays` as an *integer* 1..182
   (`packages/arkiv-metadata/src/validate.ts:74-83, 264-271`) and the gateway maps it
   with `ExpirationTime.fromDays` (`apps/studio/src/arkiv/gateway.ts:118`). One day
   is the smallest value it can express — ~43 200 blocks, ~24 h. The probe therefore
   needs its own script; it does not need a schema change (§7.2).
3. **The existing read tooling is schema-bound.** `verify:entity` reads through
   `experimentSchema` (`apps/studio/scripts/verify-entity.mjs:114`), and a read
   through a schema requires the schema tag and every required column, throwing
   `SchemaMismatchError` otherwise
   (`node_modules/@arkiv-network/sdk/src/query/selection.ts:383-420`). A bare,
   attribute-less probe would break every verifier, so the probe is published
   *through* the shared contract even though `expiryDays` cannot express its
   lifetime (§7.2).
4. **The gate scripts take a frozen record profile, not an arbitrary id.**
   `preflight:test` and `verify:live` import `EXPERIMENT_ID` from
   `apps/studio/scripts/studio-mm-test-record.mjs:60-67`, which throws on an
   unregistered id. `ark06-expiry-001` is not registered, so the probe script carries
   its own read-only preflight instead of touching the studio-mm profiles (§7.3).
5. **The probe must be complete at creation.** Nothing can be written back after
   the deadline (the entity is unreachable), so the payload has to carry the plan,
   the expected block and the criteria up front.
6. **The id becomes reusable**, because the duplicate query is a live indexed read
   (`apps/studio/scripts/studio-arkiv-preflight.mjs:78-95`) — after expiry it reads
   as "clear to publish". Distinct ids per run avoid the trap.
7. **The observation window is seconds, not minutes.** The read loop must be armed
   *before* the create is sent, or the chance to capture an active state is lost.

## 6. Identifiers and artefacts

| Item | Value |
|---|---|
| Experiment id | `ark06-expiry-001` |
| Evidence dir | `evidence/ark06-expiry-001/` (not staged) |
| Probe payload | `.ark06-expiry-payload.json` (repo root, not staged, pasted into the script) |
| Probe log | `.ark06-expiry.log` (repo root, not staged) |
| Payload contract | shared metadata, status `running` — see §7.2 |

`ark06-expiry-001` is new and never used; `studio-mm-*` stay reserved for the
ownership probes.

## 7. Experiment design

### 7.1 Shape

One `createEntity` on Rabdi at **5 blocks** of lifetime (~10 s), signed by the
existing POC harness signer `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759`
(funded: 4.999790895 tGLM, nonce 1; key already in `apps/arkiv-poc/.env.local`).
**No MetaMask prompt and no wallet switch** are needed, so the run stays fully
automatable and the human step is authorization only.

5 blocks rather than 1: one block is the protocol floor but leaves no room for a
first read between the receipt and the deadline, and a missed active state means a
wasted transaction. 5 blocks gives ~10 s, still short enough to be watched block by
block.

The entity is created through `experimentSchema` with a validated metadata payload
(§5.3), so the verifier, the duplicate query and Studio's key input all work on it
unchanged.

### 7.2 Payload

`validateExperimentMetadata` output as canonical JSON bytes — no personal data, no
secrets:

| Field | Value | Why |
|---|---|---|
| `schemaVersion` | `"1.0"` | contract |
| `experimentId` | `"ark06-expiry-001"` | unique, never used |
| `experimentType` | `"expiry-probe"` | free string (`packages/arkiv-metadata/src/schema.ts:73`) |
| `scenarioName` | `"entity expiry transition on rabdi"` | what is measured |
| `targetChainId` | `7794095` | Rabdi itself |
| `status` | `"running"` | the result is unknown at creation, and terminal statuses demand `completedAtMs` (`src/schema.ts:44-49`) |
| `startedAtMs` | fixed at build time | reproducible bytes |
| counts | all `0` | nothing measured |
| `evidenceDigest` | SHA-256 of `BLOCKLAB ARK-06 expiry probe ark06-expiry-001` | same convention as the studio-mm profiles (`scripts/studio-mm-test-record.mjs:75-80`) |
| `evidenceRef` | `evidence/ark06-expiry-001/plan.md` | reviewable pointer |
| `expiryDays` | `1` | the contract's floor — **not** the true lifetime |

`expiryDays: 1` is the honest floor of a contract that only speaks whole days; a
10-second entity is shorter than it can express. The real lifetime is `5 blocks`,
carried by `evidenceRef` and by the entity's own `$expiresAt`. That limitation is
recorded rather than hidden.

Status caveat that matters for later readers: the record is published as `running`
and can never be closed out, because the entity dies first. Nobody should expect a
terminal status on it.

### 7.3 Command sequence (execution stage, ~1 transaction)

1. **Read-only preflight inside the probe script** (the gate scripts cannot take this
   id, §5.4): the duplicate query `eq("experimentId", "ark06-expiry-001")` must be
   empty, `getChainId()` must be `7794095`, the signer balance must exceed 0.01 tGLM,
   and the head is captured. Abort on any failure.
2. **Arm the poller first**, at 1 read per ~1.5 s: track `head` via `getBlockNumber`
   and call `getEntity(key, experimentSchema)`; from the first hit on, log per block
   `{block, state: live|dead, latencyMs, error}`. Running before the create is what
   keeps the earliest blocks from being missed.
3. **Create once** with `ExpirationTime.fromBlocks(5)` and the §7.2 payload, via
   `apps/studio/scripts/arkiv-06-probe.mjs` (bare-specifier imports, so the file must
   live inside `scripts/`); print `entityKey`, `txHash`, `expiresAt`.
4. Log `expiresAt == landingBlock + 5` as satisfied or violated — §2.2 made visible.
5. Let the poller cross the boundary, then stop it. **One create, no retry.**
6. While the entity is still alive, one independent second-process run of
   `verify:entity --entity <key> --record <payload.json> --signer 0x8C58…8759 --tx <tx>`
   must pass.
7. After the deadline, repeat it — expected is exit 1 with
   `No live entity with key … expired` — and record the literal `null` from a raw
   `arkiv_getEntity` call.
8. Re-run the duplicate query: the id must read as clear again (§5.6).
9. Re-read `poc-write-001`, `studio-mm-001`, `studio-mm-002`: all three must still
   be live and unchanged apart from age.

### 7.4 Expected cost

| Item | Value |
|---|---|
| Transactions | 1 (create) |
| Gas | ~150–190 k by analogy with the 187 358 gas of `studio-mm-002`; ≈ 0.00015–0.00019 tGLM at 1 gwei |
| Funding needed | ≤ 0.001 tGLM; signer holds 4.9998 |
| Wall-clock | ~30 s of polling, plus setup |
| Blocks consumed | 5 + a few confirmation blocks |

### 7.5 Timeline

| Phase | Time |
|---|---|
| Preflight + poller arm | < 1 min |
| Create → mined | ~5 s (A-like latency, no wallet prompt) |
| Expiry reached | ~10 s after mining |
| Boundary sampling | ~10 s |
| Independent verification + untouched checks | ~1 min |
| **Total** | **~3 min** |

### 7.6 Boundaries measured

- last live block and first dead block, by number, against `$expiresAt` (§2.8);
- whether the failure is `null` → `NoEntityFoundError` or something else;
- whether `select` by `experimentId` drops the entity at the same block or earlier;
- read latency across the boundary, to separate protocol effect from indexer delay.

### 7.7 Evidence to record

Head/block of every sample, the create tx hash and receipt status, `expiresAt` vs
`landingBlock + 5`, the raw `null` result, the SDK error text, poller latency at the
boundary, the two duplicate-preflight exits, and the three untouched-entity reads.
Poller output pasted unchanged; failures shown rather than smoothed over.

## 8. Fallback without any transaction: wait out `poc-write-001`

Usable if the signer must not spend, or to corroborate the probe.

- **6.6 days** (284 714 blocks at 2.00 s/block, §3), deadline block `571599`.
- Zero gas, zero transactions, zero risk to other records.
- Sample sparsely to stay clear of 429s: once a day until 24 h out, every 15 min in
  the last hour, then every block from `expiresAt − 50` to `expiresAt + 50`.
- Caveat: `poc-write-001`'s whole 7-day life is already run, so the boundary is the
  50/50 read stack above — nothing else about it changes.

`studio-mm-001` (586222) and `studio-mm-002` (588211) can double as *free*
confirmation a day later while they are still live, but the two-wallet entity must
not be republished or mutated for ARK-06.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Entity dies before the first read, no active state | 5 blocks, not 1; poller armed before the create |
| Poller misses a block (event-loop or socket stall) | 1.5 s interval against 2 s blocks; latency logged |
| Node 429 | one read per interval; alert-free single key; stop after `expiresAt + 50` |
| Create reverts (DoA, gas) | no retry — investigate read-only, the fallback in §8 still stands |
| Ambiguity: is a `null` expiry or an indexer hiccup? | every sample carries block + latency; a `null` is only accepted when the block is past `expiresAt` **and** a second process sees the same `null` |
| Probe mistaken for a finished experiment | `experimentType: "expiry-probe"`, status `running`, `expiryDays: 1` explained by `evidenceRef` (§7.2) |
| Accidentally republishing `ark06-expiry-001` later | the preflight reads clear post-expiry — check the log's `entityKey` first |
| Secrets | none embedded; env stays `apps/arkiv-poc/.env.local` |

## 10. Success criteria

The experiment is successful **only if all of these hold**:

1. exactly one create transaction, mined with status `success`;
2. `$expiresAt == landingBlock + 5` (the resolution rule of §2.2 holds on chain);
3. at least one read before the deadline returned the entity, proving an active
   state was actually observed;
4. the first read at `block >= $expiresAt` returns `null`, i.e. `NoEntityFoundError`;
5. an independent second process reproduces the `null`;
6. `select` by `experimentId` no longer returns the entity;
7. the three pre-existing entities are still live and unchanged;
8. the duplicate preflight for `ark06-expiry-001` exits clear again;
9. the boundary lands at `expiresAt`, not `expiresAt − 1` (if it lands one block
   earlier or later, the boundary rule of §2.8 is **refuted** and recorded as such).

Anything short of that is a partial result and ARK-06 stays PARTIAL.

## 11. Open questions

1. **Boundary exactness** — `== expiresAt` dead, or `< expiresAt` live? (§2.8 assumed
   from DoA + revert wording, not measured.)
2. **Is expiry evaluated at read time or by an index sweep?** A lag would show as an
   extra live block after the deadline; this decides what ARK-08 can honestly claim.
3. **Does `select`/history drop the row at the same instant as `getEntity`?**
4. **Is a dead key ever revived?** (Re-create the same `experimentId` → new key, or
   reused key? Actual key derivation suggests a fresh salt → new key, unverified.)
5. **Is one block genuinely enough** to survive mining (§2.4), or does the engine also
   apply a minimum? Only the run can say.
6. **What does `ExpiryExtended` report for a dead entity** — can a dead entity be
   revived by extension, or is `EntityExpired` fatal for writes? Read from the revert
   list it looks fatal (`EntityExpired` exists as a write-side revert,
   `src/utils/arkivTransactions.ts:62`), but that is untested; if it *is* revivable,
   §8's fallback can also be rescued rather than lost.

## 12. ARK-08 implications (no UI change in this phase)

Expiry feeds ARK-08's `expired` state, and the current code has four concrete
mismatches to settle once §7 has produced facts:

1. **No expired state exists in the detail machine.** `detail-failed` with category
   `missing` → phase `missing` (`apps/studio/src/arkiv/controller.ts:507-508`,
   `apps/studio/src/arkiv/state.ts:343-347`). The copy is honest — "never created,
   or it has been deleted or has expired" (`apps/studio/src/arkiv/view.ts:350-351`)
   — but it cannot tell a user which of the three they are looking at.
2. **The explicit `expired` reason is unreachable for a truly expired entity.** It
   lives in `transferBlockReason` (`apps/studio/src/arkiv/ownership.ts:167-171`) and
   needs a successful read, but an expired entity fails `readOwnership` first, so the
   preview path lands in `missing` before the branch is reached.
3. **Nothing re-reads a detail panel once opened.** `isExpiredAt`
   (`apps/studio/src/arkiv/record.ts:150-155`) is exported but unused outside tests;
   there is no watcher, so a panel opened minutes before the deadline shows a live
   entity forever. This is exactly the 10-second window the probe exercises.
4. **The history list silently loses entries.** Expired rows stop coming back from
   `select`, so a 7-day-old experiment disappears from Studio with no marker, and
   there is no way to distinguish "aged out" from "never existed".

A fifth point is design-level: the probe in §7 is unreachable through the publish
panel because the panel can only express whole days (§5.2). If short lifetimes are
wanted in the product, the panel needs a block-level expiry control; for ARK-08 the
key-input path already accepts any key, so the probe can be displayed and watched
without one.

## 13. Notes for the execution stage

- Script shape follows the existing `scripts/` pattern (bare-specifier imports, so
  the file must live in `apps/studio/scripts/`), driver-style single exit path
  (`Stop` not `process.exit()` while sockets are open).
- `verify:entity` currently treats a read failure as `FAILED … exit 1`
  (`apps/studio/scripts/verify-entity.mjs:114-117`). Post-expiry that is the
  *expected* result, so the execution stage should add an `--expect-expired` flag
  rather than hand-wave a pass. That is a code change and is deferred, not done here.
- The probe id is not a frozen record id, so `studio-mm-test-record.mjs` and its two
  pinned hashes stay untouched; the probe builds and validates its own metadata with
  the shared package instead of a profile.
- `ark06-expiry-001` must not be re-published after it expires even though the
  duplicate query will say the id is free again (§5.6).
- Creating through `experimentSchema` means the probe must also write the schema tag
  and the `toDiscoveryAttributes` triples, and pass `expiration:
  ExpirationTime.fromBlocks(5)` itself instead of going through the gateway's
  `fromDays` (`apps/studio/src/arkiv/gateway.ts:118`).

## 14. Verification of this phase

Docs and backlog only, so nothing runtime changed; `pnpm test` (386), `pnpm lint`,
`pnpm typecheck` and `pnpm build` are run anyway to prove it. No `.env*`, key,
access key or wallet data is added — this document quotes only public addresses,
block numbers and hashes.
