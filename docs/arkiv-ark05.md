# ARK-05 — owner, creator and ownership transfer

**Status: PARTIAL — entity created, transfer pending.** The mechanism is fully
verified from the installed SDK, fully implemented and unit-tested in Studio, and
stage 1 (creation with A) is executed and independently verified, stage 2 (the
transfer) is not. **No transfer has been broadcast yet**, so the two-wallet
ownership behaviour itself is still unobserved. ARK-05 stays PARTIAL until
stage 2 is recorded here.

Stage 1 wrote exactly one new entity (`studio-mm-002`). `poc-write-001` and
`studio-mm-001` were neither modified, transferred, re-published nor reused as
experiment IDs, and no second transaction was sent after the creation.

## What the question actually is

ARK-04 established that an entity has both `owner` and `creator` and that both
equal the signer of the creating transaction. That says nothing about what happens
to either field later. Three separate questions were open:

1. Is `owner` mutable at all, and by whom?
2. Does `creator` ever change?
3. What does a transfer do to the entity's payload, expiry and permissions?

Guessing from the field names is not evidence. So the answers come from the
installed SDK (`@arkiv-network/sdk@1.0.1`), file by file.

## SDK evidence

Everything below is quoted from `apps/studio/node_modules/@arkiv-network/sdk`.

| Question | Finding | Source |
|---|---|---|
| Is there a transfer at all? | Yes, a dedicated wallet action `changeOwnership(client, { entityKey, newOwner }, txParams?)` returning `{ entityKey, txHash }` | `src/actions/wallet/changeOwnership.ts` |
| What does it send? | An `arkiv` transaction whose only payload is an `ownershipChanges` array | same file → `sendArkivTransaction` |
| Wire format | `OperationType.TransferOwnership = 4`; the op is exactly `(bytes32 entityKey, address newOwner)` — no attributes, no expiry, no payload | `src/entity/operations.ts`, `src/entity/params.ts` |
| Is `owner` mutable and `creator` not? | `owner` and `creator` are distinct optional entity fields and only `owner` appears in the transfer op; `creator` has no operation that writes it | `src/types/entity.ts`, `src/entity/params.ts` |
| Who may transfer? | The current owner only — the contract reverts `NotOwner(entityKey, caller, owner)` otherwise | `src/utils/arkivTransactions.ts` |
| Does the recipient accept? | No accept/claim step exists in the SDK; the entity belongs to the new owner as soon as the transaction lands | absence of any accept action in `src/actions/wallet/` |
| Transfer to self / zero? | Reverts `TransferToSelf(entityKey)` / `TransferToZeroAddress(entityKey)` | `src/utils/arkivTransactions.ts` |
| Target must exist and be live? | Reverts `EntityNotFound` / `EntityExpired` | same file |
| Read-only entities transferable? | Yes — `ReadOnlyEntity` is thrown by attribute/extend/delete ops, not by transfer, so read-only freezes attributes and expiry, not ownership | same file |
| How is it observable? | `event OwnershipTransferred(bytes32 indexed entityKey, address indexed previousOwner, address indexed newOwner)` | `src/entity/events.ts` |
| How is it queried? | `$owner` is a queryable system attribute (and reserved), so ownership is filterable and readable per entity | `src/query/expression.ts` |
| What does the SDK itself say? | "Hands the entity with the given key to a new owner." | `src/clients/decorators/arkivWallet.ts` |

### Conclusion encoded in the code

- **`creator` is immutable; `owner` is mutable.** A transfer changes `owner` only.
- **The current owner must sign.** Being the creator is not enough once you are no
  longer the owner — that is exactly the distinction ARK-05 exists to pin down.
- **No recipient consent step.** A transfer is one signed transaction.
- **Payload and expiry survive a transfer** — nothing in the op carries them, so
  both must be byte-identical afterwards. That is what the read-back asserts.
- **The prime suspect for "who changed what" is the signer of each transaction**,
  not the `owner` field alone: a transfer is proved by `owner` moving *to the
  intended recipient* while `creator` stays put.

## The experiment design

Two wallets, one fresh entity, no reuse:

