# Arkiv Rabdi proof of concept

## Status

Phase 14 built an isolated browser POC for the Arkiv sponsor integration and
verified the network, the SDK and the read path **live on the Rabdi testnet**.
The real entity write did **not** happen: the testnet faucet needs a connected
browser wallet, the harness signer holds `0 tGLM`, and nothing was signed. The
browser write path was therefore verified only up to the wallet's signature
request, with a deliberately mock wallet that rejects it.

Nothing in this document claims a write, a transaction hash, an entity key, an
ownership experiment or an expiry experiment that did not happen.

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

### Unit tests

* `packages/arkiv-metadata`: 41 tests (schema, strict validation, canonical
  payload + digest).
* `apps/arkiv-poc`: 41 tests (status machine, workflow against a mock gateway,
  gateway mapping/decoding, wallet error classification, bounded probe timeout).
* Whole repository: 243 tests in 24 files; `pnpm lint`, `pnpm typecheck`,
  `pnpm build` clean.

## Blockers (honest state)

1. **No real entity write.** `apps/arkiv-poc/scripts/try-write.mjs` refuses to
   fabricate a result: it reads the signer's balance first. The fresh signer
   `0x34940e918A82738459C5471b88B45267D184fd1C` holds `0 tGLM`, so the harness
   exited with code 2 and a message instead of signing. The faucet at
   `hub.arkiv.network/faucet` requires a connected browser wallet and a cooldown,
   so it is not scriptable. Consequence: there is no real transaction hash, no
   real entity key and no explorer link yet.
2. **Anonymous query budget exhausted.** Without an access key the public
   endpoint answers `arkiv_query` with HTTP 429 and
   `{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted;
   get an API key at https://hub.arkiv.network for a monthly quota"}`. Reads
   therefore need `VITE_ARKIV_ACCESS_KEY` for repeated runs. The POC surfaces this
   as a fast `[network]` error and refuses to continue a write whose duplicate
   check could not run.
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
```

`apps/arkiv-poc/.env.example` documents `VITE_ARKIV_ACCESS_KEY`. Writes also need
a browser wallet with Rabdi configured and a funded testnet balance; the POC adds
the network only after a user click.

## What is deliberately not claimed

* No write, transaction, entity key or explorer link.
* No anonymity, privacy or data-availability property.
* No ownership/creator or expiry behaviour.
* No Studio integration; Phase 15 stays gated on a real write/query/retrieve run.
