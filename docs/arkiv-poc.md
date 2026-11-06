# Arkiv Rabdi proof of concept

## Status

Phase 14 built an isolated browser POC for the Arkiv sponsor integration and
verified the network, the SDK and the read path **live on the Rabdi testnet**.
The real entity write had **not** happened at that point (the harness signer
held `0 tGLM`), so the browser write path was verified only up to the wallet's
signature request, with a deliberately mock wallet that rejects it.

**Phase 14B** (2026-11-05) prepared the environment for the first real
publication. The signer was rotated after an exposure report, funded with
`5 tGLM` (on-chain transfer verified), and an Arkiv access key is configured
locally. All eight pre-publication checks pass live and read-only
(`scripts/prepub-check.mjs`: funding transaction, balance, key/address match,
secret hygiene, access keys, authenticated RPC, duplicate preflight, funds).
**No real transaction has been signed yet, and no entity key exists:** the
publication runs only after explicit approval. Nothing below claims a write
that did not happen.

Nothing in this document claims a write, a transaction hash, an entity key, an
ownership experiment or an expiry experiment that did not happen.

## Unblocking the first real publication (Phase 14B)

### Prepared signer

A dedicated Rabdi testnet account was generated locally
(`apps/arkiv-poc/.env.local`, which is git-ignored; the key value is never
printed, committed, logged or shown). **Rotated on 2026-11-05** after the
previous signer was reported exposed; the old address
(`0x9Ff86Ef02CC6857e7F6942f58Ec78B8380ADe74A`) is retired and must not be
funded or used:

| Item | Value |
|---|---|
| Signer address | `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759` |
| Balance (verified live, 2026-11-05) | `5 tGLM` |
| Where the key lives | `apps/arkiv-poc/.env.local` (`ARKIV_PRIVATE_KEY`, git-ignored) |

### Faucet (funding) — verified, human step