| Role | Wallet | Rabdi address | Signs | Pays gas |
|---|---|---|---|---|
| A — creator and current owner | MetaMask account on laptop A | `0xD431714db82331B07697Ea4675334C3AF6d2EBE9` | create + transfer | yes, both |
| B — intended new owner | MetaMask account (laptop B) | `0xAd797f58aFD3265C00504382171eC0818262D3ca` | **nothing** | **no** |

B is a **receiver only**. The SDK proves why: the transfer op is
`(bytes32 entityKey, address newOwner)` and only the *current* owner signs
(`NotOwner` otherwise), and no accept/claim action exists. So B needs no
signature, no gas and no session at transfer time — and B must not be asked to
approve anything. B is needed to (a) supply the destination address and (b)
verify the result independently from a second machine.

Stage plan, each stage read back before the next is allowed:

1. **Create with A** — fresh `experimentId` `studio-mm-002`, marked as a test,
   through the existing publication workflow. The duplicate preflight still applies.
2. **Read back** — independent retrieval of the new entity: owner, creator, expiry,
   payload hash and the tx signer. Expect `owner == creator == A`.
3. **Record the "before" state** — payload SHA-256, expiry block, both addresses.
4. **Preview with A** — Studio reads the entity live and shows creator (unchanged),
   owner now, owner after (B), signer, role, expiry (unchanged) and retained payload
   size. Nothing is signed here.
5. **Confirm with A** — exactly one `changeOwnership`, one wallet approval. No retry.
6. **Read back, twice, independently** — once in Studio right after the receipt, once
   from a separate process on laptop B. Expect `owner == B`, `creator == A` still,
   expiry and payload hash unchanged, entity still retrievable, transfer tx signed
   by A.
7. **Negative check with A** — A is no longer the owner, so a second preview must be
   blocked before any prompt.
8. **Optional ownership check with B** — from B, a further preview is *allowed*
   (B is now the owner) which confirms the role logic from the other side. Still
   draft-only until someone approves it.

## What the code does now

New module `apps/studio/src/arkiv/ownership.ts`, pure and DOM-free:

- `ownershipRole(snapshot, signer)` — distinguishes owner, creator, both, neither,
  and never implies a creator who lost ownership can transfer.
- `transferBlockReason({ wallet, snapshot, newOwner, currentBlock })` — one place
  for every precondition: no wallet, disconnected, wrong network, no entity,
  expired entity, signer is not the owner, invalid recipient, zero address,
  recipient is already the owner.
- `transferPreviewRows(...)` / `transferCaveats()` — the preview table and the
  honest caveats (recipient does not accept; creator cannot be changed; read-only
  entities keep their attributes frozen).
- `compareOwnership(before, after, intendedReceipient)` — six read-back checks: same
  entity, owner is the intended recipient, owner actually changed, creator
  unchanged, expiry unchanged, payload unchanged.

State, view and gateway follow the existing split: `types.ts` holds
`readonly transfer: TransferState`, `state.ts` reduces the transfer events with
out-of-order guards (`transfer-submitting` only from `preview`,
`transfer-confirmed` only from `submitting`/`confirming`), `view.ts` derives the
panel and `dom.ts` renders it. `gateway.ts` gains exactly two methods and remains
the only SDK importer:

- `readOwnership(entityKey)` — `getEntity` selecting `$owner`, `$creator`,
  `$expiresAt`, `payload`.
- `transferOwnership(entityKey, newOwner)` — `walletClient.changeOwnership(...)`,
  returning the tx hash.

Controller behaviour that matters:

- Preview always does a live read, so no preview is ever stale-by-construction.
- Submit re-reads the entity first; if the owner, creator, expiry or payload moved,
  it refreshes the preview and refuses to send until the user previews again.
- On success it reads back in-process and compares against the preview.
- On error it reads back **once** and says which of the two outcomes happened
  ("it landed" vs "still owned by …"), then never re-signs.

No wallet switching, no private-key input, no popup on load, no automatic retry.

## Readiness at preparation time (checked read-only, nothing signed)

The row for the id below describes the state *before* stage 1; the Result section
records the state after it.

