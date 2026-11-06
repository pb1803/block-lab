# ARK-07 — real browser-wallet publication runbook

**Status: DONE (2026-11-06).** A real MetaMask approval produced a real Rabdi
entity, which was read back and byte-compared from a separate process: 11/11
checks. See [Result](#result--verified-publication-2026-11-06). Nothing here
asserts an entity other than the one recorded below.

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

### Process lifecycle and exit codes

The driver used to end the process with `process.exit()`. That is unreliable here:
forcing an exit while the CDP socket and the viem/undici keep-alive sockets still
hold handles makes Node abort on Windows with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` and
replaces the exit code with `3221226505`. Reproduced 3/3 with six lines (one SDK
`http()` call, then `process.exit()`), and it reproduced through
`--check-only` even on the already-published id.

The success path had the opposite bug: it set `process.exitCode` and returned
without closing the CDP socket, so after printing `VERIFIED` the process never
exited (still running after 120 s).

Both are fixed by one exit path: blockers throw a `Stop` carrying the exit code,
the socket is closed in a `finally`, and `process.exitCode` is set so Node drains
its own sockets. Verified: `--check-only` on the duplicate id now exits `2` with
zero assertions in ~5 s, and the `VERIFIED` tail exits `0` in well under a second.
No exit code and no safety behaviour changed — only how the process terminates.

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

## Result — verified publication (2026-11-06)

A real publication happened through Studio with a real MetaMask approval, exactly
one entity, no pasted private key, no retry. Authoritative evidence:

| Field | Value |
|---|---|---|
| Experiment id | `studio-mm-001` |
| Transaction | `0xef91a94aa8eb3df5881d42d801fe3217a764378d9253867b1b981e9dddc5f2d9` |
| Entity key | `0x9038f929ac92b25eb383fa6648290d631c18e5c9976a51fffc9f964adeecbcb7` |
| Network / chain | Rabdi, `7794095` |
| Block | `283822` |
| Signer (MetaMask) | `0xD431714db82331B07697Ea4675334C3AF6d2EBE9` |
| Payload | 493 bytes, SHA-256 `59c090b8ea2a1818d9e2eba1395e8eda67a3e9795dce7aff5e961d0654d726a6` |
| Gas | `197983` used → `0.000197983 tGLM` |
| Expiry | 7 days (`302400` blocks) |
| Receipt | success |
| Read-back | independent, successful |
| Canonical payload | byte-identical |
| Shared schema | revalidation true |
| Indexed retrieval | found by `experimentId` |
| Checks | **11/11 passed** |
| Ownership | `owner == creator == signer` |

Explorer:
<https://rabdi.explorer.arkiv.network/entity/0x9038f929ac92b25eb383fa6648290d631c18e5c9976a51fffc9f964adeecbcb7>

Re-verified independently on 2026-11-06 with `verify:entity`: 10/10 checks, exit 0,
and every figure above reproduced exactly (493 bytes, same SHA-256, gas `197983`,
block `283822`, expiry `283822 → 586222`, `owner == creator == signer`). The
remaining check in the run's own count of 11 is indexed retrieval by
`experimentId`, which the duplicate preflight exercises independently: re-running
now reports `already published: 0x9038f929…bcb7` from an indexed query and refuses
to create a second entity.

### How this differs from the POC publication

| | `poc-write-001` (ARK-03) | `studio-mm-001` (ARK-07) |
|---|---|---|
| Who signed | the POC harness, using a private key from `apps/arkiv-poc/.env.local` | Studio's UI, a human approving in MetaMask |
| Entity | `0x1d7b6bf8…b31a` | `0x9038f929…bcb7` |
| Tx | `0xed989cbe…573f05` (block `269199`) | `0xef91a94a…5f2d9` (block `283822`) |
| Payload | 603 bytes, SHA-256 `410e3d5c…38f4d` | 493 bytes, SHA-256 `59c090b8…726a6` |
| Signer | `0x8C58af…8759` (harness key) | `0xD431…2EBE9` (MetaMask account) |
| Gas cost | `0.000209105 tGLM` | `0.000197983 tGLM` |
| Meaning | proves the Arkiv SDK write path from Node | proves the Studio browser-wallet write path, user-signed |

Neither exposure includes secrets: the signer is a public Rabdi address, the
access key never leaves `apps/arkiv-poc/.env.local` / `apps/studio/.env.local`,
and no private key is stored or logged anywhere.

## What is deliberately not claimed

- Nothing about anonymity or privacy: Arkiv is a public data store, the signer
  address is public, and the record is public. `passthrough` RPC is never called
  anonymizing.
- Nothing about ARK-05 (two-wallet ownership transfer) or ARK-06 (observed
  expiry); both stay PARTIAL.
- No second publication: `studio-mm-001` exists exactly once; the duplicate
  preflight and the verifier both enforce that.