Verified from the official [Testnet Faucet](https://hub.arkiv.network/faucet)
UI bundle and `docs.arkiv.network/networks/rabdi/`:

* URL: `https://hub.arkiv.network/faucet` (only documented Rabdi faucet).
* The claim request is `POST /api/faucet` with `{ recipient, captchaToken }`
  and requires an authenticated Hub session; `GET /api/faucet` without a
  session returns `401 {"error":"Unauthorized"}`. So a claim needs the browser
  page: connect a wallet (sign-in message), enter the recipient address, solve
  the captcha, submit. The claim itself is an on-chain transaction
  (`txHash`), the amount is `amountGlm` tGLM, and the cooldown label defaults
  to **24 hours** ("one claim per wallet, per cooldown window").
* **To run:** open the URL in a browser, connect the wallet, set the recipient
  to the signer address above, solve the captcha, claim. Expected result: a
  claim transaction appears on Rabdi and
  `eth_getBalance(0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759)` becomes
  non-zero.

No faucet API keyed only by an address exists; no bypass was attempted.

### Access key — verified, human step (recommended)

Verified from [docs.arkiv.network/start-here/access-keys/](
https://docs.arkiv.network/start-here/access-keys/):

* URL: `https://hub.arkiv.network/access-keys`.
* Steps: connect a wallet and sign the sign-in message (a signature, not a
  transaction), finish Hub registration, select the network **Rabdi**, name the
  project, solve the captcha, generate. One key per wallet per network, with a
  monthly quota measured in cost units.
* The key is accepted in the RPC path, as an `X-API-KEY` header, or as a bearer
  token; `rabdi({ accessKey })` puts it in the URL for `http()`/`webSocket()`.
* **Expected result:** the public RPC stops answering `424/429`-style budget
  errors and the POC preflight can always run.
* Where it goes locally, without being printed: `apps/arkiv-poc/.env.local`
  (`ARKIV_ACCESS_KEY` for the harness, `VITE_ARKIV_ACCESS_KEY` for the browser
  build).

### Pre-publication verification — 8/8 PASS (2026-11-05)

`scripts/prepub-check.mjs` runs the eight gates read-only: it signs nothing and
sends no transaction. Run it from `apps/arkiv-poc`:

```bash
pnpm --filter @blocklab/arkiv-poc exec node --env-file=.env.local scripts/prepub-check.mjs
```

The funding transfer was located by scanning recent blocks, because Rabdi
serves state at the head only (no historical `eth_getBalance`) and the
explorer's transaction index lists Arkiv entity transactions, not native value
transfers. Verified funding transaction:
`0x79513168f51255074564bdd79bff0ce72071fe4be6f62a6b1d74c94899611f1a`
(block `268498`, `2026-11-05T23:52:36Z`, `5.000000 tGLM`, receipt status
success, gas used `21000`) — the full balance, from a single deposit.

### Publication command (not run yet)

```bash
pnpm --filter @blocklab/arkiv-poc exec node --env-file=.env.local scripts/try-write.mjs
```

The harness checks chain id `7794095`, runs the duplicate preflight for
`poc-write-001`, reads the signer balance, and only then signs **one**
`createEntity`. It prints the transaction hash, entity key, expiry block, and
an explorer link, reads the entity back, and compares the on-chain fields
(experimentId, experimentType, scenarioName, status, targetChainId, startedAtMs)
against the submitted record.

### Why re-runs are safe

The harness uses the stable experiment id `poc-write-001`. A re-run first
checks `arkiv_query` for that id; if the entity exists it prints the existing
entity and exits without signing. If a write errors after an uncertain result,
the harness re-checks for the entity instead of re-signing, and any later run
is protected by the same preflight. The duplicate-check query lives in
`apps/arkiv-poc/src/repository.ts`, shared with the browser gateway, and is
covered by unit tests.

## Scope and boundary

Arkiv is a Rabdi-testnet metadata store for experiment records. It stores a
compact, allowlisted record; traces, prompts, raw RPC payloads and evidence files
stay local.

```text
apps/arkiv-poc ──> @arkiv-network/sdk@1.0.1 ──> viem
       └─────────> @blocklab/arkiv-metadata
```

* `packages/arkiv-metadata` is dependency-free (no SDK, no viem, no DOM, no
  Node). It defines the schema version, the allowlisted record, strict
  validation and the canonical payload bytes + SHA-256 digest.
* `apps/arkiv-poc` is the only workspace that imports `@arkiv-network/sdk`.
  `apps/cli`, `@blocklab/runner`, `@blocklab/core`, `@blocklab/evidence` and
  `apps/studio` do not depend on it.
* The POC does not read a live experiment. It publishes a **sample** record that
  is clearly labelled as such, because the runner has no Arkiv adapter yet
  (Phase 15).

## Verified SDK and network facts

Checked against the installed package (`@arkiv-network/sdk@1.0.1`, published
2026-11-02) and the live network on 2026-11-05, not against earlier research.

| Fact | Value | How it was verified |
|---|---|---|
| SDK version | `1.0.1` | registry metadata + `node_modules` |
| Peer dependency | `viem ^2.0.0` (POC uses `2.57.16`) | package manifest |
| Chain | Rabdi, id `7794095` = `0x76edaf` | `eth_chainId` live |
| HTTP RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` | `rabdi()` in `src/chains/rabdi.ts` + live calls |
| Block time | 2 s | `arkiv_getBlockTiming` reported `blockDuration: 2` |
| Gas token | `tGLM` (18 decimals) | network reference + `eth_getBalance` |
| Explorer | `https://rabdi.explorer.arkiv.network` | network reference |
| Access keys | `rabdi({ accessKey })`; the key travels in the RPC URL path; `""` means the public, rate-limited endpoint | SDK source + live 429 |
| Schema tag | `defineSchema(name, columns)` adds an indexed `arkiv.schema` attribute | SDK source |
| Entity limits | 32 attributes, 128 bytes per string, 128 KB per entity | SDK constants |
| Lifetime | `ExpirationTime.fromDays/atBlock/atDate/max`, `MAX_LIFETIME` 7 884 000 blocks (~182.5 days) | SDK source |
| Write result | `createEntity` resolves after the receipt, returning `{ entityKey, txHash, expiresAt }` | SDK action source |
| Read API | `getEntity` (throws on missing/expired/deleted), `select`/`query` (needs ≥1 filter), `count`, `getBlockTiming` | SDK source |

`arkiv_query` quirks, found by probing the live endpoint:

* String literals must be single-quoted: `str('blocklab.experiment')`.
* Only one filter is accepted per call (`raw filter` rejects `a AND b`).
* Reserved words cannot be attribute names, and there is no wildcard schema
  selector.
* Queries against the anonymous budget are throttled hard (see Blockers).

## Record contract

Schema version `1.0`, Arkiv schema name and tag `blocklab.experiment`.

Indexed discovery subset (6 attributes): `experimentId`, `experimentType`,
`scenarioName`, `status`, `targetChainId`, `startedAtMs`. The canonical JSON
payload is stored as one `bytes` attribute and is never indexed.

Allowlisted record fields:

| Field | Rule |
|---|---|
| `schemaVersion` | exactly `1.0` |
| `experimentId` | `[a-z0-9-]`, 3–64 chars |
| `experimentType` | `[a-z0-9-]`, 3–48 chars |
| `scenarioName` | 1–80 chars, no URLs, no quotes |
| `targetChainId` | positive safe integer |
| `status` | `idle`, `running`, `passed`, `failed`, `partial`, `inconclusive` |
| `startedAtMs`, `completedAtMs` | `completedAtMs` is required for terminal statuses and must not precede `startedAtMs` |
| `requestCount`, `succeededCount`, `failedCount`, `rpcFailureCount` | non-negative integers; `succeeded + failed <= requestCount` |
| `latency` | `averageMs`, `p50Ms`, `p95Ms`, `maxMs`, non-negative, `p50 <= p95 <= max` |
| `evidenceDigest` | 64 hex chars (SHA-256 of the canonical payload or of local evidence) |
| `evidenceRef` | relative path, no scheme, no `..`, no absolute path |
| `expiryDays` | 1–180 |

Unknown keys are **rejected**, not dropped, so a caller cannot believe it
published a field that was silently removed. Credential-shaped values (mnemonics,
`privateKey:`, bearer tokens, `https://user:pass@`, cookies) are refused by
pattern as a second line of defence. The output is frozen.

## Workflow states

`apps/arkiv-poc/src/status.ts` is a typed state machine; `apps/arkiv-poc/src/workflow.ts`
drives it.

* Wallet: `missing` → `disconnected` → `connected` / `wrong-network`.
* Publish: `idle` → `preflight` → `signature` → `confirmed` → `read-back`, with
  `failed`, `existing` and `blocked` as terminal branches.
* An out-of-order confirmation is refused by `reduce`, so a stale async result
  cannot mark a run confirmed after a disconnect or a new attempt (a generation
  counter ignores stale async work).
* Publish is gated by: sample record valid, wallet connected, chain id exactly
  `0x76edaf`, explicit "I understand this writes a public record" checkbox, and a
  completed duplicate preflight.
* The duplicate preflight queries the schema by `experimentId`. If it fails, the
  run fails; it never proceeds "just in case". A duplicate is reported as
  `existing` and no second write is attempted.
* Read-back calls `getEntity(entityKey)` and decodes the payload with a strict hex
  decoder; a malformed payload is an error, not an empty record.

## Security constraints

* No private key or mnemonic is accepted anywhere. Signing happens in the user's
  wallet through EIP-1193; the POC never has the key.
* No transaction is sent without an explicit click plus the wallet's own
  confirmation. There is no auto-publish, no retry loop and no batch.
* Network switching is explicit: `wallet_switchEthereumChain` with a
  `wallet_addEthereumChain` fallback only on error `4902`, and only after a user
  click. A wrong network disables publish instead of silently switching.
* The access key is read from `VITE_ARKIV_ACCESS_KEY` (git-ignored `.env.local`),
  is never rendered, and is never put into wallet chain configuration.
* The POC uploads only the allowlisted record: no wallet identifiers as payload
  content, no raw RPC params, no credentials, no cookies, no detailed traces.
* Read calls are bounded (one attempt, 12–15 s) so a throttled request fails
  visibly instead of leaving the UI spinning.

## Verification evidence

### Live read-only network check

`node scripts/arkiv-net-check.mjs` — dependency-free JSON-RPC, no SDK:

```text
PASS  chain id is Rabdi (0x76edaf = 7794095)
PASS  head block is readable — 265483
PASS  block timing is readable and 2 s — block 265483, 2s
PASS  arkiv_query with a schema tag works — posts entities: 8
PASS  public entity returns system metadata — 0x0bad5aee…323c3
PASS  owner field is an address — 0xe4db637e…7ce357
PASS  creator field is an address — 0xe4db637e…7ce357
PASS  expiresAt is a block height — 0x28d469
PASS  arkiv_getEntity returns the same key
PASS  arkiv_getEntity returns null for an unknown key
PASS  no transaction was sent by this check
11/11 checks passed
```

This check is read-only by construction: it uses `fetch` and JSON-RPC and has no
signing path at all.

### Browser POC check

`node scripts/arkiv-poc-check.mjs --url <preview-url> --mode <mode>` drives real
headless Chrome over CDP. Three modes were run against the production build
(2026-11-05, HeadlessChrome 156, `vite preview` on `127.0.0.1`):

| Mode | Result |
|---|---|
| `self-test` (`?selftest=1`) | Live probe OK: chain `7794095`, block `265399`, `blockDuration 2`, tag `blocklab.experiment`, 0 existing entities. Wallet `missing`, publish disabled, result card hidden, 14 record rows, 4 live read calls, **0 writes**, no secret shapes in the rendered text. |
| `wallet-mismatch` (mock wallet on chain `0x1`) | Connect → `wrong-network`; network panel reports the wrong network; the switch button is offered; publish stays disabled; clicking switch surfaces the rejection; **0** `eth_sendTransaction`. |
| `wallet-reject` (mock wallet on Rabdi) | Full publish path to the wallet: `eth_accounts`, `eth_chainId`, `eth_blockNumber`, `eth_estimateGas`, `eth_chainId`, **one** `eth_sendTransaction`, rejected with `4001`. UI shows `[user-rejected]`, "Publish failed; nothing was written.", no entity key, no transaction hash, result card hidden. |

The second and third modes inject a **mock** EIP-1193 provider. It is labelled
`isBlocklabMockWallet`, it signs nothing, and its `eth_sendTransaction` always
rejects. This verifies the client state machine, not a chain interaction. Because
the anonymous `arkiv_query` budget was exhausted, the mode-3 duplicate preflight
is stubbed with an empty result set over CDP; every write-side call is real.

### Harness preflight run (Phase 14B, 2026-11-05)

`node --env-file=.env.local scripts/try-write.mjs`, with the prepared signer and
no funds (real live chain, no mocking):

```text
access key: none (public, rate-limited endpoint)
chain id: 7794095
preflight: no entity with experimentId "poc-write-001"
signer: 0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759 (from .env.local, value not printed)
balance: 0 wei (0 tGLM)
BLOCKED: the signer has no tGLM on Rabdi, so no transaction can be paid for.
Fund 0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759 at
https://hub.arkiv.network/faucet (Rabdi, tGLM). Nothing was signed and no
entity was written.
exit=2
```

This is a genuine read of Rabdi (chain id, `arkiv_query`, `eth_getBalance`)
followed by a refusal to sign, not a mocked test.

### Pre-publication verification (Phase 14B, 2026-11-05)

`node --env-file=.env.local scripts/prepub-check.mjs` — read-only, authenticated
with the access key, signs nothing:

```text
PASS  3. signer derivation: derived 0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759 (expected 0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759)
PASS  5. access keys configured: both set and equal (41 chars), distinct from the private key; values not printed
PASS  4. .env.local ignored, nothing secret staged: ignored=true tracked=false stagedEnvFiles=none
PASS  6. authenticated RPC connectivity: chain 7794095 (expected 7794095), head block 268990, arkiv_query 3/3 rounds ok (no 429/401)
PASS  2. live signer balance: 5.000000 tGLM (5000000000000000000 wei)
PASS  1. funding transaction: block 268498 (2026-11-05T23:52:36.000Z) tx 0x79513168f51255074564bdd79bff0ce72071fe4be6f62a6b1d74c94899611f1a from 0xd431714db82331b07697ea4675334c3af6d2ebe9 value 5.000000 tGLM = full balance (single deposit) status success, gas used 21000
PASS  7. duplicate preflight: experimentId "poc-write-001": no existing entity, safe to create
PASS  8. funds sufficient for one publication: gas price 1000000000 wei; realistic ~32812 gas = 0.000033 tGLM; SDK worst-case cap 0.016777 tGLM; balance 5.000000 tGLM (covers the worst case)

SUMMARY 8/8 checks passed — ready to publish on explicit approval.
```

The funds check is bounded by the SDK's own constants: `MAX_TRANSACTION_GAS`
(`2^24` gas) with the 25 % headroom the SDK applies, so `5 tGLM` covers even
the worst-case cap. The expected cost of one publication is about
`0.000033 tGLM` at a `1 gwei` gas price.

### Unit tests

* `packages/arkiv-metadata`: 41 tests (schema, strict validation, canonical
  payload + digest).
* `apps/arkiv-poc`: status machine, workflow against a mock gateway, gateway
  mapping/decoding, wallet error classification, bounded probe timeout, and the
  shared duplicate-preflight query (`repository.test.ts`, including the rule that
  a throttled check throws instead of returning "no duplicate").
* Whole repository: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
  clean (counts in the Phase 14B report).

## Blockers (honest state)

1. **The publication itself has not run.** Funding was the only real blocker
   and it is cleared (signer `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759` holds
   `5 tGLM`); publication waits for explicit approval, so there is still no real
   transaction hash of a write and no entity key. Once approved, one command
   completes and verifies the publication (see above).
2. **Anonymous query budget — mitigated by the access key.** Without a key the
   public endpoint answers `arkiv_query` with HTTP 429 and
   `{"error":"ANON_COST_LIMITED",...}`. With `ARKIV_ACCESS_KEY` configured the
   same reads return consistently (3/3 rounds in the check above). The POC still
   surfaces a failed duplicate check as a fast `[network]` error and refuses to
   continue a write whose duplicate check could not run.
3. **Owner/creator semantics not experimentally verified.** Only observed
   indirectly on public `posts` entities, where `owner == creator == author`. No
   two-wallet experiment (write as A, read as B, change ownership) was run, so no
   claim is made about creator preservation on transfer.
4. **Expiry not experimentally verified.** SDK semantics were read
   (`fromDays`, `atLeast`, expiry resolves as `max(expiresAt, currentBlock +
   minLifetime)`, max lifetime cap) but no expired-record observation was made:
   that needs a real write plus a wait beyond a chosen lifetime.
5. **Browser write not exercised end to end.** A headless browser has no wallet
   extension, so the only browser-verified write path is the rejection path above.

## Running the POC

```bash
pnpm --filter @blocklab/arkiv-poc dev        # http://127.0.0.1:5173
pnpm --filter @blocklab/arkiv-poc build
node scripts/arkiv-net-check.mjs             # live read-only check
node scripts/arkiv-poc-check.mjs --url http://127.0.0.1:5177/?selftest=1 --mode self-test
node scripts/arkiv-poc-check.mjs --url http://127.0.0.1:5177/ --mode wallet-mismatch
node scripts/arkiv-poc-check.mjs --url http://127.0.0.1:5177/ --mode wallet-reject

# live read-only pre-publication gates (8 checks; signs nothing)
pnpm --filter @blocklab/arkiv-poc exec node --env-file=.env.local scripts/prepub-check.mjs

# real publication (needs a funded signer in .env.local; safe to re-run)
pnpm --filter @blocklab/arkiv-poc exec node --env-file=.env.local scripts/try-write.mjs
```

`apps/arkiv-poc/.env.example` documents `VITE_ARKIV_ACCESS_KEY`. Writes also need
a browser wallet with Rabdi configured and a funded testnet balance; the POC adds
the network only after a user click.

## What is deliberately not claimed

* No write, transaction, entity key or explorer link.
* No anonymity, privacy or data-availability property.
* No ownership/creator or expiry behaviour.
* No Studio integration; Phase 15 stays gated on a real write/query/retrieve run.