| Gate | State |
|---|---|
| Destination address valid, EIP-55 canonical, not zero, not A | PASS — `normalizeAddress` returns it unchanged, `transferBlockReason` returns `null` for owner A |
| Destination is an EOA on Rabdi with gas | PASS — `0xAd79…D3ca`, `9.999441629 tGLM`, code `0x` |
| Owner A can pay for the transfer | PASS — `0xD431…2EBE9`, `4.999781017 tGLM`, code `0x` |
| `studio-mm-002` unused | PASS at preparation — duplicate preflight found no entity (head `285542`); now published, see Result |
| Existing entities intact | PASS — `poc-write-001` → `0x1d7b6bf8…b31a`, `studio-mm-001` → `0x9038f929…bcb7` |
| Chain / head / explorer reachable | PASS — chain id `7794095`, head readable, explorer HTTP 200 |
| Preview renders correctly for B | PASS — dry-run shows creator unchanged, owner → B, signer A, expiry unchanged, 4 caveats |

Two gaps that were open before this preparation, both closed without a broadcast:
the record id was hardcoded to `studio-mm-001` (so a create for `studio-mm-002`
would have been refused by the duplicate preflight), and the runbook claimed B
must be funded and needed its own MetaMask session. Both are fixed: the record
module now carries one frozen profile per id (`record:ark05` prints `studio-mm-002`,
`record:test` still reproduces `studio-mm-001` byte for byte), and the design now
states that B signs nothing and pays no gas.

## Live-verification procedure (needs explicit approval)

Record for this run — deterministic, already generated, **nothing broadcast**:

| Field | Value |
|---|---|
| `experimentId` | `studio-mm-002` |
| record | `pnpm --filter @blocklab/studio run record:ark05` |
| compact JSON SHA-256 | `1985617a653b1f63cc0fa309ee18d4721afb6c37264574e31b5a358049542d8d` |
| on-chain payload | 496 bytes, SHA-256 `dfe87f08922439924f3df6f8f34d1e4ec1a369da54c9cc707a3f5a7653391f9d` |
| digest preimage | `BLOCKLAB ARK-05 two-wallet ownership transfer test record studio-mm-002` |
| `evidenceDigest` | `10e1a6d2cfcee85bdeb7e9c27acc99178cc023582b174aeba1520a7deeefaa72` |
| destination | `0xAd797f58aFD3265C00504382171eC0818262D3ca` |

Readiness facts gathered read-only at head `285542`: A holds `4.999781017 tGLM`
and is an EOA, B holds `9.999441629 tGLM` and is an EOA (so no faucet run is
needed), `studio-mm-002` has no entity yet, and `poc-write-001` /
`studio-mm-001` still resolve to `0x1d7b6bf8…b31a` / `0x9038f929…bcb7`.

All commands run from the repository root. Prefixing `STUDIO_EXPERIMENT_ID=studio-mm-002`
only works in a POSIX shell (Git Bash, macOS, Linux); on Windows `cmd` use
`pnpm --filter @blocklab/studio run record:ark05` and the equivalent env var via
`set`.

