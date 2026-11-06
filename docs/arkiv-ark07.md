# ARK-07 — real browser-wallet publication runbook

**Status: PARTIAL — tooling and every non-signing gate verified live; the wallet
signature has not been performed yet.** This document describes exactly what a
verified run looks like, so the claim can only be made once the evidence block at
the end is produced by a real MetaMask approval. Nothing here asserts a second
published entity.

## Why this exists

Phase 15 proved Studio's write path is *wired*: the labelled mock wallet in
`scripts/studio-arkiv-check.mjs` satisfies every check and then refuses the
transaction. That proves gating, not publication. A genuine ARK-07 result needs a
real EIP-1193 wallet (MetaMask) to sign a real Rabdi transaction that is then
read back and byte-compared from a second process.

Automation cannot substitute for that click: the signature lives inside the
wallet extension, which requires an unlocked vault. This runbook therefore splits
the work into three honest layers:

| Layer | What it proves | Who does it |
|---|---|---|
| Unit tests (`apps/studio/src/arkiv/*.test.ts`) | Studio's state machine, gating, read-back logic | `pnpm test` |
| Headless mock-wallet run (`scripts/studio-arkiv-check.mjs`) | UI wiring and refusal behaviour | automation |
| This runbook | A real wallet-signed entity, retrieved and byte-compared | a human approving in MetaMask |

## What the run publishes

A dedicated test record, never `poc-write-001`:

```json
{
  "schemaVersion": "1.0",
  "experimentId": "studio-mm-001",
  "experimentType": "publish-probe",
  "scenarioName": "Studio wallet-signed publication test",
  "targetChainId": 7794095,
  "status": "idle",
  "startedAtMs": 1762387200000,
  "requestCount": 0,
  "succeededCount": 0,
  "failedCount": 0,
  "rpcFailureCount": 0,
  "evidenceDigest": "e4fb318cb29508da67b63514e971be918a3b35a1899b27f620f2059581bd8362",
  "evidenceRef": "evidence/studio-mm-001/publish-test.md",
  "expiryDays": 7
}
```

It is deliberately a *publication probe*:

- `status: "idle"` with zero request counts, because nothing was measured. No
  latency, no evidence bundle, no scenario result is claimed.
- A fixed synthetic timestamp (`2026-11-06T00:00:00Z`), so the canonical bytes are
  reproducible by anyone running `record:test`.
- The payload actually written on chain is the 493-byte pretty-printed JSON above;
  `metadataToPayloadBytes` produces it and its SHA-256 is
  `59c090b8ea2a1818d9e2eba1395e8eda67a3e9795dce7aff5e961d0654d726a6`. Note that
  hashing the *compact* `JSON.stringify(record)` instead yields a different digest
  (`8c98ed2e…53e0`); the verifier and the driver both use the payload bytes, so
  quote `59c090b8…` as the payload hash and never the compact one.
- `evidenceDigest` is the SHA-256 of the documented preimage
  `BLOCKLAB ARK-07 Studio browser-wallet publication test record studio-mm-001`
  (a note, not a measurement). `evidenceRef` points at a local-only note.
- Lifetime 7 days, matching `expiryDays`.

Regenerate it (deterministic):

```bash
pnpm --filter @blocklab/studio run record:test           # pretty JSON for the UI
pnpm --filter @blocklab/studio exec node scripts/studio-mm-001-record.mjs --json
```

## Preconditions

1. **Access key.** Studio and the scripts read `VITE_ARKIV_ACCESS_KEY` /
   `ARKIV_ACCESS_KEY` from git-ignored env files. `apps/studio/.env.local` holds
   only the access key (never the private key); the scripts load
   `apps/arkiv-poc/.env.local`. Neither the access key nor the signer key is ever
   printed by these scripts.
2. **Gas.** The connected wallet must hold tGLM on Rabdi
   (`https://hub.arkiv.network/faucet`). The driver reads the balance and stops
   when it is zero.
3. **A real wallet in a debuggable Chrome.** Headless Chrome cannot load
   extensions, so this step needs the interactive browser:

   ```bash
   # close Chrome completely first (it holds the profile lock)
   "C:\Program Files\Google\Chrome\Application\chrome.exe" \
     --remote-debugging-port=9229 \
     --user-data-dir="C:\Users\<you>\AppData\Local\Google\Chrome\User Data" \
     --profile-directory=Default
   ```

   MetaMask (`nkbihfbeogaeaoehlefnkodbefgpgknn`) must be installed in that
   profile, unlocked, and switched to Rabdi (or ready to approve the switch).
4. **Studio** running against that browser: `pnpm --filter @blocklab/studio dev`
   (port 5178), then open it in the same Chrome window.

## Run

```bash
# 1. read-only gate: no signing, no writes
pnpm --filter @blocklab/studio run preflight:test

# 2. real-wallet driver (without --arm-publish it waits for your Publish click)
pnpm --filter @blocklab/studio run verify:live -- --port 9229 --url http://localhost:5178/
```

