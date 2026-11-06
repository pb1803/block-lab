# ARK-06B — expiry verification implementation and live-run preparation

**Status: RUN (2026-11-07) — boundary observed, expiry independently verified.**
One authorized create was broadcast under explicit approval; the entity expired on
schedule and the closing verifier returned `expected-expired` 7/7 with exit 0. Live
evidence and deviations: [docs/arkiv-ark06.md](arkiv-ark06.md) §15, and [§10](#10-live-run-actual-2026-11-07)
below. `ark06-expiry-001` no longer exists on chain.

**Prepared, not run** below is kept as the record of the preparation stage, except
where §10 corrects it.

Built on the investigation in [docs/arkiv-ark06.md](arkiv-ark06.md) (commit
`68ccc4f`): the protocol rules there are not repeated and not second-guessed. This
document covers the *implementation* both sides of the experiment need — the
verifier that can call an expiry proven, and the probe that produces one — plus
the dry-run evidence that they work.

## 1. What was built

| Piece | File | Why |
|---|---|---|
| Expiry verification logic (pure) | `apps/studio/src/arkiv/verify-expiry.ts` | Turns a lookup result plus a deadline into a verdict, and refuses to call a failed query an expiry |
| Its tests | `apps/studio/src/arkiv/verify-expiry.test.ts` | 19 unit tests over every verdict branch |
| `--expect-expired` mode | `apps/studio/scripts/verify-entity.mjs` | The CLI form of the same thing, schema-bound and independent of the probe |
| Probe (dry-run default) | `apps/studio/scripts/arkiv-06-probe.mjs` | The only write in the experiment, behind an explicit `--live` switch |
| Package scripts | `apps/studio/package.json` | `probe:ark06` (dry-run) and `probe:ark06:live` (armed) |

Nothing in Studio's UI changed and no on-chain record was touched.

## 2. New verification behaviour

Default `verify:entity` behaviour is untouched: without `--expect-expired` the
script does exactly what it did before (payload, hash, byte identity, ownership,
receipt, gas, exit 0/1/2/3).

With `--expect-expired` it asks the opposite question. Verification passes only if
**all** of these hold:

1. the lookup returned the SDK's documented missing result — a positive `null` from
   `arkiv_getEntity` mapped to `NoEntityFoundError` — not a transport error and not
   a malformed row;
2. the chain head is **at or past** the entity's expiry block;
3. the expiry block is established, preferring the `EntityCreated` event decoded
   from the creation receipt (`--tx`), falling back to an explicit `--expires-at`;
4. when `--tx` is given, the receipt is readable, succeeded, and the decoded event
   names *this* key.

A query that failed never verifies anything. Precisely:

| Situation | Verdict | Exit |
|---|---|---|
| Missing, at/past the deadline, creation proven | `expected-expired` | **0** only here |
| Entity still readable inside its window | `not-yet-expired` | 1 |
| Missing before its own deadline (died early) | `prematurely-missing` | 1 |
| Still readable past the deadline (died late) | `unexpectedly-live` | 1 |
| No deadline established (no `--tx`, no `--expires-at`) | `expiry-unknown` | 1 |
| Tx supplied, receipt unreadable or reverted | `creation-unproven` | 1 |
| Timeout / 429 / `ECONN` — the query never answered | `transport-failure` | **5** |
| Row answered but does not fit the schema | `malformed` | **5** |
| Any other error | `unreadable` | 1 |

`--json` emits `{ "kind": "blocklab.arkiv-expiry", … }` with `verdict`, `checks`
and `lookupState`, so a poller can separate "gone" from "could not ask". `--expires-at`
is only a fallback: when `--tx` is supplied the on-chain event wins, because the
engine wrote it. `--expires-at` without `--expect-expired`, a non-numeric
`--expires-at`, and expiry mode with only `--experiment-id` (an expired entity no
longer answers an `experimentId` query) are all blocked with exit 2.

## 3. The missing-result discrimination

The entire risk in this phase is that "the query failed" gets reported as "the
entity expired". `classifyExpiryLookup` therefore matches narrowly, in this order:

1. `NoEntityFoundError` by name, or the documented message ("no live entity",
   "never created", "deleted or has expired") → `missing`;
2. `HttpRequestError` / `RequestError` / `InvalidParamsRpcError` / timeout / rate
   limit / `ECONN` → `transport`;
3. `SchemaMismatchError` → `malformed`;
4. everything else → `unreadable`.

Only category 1 can ever reach a positive verdict, and even then three further
checks (deadline known, head past it, creation proven) must also pass. Five unit
tests pin the classifier, including a plain `Error("boom")` that must stay
`unreadable`.

## 4. The probe

`scripts/arkiv-06-probe.mjs`, **dry-run unless `--live`**:

- Payload is a real `@blocklab/arkiv-metadata` record (`expiry-probe`, status
  `running`, `expiryDays: 1` as the contract's floor, blank counts, fixed
  timestamp, digest over `BLOCKLAB ARK-06 expiry probe ark06-expiry-001`), validated
  before anything else. The true lifetime is `--lifetime-blocks` (default 5) and is
  carried by the entity's own `$expiresAt`, never by `expiryDays`.
- Preflight, all read-only: access key present, chain `7794095`, head readable,
  expiry parameters sane (`minLifetime` slot used, target after the head, inside the
  7 884 000-block cap), no duplicate `ark06-expiry-001`, explorer reachable, and —
  under `--live` only — signer funded. Any failure exits 2 before a transaction.
- Under `--live` the key is predicted first: `predictEntityKey` over the signer's
  entity nonce with `NO_SALT`, so the poller has a target **before** the signature.
  The create itself passes `salt: NO_SALT` so the prediction holds; the gained
  predictability costs nothing for a one-off test entity.
- The poller is armed before the create. Each tick records the block, the latency
  and the state (`live` / `missing` / `transport` / `unreadable`); a boundary is only
  declared when a live sample is followed by a missing one. Live samples capture
  `payloadSha256` so the active observation is provable later.
- After the boundary it prints the resolution-rule verdict (`expiresAt == landing +
  lifetime`), re-runs the duplicate query (must be clear again), re-reads the three
  pre-existing entities, and prints the independent verification command from §5.

The access key, the private key and the signer's secret are never printed; only the
signer's address and the balance appear.

## 5. Failure handling

| Failure | Behaviour |
|---|---|
| Preflight fails, duplicate present, no key/funds | exit 2 before signing, nothing sent |
| `createEntity` rejects | capture the entity nonce before and after; if it moved the create may have landed, so the script says "reconcile with the predicted key" and **never re-sends**; exit 1 |
| Receipt timeout inside `createEntity` | same path — the nonce comparison is the reconciliation signal, not a retry |
| Polar opposite states (still live past `--max-blocks`) | loop stops at the cap, says so, exit 1; `--max-blocks` is the knob |
| Entity missing before the deadline | poller keeps going (it only stops on live → missing), so an early death still produces a boundary and the verifier decides the verdict |
| Indexer lag | a single missing sample is not accepted as the boundary verdict; the independent verifier re-reads and applies the head/deadline rule |
| RPC failure during polling | recorded as `transport` in the samples, does not end the loop |
| Ctrl-C | `SIGINT` sets the stop flag, no further transaction is sent, `exitCode` 130 |
| Uncertain post-run state | the printed verification command is the authority, not the poller's own summary |

## 6. The live run, once authorized

Prerequisites, all read-only and all re-checkable without signing:

1. `pnpm --filter @blocklab/studio run probe:ark06` must print `READY: n/n` with no
   duplicate for `ark06-expiry-001`.
2. Chain stays `7794095`; head advancing normally (2 s blocks).
3. Harness signer `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759` funded above
   0.01 tGLM (it holds ~5 tGLM; the run costs ~0.0002 tGLM).
4. No entity answers `ark06-expiry-001`; the three existing entities are live.

The single command:

```bash
pnpm --filter @blocklab/studio run probe:ark06:live
```

Then, independently (second process, after the boundary):

```bash
pnpm --filter @blocklab/studio run verify:entity -- \
  --entity <printed key> --tx <printed tx> --expect-expired
```

Exit 0 with verdict `expected-expired` is the claim; anything else is reported as
it comes out. `ark06-expiry-001` must not be re-published afterwards.

## 7. Dry-run evidence (2026-11-07, no transaction)

`probe:ark06` at head `287670`, 5-block default:

```
record: ark06-expiry-001, status running, payload 489 bytes SHA-256 6f2c5df9…7e623
lifetime: 5 block(s) ≈ 10 s
PASS  chain id — 7794095
PASS  head block readable — 287670
PASS  lifetime lands in minLifetime, not expiresAt — minLifetime 5, expiresAt 0
PASS  expiry resolves after the head (dead-on-arrival guard) — target 287675 vs head 287670
PASS  lifetime within the chain maximum — 5 <= 7884000 blocks
PASS  no entity for experimentId "ark06-expiry-001" — clear to publish once
PASS  explorer reachable — HTTP 200
PASS  signer check — skipped in dry-run (no private key read)
READY: 8/8 checks passed.
```

then three read-only poller ticks, then
`dry-run complete … Nothing was broadcast.`, exit 0.

The verifier was exercised end to end read-only as well, in every branch:

| Command | Result |
|---|---|
| unknown key `--expect-expired --expires-at 1` | `EXPIRED (verified) 6/6`, exit **0** |
| unknown key `--expect-expired` (no deadline) | `expiry-unknown`, exit 1 |
| live `studio-mm-002` `--expect-expired` | `not-yet-expired`, exit 1 |
| live `studio-mm-002` + its real create tx | `EntityCreated` decoded, deadline read as `588211`, `not-yet-expired`, exit 1 |
| live `studio-mm-002` + `--expires-at 999999` | `not-yet-expired`, exit 1 |
| `--expires-at 5` without `--expect-expired` | blocked, exit 2 |
| `--expires-at abc` | blocked, exit 2 |
| `--experiment-id studio-mm-002 --expect-expired` | blocked (needs `--entity`), exit 2 |
| default mode, `studio-mm-001` | unchanged: 8/10 as before, exit 1 |

The `EntityCreated` decode reading the real `588211` off a live receipt is the
strongest dry evidence here: the deadline path is proven against real chain data
without needing an expired entity to exist.

## 8. What is *not* proven yet

- No real expiry transition — by definition, since nothing was created.
- The live branch of the probe (`--live`: nonce prediction, `NO_SALT` create, funded
  signer gate) is unexercised; only its dry-run siblings are.
- The boundary rule (live while `< expiresAt`, dead at `== expiresAt`) stays
  asserted from the SDK, not measured.
- `prematurely-missing` and `unexpectedly-live` are unit-tested only.

## 9. Deviations from the plan in `docs/arkiv-ark06.md`

- The plan said `verify:entity --expect-expired` plus a probe; both exist, but the
  probe hardcodes `EXPERIMENT_ID` and its own preflight instead of reusing
  `preflight:test`, which requires a frozen `studio-mm-*` record profile (§5.4 of the
  plan).
- The plan's poller was described as an external loop; it is in-process here, and it
  is started before the create so the first blocks are not missed.
- Key prediction with `NO_SALT` was not in the plan. It is what allows the poller to
  be armed before the signature instead of after, and it is recorded here because the
  entity key is therefore not random.

## 10. Live run, actual (2026-11-07)

Authorized explicitly, one create, nothing retried.

| Item | Value |
|---|---|
| Entity key | `0x95a2e5c31f5638d8acc8ce9f58eea2a9f8ae92af59695692422799a8411b4045` |
| Predicted key | the same — `NO_SALT` prediction over entity nonce `1` was exact |
| Tx / landing block | `0xd48c06a420f058b106f882b4114f687b1af41cbaf63f2f1e005fb266eb82b02c` / `289297`, status `success` |
| `expiresAt` | block `289302` = `289297 + 5` — the resolution rule held exactly |
| Active samples | blocks `289299`, `289301` (live, payload SHA-256 `6f2c5df9…7e623`) |
| First missing sample | block `289301`, i.e. **head `expiresAt − 1` already dead** |
| Independent verifier | `expected-expired`, **7/7**, exit 0, head `289319` |
| `select` by id after expiry | no rows — the index drops it with `getEntity` |
| Gas | `177056 × 1 gwei = 0.000177056 tGLM` (signer `4.999790895` → `4.999613839`) |
| Untouched | all three re-read live with identical payload hashes and owners |

Deviations and observations worth carrying forward:

1. **The `poll-until-live-then-missing` loop stopped on a same-block transition.** The
   loop is checked once per tick, so a live sample and a missing sample can share block
   `289301`; the boundary printed `last live block < 289301`. Between the last live
   sample and the missing one the head crossed into `289301`, so the miss is stamped
   with the block *after* the cross. The authoritative boundary came from the
   independent verifier (head `289319 ≥ 289302`), not from this print. Anything reading
   the sample log must prefer the verifier.
2. **The boundary sits at `expiresAt − 1`, not `expiresAt`.** The assumption in
   [docs/arkiv-ark06.md](arkiv-ark06.md) §2.8 that an entity is live until
   `block == expiresAt` is **refuted**: at head `289301` with `expiresAt == 289302` it
   was already gone. ARK-08's copy must say "expired at block N" as a *past* boundary.
3. The dry-run's `signer funded` gate only ran under `--live`, so the "8/8" dry-run
   figure and the live "8/8" are different check sets — both all-pass, but not the same
   list.