**Laptop A (holds A's MetaMask and the Studio tab):**

```bash
# 0. read-only gates — duplicate, chain, head, explorer (never signs)
STUDIO_EXPERIMENT_ID=studio-mm-002 pnpm --filter @blocklab/studio run preflight:test

# 1. print the record to paste into Studio's textarea
pnpm --filter @blocklab/studio run record:ark05

# 2. paste it, press Publish, approve in MetaMask  — approval #1
#    (or drive it headless; the driver reads STUDIO_EXPERIMENT_ID too)
STUDIO_EXPERIMENT_ID=studio-mm-002 pnpm --filter @blocklab/studio run verify:live -- --arm-publish

# 3. read back the new key from a separate process, then record owner/creator/
#    expiry/payload hash and the tx signer
pnpm --filter @blocklab/studio run verify:entity -- --experiment-id studio-mm-002

# 4. open the entity by key in Studio, paste B's address, "Preview transfer"
#    (expect: creator unchanged, owner -> B, signer A, expiry unchanged, 4 caveats)

# 5. press "Confirm transfer", approve in MetaMask  — approval #2, exactly once

# 6. read back twice and record the comparison
pnpm --filter @blocklab/studio run verify:entity -- --experiment-id studio-mm-002

# 7. negative check: Preview transfer again as A -> blocked, no prompt
```

**Laptop B (no wallet needed for verification):**

```bash
# needs only an Arkiv access key (or the committed .env.local) and the entity key
pnpm --filter @blocklab/studio run verify:entity -- --entity <new-entity-key>
```

Laptop B's output must show owner B, creator A, the same payload hash and the same
expiry, and be pasted into the Result table unchanged. Its value is that it shares
nothing with the machine that signed.

Record in the Result section below: entity key, create tx, transfer tx, signers,
payload hash before/after, expiry before/after, decoded `OwnershipTransferred`
event, both verification outputs and the exact exit code of every command.

## Result

### Stage 1 — creation with A: DONE (2026-11-07)

Executed under explicit authorization for the creation only. Exactly one
`createEntity`, one MetaMask approval by A, no second transaction, no retry.
Verified by the driver (10/10) and then independently from a second process
(10/10, exit 0).

| Field | Value |
|---|---|
| Entity key | `0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb` |
| Create tx / signer | `0x852d9eb1fa2c959c1805f0b822a88a5b327a3504b3731699f18e762fddf9cdc0` / `0xD431714db82331B07697Ea4675334C3AF6d2EBE9` (MetaMask, A) |
| Block / receipt | `285811`, status `success` |
| Gas | `187358` × `1 gwei` = `0.000187358 tGLM` (A: `4.999781017` → `4.999593659`) |
| Owner before → after | `0xD431…2EBE9` → pending transfer |
| Creator before → after | `0xD431…2EBE9` → pending transfer |
| Payload | 496 bytes, SHA-256 `dfe87f08922439924f3df6f8f34d1e4ec1a369da54c9cc707a3f5a7653391f9d`, byte-identical to the canonical record |
| Expiry (block) before → after | `588211` (= `285811 + 302400`) → pending transfer |
| `OwnershipTransferred` decoded | none yet — no transfer broadcast |
| Negative check (A cannot transfer) | pending transfer |
| Indexed retrieval by `experimentId` | PASS — the duplicate preflight now reports it as published (exit 2) |
| `poc-write-001` / `studio-mm-001` | untouched, still `0x1d7b…b31a` / `0x9038…bcb7`, owner and creator unchanged |

Independent evidence, second process:

```
PASS  payload present — 496 bytes, SHA-256 dfe87f08…3391f9d
PASS  revalidates against the shared contract — experimentId "studio-mm-002"
PASS  byte-identical to the canonical record — 496 bytes match
PASS  owner == creator — 0xD431…2EBE9 vs 0xD431…2EBE9
PASS  owner == signer — 0xD431…2EBE9 vs 0xD431…2EBE9
PASS  entity key matches the published key
PASS  expiry after creation — 302400 blocks (285811 → 588211)
PASS  mined receipt succeeded — status success at block 285811
VERIFIED: 10/10 checks passed.   (exit 0)
```

Explorer: `https://rabdi.explorer.arkiv.network/entity/0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb`

Reproduce the read-back (no wallet needed, nothing signed):

```bash
pnpm --filter @blocklab/studio run verify:entity --   --entity 0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb   --signer 0xD431714db82331B07697Ea4675334C3AF6d2EBE9   --tx 0x852d9eb1fa2c959c1805f0b822a88a5b327a3504b3731699f18e762fddf9cdc0
```

`--record` adds the byte-identity check; without it that line reports FAIL by
design ("no canonical record supplied"), which is why it is not shown as evidence.

### Stage 2 — transfer to B: NOT STARTED

Awaiting separate authorization. Destination stays
`0xAd797f58aFD3265C00504382171eC0818262D3ca` (`9.999441629 tGLM`, EOA).

## Automation vs chain evidence

Unit tests cover the state machine, every block reason, the read-back comparison,
the DOM gating and the "never retry" behaviour. They prove the logic, not the
chain. Nothing here claims a transfer happened until the table above is filled
from real transactions.