The driver never handles a private key or seed phrase and never clicks MetaMask's
approval button. It refuses to run unless `window.ethereum.isMetaMask === true`,
so the labelled mock wallet cannot be mistaken for a publication.

Order of gated steps, each of which stops the run:

1. MetaMask detected (`isMetaMask`), otherwise exit 2.
2. Connected account present (the first connection needs your MetaMask approval).
3. Chain is Rabdi `0x76edaf`; the switch happens only on the explicit Studio
   button, with no access key in the added chain config.
4. Balance is non-zero.
5. Duplicate preflight finds no entity for `studio-mm-001`. If one exists, the run
   is refused — never a second entity with the same id.
6. The pasted record re-validates and matches the canonical bytes exactly.
7. The approval card is printed; then either you click Publish, or `--arm-publish`
   clicks it once. **The signature is your MetaMask confirmation.**
8. The driver waits for the mined receipt, then re-reads the entity in its own
   process (not through Studio's state) and prints the evidence block.

To rehearse everything except the signature, add `--check-only`: the run performs
every gate above, prints the approval card, and stops with "nothing was signed".

## Verifying a publication afterwards

`verify:entity` is the same verification, standalone and independent of Studio:

```bash
# by entity key, with the canonical record, the expected signer and the tx hash
pnpm --filter @blocklab/studio run verify:entity --   --entity 0x… --record /path/to/record.json --signer 0x… --tx 0x…

# by experiment id (exit 3 = nothing is published under that id)
pnpm --filter @blocklab/studio run verify:entity -- --experiment-id studio-mm-001
```

It reports payload bytes and SHA-256, byte-identity with the canonical record,
revalidation against the shared contract, `owner == creator == signer`, the
expiry window, the mined receipt and the actual gas cost, then exits 0 only when
every check passes. Exit codes: `0` verified, `1` not verified, `2` blocked
(no access key / wrong chain / bad arguments), `3` nothing published.

The verifier is not theoretical: it was run against the existing, already
verified `poc-write-001` entity as a control —

- entity `0x1d7b6bf8…b31a`, payload 603 bytes, SHA-256 `410e3d5c…38f4d`,
  byte-identical to the reconstructed canonical record, `owner == creator ==
  signer 0x8C58af…8759`, expiry `+302400` blocks, receipt success at block
  `269199`, gas `209105 × 1 gwei = 0.000209105 tGLM` → **10/10 checks passed**;
- `--experiment-id studio-mm-001` → exit 3, "nothing to verify".

That control run re-verifies ARK-03's existing publication only; it is **not** a
second publication and does not change ARK-07's status.

## Failure handling

- **Rejected in MetaMask**: reported as a user rejection; nothing was written and
  nothing is retried.
- **Refused before signing (`4100`, `4900`, `4901`)**: the wallet refused the
  request itself, so nothing was sent and the record is untouched. `4001` means
  you declined; `4100` means the account is no longer authorized for this site
  (observed once: the request was built correctly — same `from`, same Arkiv
  contract, successful estimate — and MetaMask still answered
  `The requested method and/or account has not been authorized by the user.`).
  Fix: **Disconnect**, **Connect** (accepting the authorization popup), then
  publish; an authorization refusal wrote nothing, so publishing again is not a
  duplicate. `4900` is a wallet disconnected from its network; `4901` is a wrong
  chain. Studio reports these as `[unauthorized]` / `[wrong-network]` with that
  instruction rather than as a network failure.
- **Error after submission**: Studio and the driver both re-query the entity once.
  If it exists, the run reports the key and **does not sign again**; if it does not,
  the run says nothing was written and stops. A blind retry is never performed.
- **Duplicate preflight unknown** (throttled endpoint, no access key): the run is
  blocked. Unknown duplicate state is never treated as "no duplicate".

Exit codes: `0` verified, `1` failure, `2` blocked before signing, `4` no
debuggable Chrome page.

## What a verified run must record

Only facts from the mined receipt and the independent read-back may be written
down:

- tx hash, receipt status, block number, actual gas used / cost in tGLM;
- entity key, `owner`, `creator`, `createdAt`/`updatedAt`/`expiresAt` blocks;
- payload byte length, SHA-256, byte-identical comparison, revalidation against
  the shared schema, and findability by `experimentId`;
- the connected address, which must equal `owner` and `creator`.

Then, and only then, ARK-07 can be marked DONE and backlog/plan updated with that
evidence. A mock run, a wallet rejection, or a submission without a receipt is
**not** a publication and must not be recorded as one.

## What is deliberately not claimed

- Nothing about anonymity or privacy: Arkiv is a public data store, the signer
  address is public, and the record is public. `passthrough` RPC is never called
  anonymizing.
- Nothing about ARK-05 (two-wallet ownership transfer) or ARK-06 (observed
  expiry); both stay PARTIAL.
- No publication claim for `studio-mm-001` until the evidence block exists.
