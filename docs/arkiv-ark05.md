# ARK-05 — owner, creator and ownership transfer

**Status: PARTIAL.** The mechanism is fully verified from the installed SDK and
fully implemented and unit-tested in Studio, but **no transfer has been broadcast
yet**: on-chain two-wallet behaviour is still unobserved. ARK-05 stays PARTIAL
until a real two-wallet run is recorded here.

Nothing in this phase wrote to Rabdi. `poc-write-001` and `studio-mm-001` were
neither modified, transferred, re-published nor reused as experiment IDs.

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

| Role | Wallet | Signer of |
|---|---|---|
| A | MetaMask vault account 1 (`0xD431…2EBE9`) | create, and the transfer |
| B | MetaMask vault account 2 (funded separately) | nothing — B never signs |

Wait for B: the transfer must be **initiated by A**, because only the owner can.

Stages, each with its own read-back before the next is allowed:

1. **Create with A** — fresh `experimentId` `studio-mm-002`, marked as a test, using
   the existing publication workflow. Idempotency preflight still applies.
2. **Read back** — independent retrieval of the new entity: owner, creator,
   expiry, payload hash, and the tx signer must all be recorded. Expect
   `owner == creator == A`.
3. **Record the "before" state** — the SHA-256 of the payload, the expiry block and
   both addresses, before anything is staged.
4. **Preview with A** — Studio reads the entity live, shows creator (unchanged),
   owner now, owner after, signer, role, expiry (unchanged) and payload size.
   Nothing is signed at this point.
5. **Confirm with A** — exactly one `changeOwnership`, one wallet approval. No
   automatic retry.
6. **Read back, twice, independently** — once in Studio immediately after the
   receipt, once from a separate process (`verify:entity`-style retrieval). Expect
   `owner == B`, `creator == A` still, expiry and payload hash unchanged, entity
   still retrievable, and the transfer tx signed by A.
7. **Negative check with A** — from A (no longer owner) stage a second transfer.
   The UI must block with "you created this, you are no longer the owner"; A's
   wallet must not be asked to sign.

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

## Live-verification procedure (needs explicit approval)

Prerequisites, once approved:

1. Second MetaMask vault account, funded with tGLM from the same faucet used for
   `0xD431…2EBE9`; note its public address only.
2. Studio running and connected as A on Rabdi, both accounts present in the same
   vault.

Steps:

```bash
# 1. create (fresh id studio-mm-002) — approval #1
pnpm --filter @blocklab/studio verify:live -- --arm-publish

# 2. read back the new entity from a separate process
pnpm --filter @blocklab/studio verify:entity -- --key <new-entity-key>

# 3. confirm owner == creator == A, then stage the transfer in Studio:
#    open the entity by key, paste B's address, Preview transfer
#    (expect: creator unchanged, owner -> B, signer A, expiry unchanged)

# 4. approval #2 — Confirm transfer; one MetaMask prompt, no retry

# 5. independent read-back, twice
pnpm --filter @blocklab/studio verify:entity -- --key <new-entity-key>
# expect owner = B, creator = A, same payload hash, same expiry, tx signed by A

# 6. negative check: back in Studio as A, Preview transfer again
#    expect a block, no prompt
```

Record in the Result section below: entity key, create tx, transfer tx, signers,
payload hash before/after, expiry before/after, decoded `OwnershipTransferred`
event, and the exact exit code of each command.

## Result

Not yet run. To be filled in after an approved live run:

| Field | Value |
|---|---|
| Entity key | _pending_ |
| Create tx / signer | _pending_ |
| Transfer tx / signer | _pending_ |
| Owner before → after | _pending_ |
| Creator before → after | _pending_ |
| Payload SHA-256 before → after | _pending_ |
| Expiry (block) before → after | _pending_ |
| `OwnershipTransferred` decoded | _pending_ |
| Negative check (A cannot transfer) | _pending_ |

## Automation vs chain evidence

Unit tests cover the state machine, every block reason, the read-back comparison,
the DOM gating and the "never retry" behaviour. They prove the logic, not the
chain. Nothing here claims a transfer happened until the table above is filled
from real transactions.
