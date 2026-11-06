# BLOCKLAB — Scope-Frozen Implementation Backlog

**Status:** Scope frozen after Phase 03. All tasks remain unstarted unless explicitly marked `DONE`.
**Priorities:** P0 = core MVP; P1 = primary sponsor/demo work; P2 = conditional or post-core work.
**Statuses:** `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DROPPED`.

## Working rules

- Every task has a verifiable acceptance criterion.
- Dependencies are listed explicitly; documentation review never marks an integration complete.
- No imported repository script runs without explicit approval and a safe execution boundary.
- Detailed traces remain local by default and all exported/public data is redacted.
- Review every diff and inspect installed package declarations before implementing integrations.

## Phase and governance

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| GOV-01 | P0 | Keep approved root workspace | — | `E:\eth-mumbai` remains the repository root | DONE |
| GOV-02 | P0 | Add planning documents | GOV-01 | PRD, plan, and backlog remain readable at root | DONE |
| GOV-03 | P0 | Initialize Git | GOV-01 | Local repository exists with no remote configured | DONE |
| GOV-04 | P0 | Add bootstrap README and gitignore | GOV-03 | README and exclusions exist; no dependencies or scaffold exist | DONE |
| GOV-05 | P0 | Validate official integration requirements | GOV-02 | Anon-RPC, Arkiv, Anvil, and ENS facts are classified | DONE |
| GOV-06 | P0 | Freeze MVP scope and acceptance criteria | GOV-05 | PRD, plan, and backlog agree on scope and gates | DONE |
| GOV-07 | P2 | Record AI-use disclosure | GOV-06 | Submission documentation accurately describes AI assistance | TODO |

## Architecture and toolchain

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| ARC-01 | P0 | Create pnpm workspace | GOV-06 | Workspace install and package discovery work | DONE |
| ARC-02 | P0 | Define shared domain models | ARC-01 | Project, dependency, scenario, experiment, result, and status types compile | DONE |
| ARC-03 | P0 | Define runner and adapter boundaries | ARC-02 | Node and browser execution responsibilities are explicit | DONE |
| ARC-04 | P0 | Define evidence and redaction schema | ARC-02 | Required metrics and digest inputs are typed; sensitive fields are excluded | DONE |
| ARC-05 | P0 | Define local Studio agent boundary | ARC-03 | Browser has no arbitrary filesystem/process access | DONE |
| TOOL-01 | P0 | Configure strict TypeScript | ARC-01 | Typecheck passes in a clean workspace | DONE |
| TOOL-02 | P0 | Configure lint, format, test, and build scripts | ARC-01 | All focused scripts run successfully | DONE |
| TOOL-03 | P1 | Add CI checks | TOOL-01; TOOL-02 | CI runs install, lint, typecheck, test, and build | TODO |
| ARC-06 | P1 | Document architecture/data flow | ARC-02; ARC-03 | Documentation matches implemented boundaries | DONE |

## Safe inspector

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| INS-01 | P0 | Detect package managers and manifests | ARC-02 | npm, pnpm, yarn, and bun lockfiles are identified | DONE |
| INS-02 | P0 | Detect React, Next.js, and Vite | INS-01 | Framework evidence and limitations are reported | DONE |
| INS-03 | P0 | Detect Wagmi, Viem, and Ethers | INS-01 | Dependencies and relevant references are reported | DONE |
| INS-04 | P0 | Detect Foundry and Hardhat | INS-01 | Config/source evidence is reported; Hardhat is not assumed executable | DONE |
| INS-05 | P0 | Parse safe chain/RPC configuration | INS-01 | Non-secret values are reported and secret values are redacted | DONE |
| INS-06 | P0 | Build evidence-labelled dependency graph | INS-02; INS-03; INS-04 | Nodes and edges include source and confidence | DONE |
| INS-07 | P0 | Add stable JSON inspection output | INS-06 | CLI JSON output has a documented stable shape | DONE |
| INS-08 | P1 | Add safe GitHub source inspection | INS-06 | Public source is inspected without arbitrary script execution | TODO |
| INS-09 | P2 | Add external observation mode | INS-06 | Reports contain only externally observable claims | TODO |

## Sample dApp and local environment

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| DEMO-01 | P0 | Create minimal TypeScript sample dApp | TOOL-01 | Sample starts with documented commands | DONE |
| DEMO-02 | P0 | Add configurable read-only RPC | DEMO-01 | Endpoint can point to the local proxy | DONE |
| DEMO-03 | P0 | Add baseline health/read probe | DEMO-02 | Baseline success and latency are measurable | DONE |
| DEMO-04 | P0 | Add Anvil local environment | DEMO-02 | Local chain starts/stops predictably or Docker fallback is documented | DONE |
| DEMO-05 | P0 | Add controlled sample startup/cleanup | DEMO-04 | Processes are owned and removed after all outcomes | TODO |

## Runner, proxy, and rpc-blackout

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| RUN-01 | P0 | Implement lifecycle runner | ARC-03 | Preflight through cleanup and evaluation emit ordered events | DONE |
| RUN-02 | P0 | Add timeout, cancellation, and emergency stop | RUN-01 | Active runs stop safely with explicit status | DONE |
| RUN-03 | P0 | Enforce loopback safety | RUN-01 | Default targets reject non-loopback endpoints | DONE |
| RUN-04 | P0 | Implement local RPC proxy | DEMO-02; RUN-03 | Normal JSON-RPC requests forward unchanged | DONE |
| RUN-05 | P0 | Implement bounded RPC fault injection | RUN-04 | Timeout/connection failure applies only during the fault window | DONE |
| RUN-06 | P0 | Capture proxy metrics and redacted events | RUN-04 | Counts, latency, IDs, timestamps, status, and error categories are recorded | DONE |
| RUN-07 | P0 | Implement rpc-blackout scenario | RUN-01; RUN-05; DEMO-03 | Baseline, outage, observation, restoration, and cleanup are captured | DONE |
| RUN-08 | P0 | Implement deterministic evaluator | RUN-07 | Result is one of passed, failed, partial, inconclusive | DONE |
| RUN-09 | P0 | Persist local evidence and digest | RUN-08 | Run can be listed/opened without sensitive payloads | DONE |
| RUN-10 | P0 | Implement replay and compare | RUN-09 | Replay validates preconditions; incompatible runs are rejected | DONE |

## CLI

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| CLI-01 | P0 | Implement `blocklab init` | ARC-02 | Config is created without overwriting user files | TODO |
| CLI-02 | P0 | Implement `blocklab inspect` | INS-07 | Human and JSON output are available | DONE |
| CLI-03 | P0 | Implement `blocklab scenarios` | RUN-07 | Lists scenario, preconditions, and safety scope | DONE |
| CLI-04 | P0 | Implement `blocklab test rpc-blackout` | RUN-10 | Runs the local experiment end to end | DONE |
| CLI-05 | P0 | Implement `blocklab replay` | CLI-04 | Replays a stored experiment after validation | DONE |
| CLI-06 | P0 | Implement `blocklab compare` | CLI-05 | Shows comparable metric differences | DONE |
| CLI-07 | P0 | Implement `blocklab report` | CLI-04 | Exports JSON and Markdown reports | DONE |
| CLI-08 | P0 | Add help and stable exit codes | CLI-01; CLI-04 | Invalid input and run failures are actionable | DONE |
| CLI-09 | P0 | Verify local-only operation | CLI-04 | Core workflow runs without Studio or hosted account | DONE |

## Anon-RPC primary integration

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| ANON-01 | P1 | Add browser POC fixture | CLI-09 | `@anon-rpc/browser-harness@0.4.0` is used only in a browser | DONE |
| ANON-02 | P1 | Verify worker lifecycle and errors | ANON-01 | Ready, fetch, close, and failure paths are observed | DONE |
| ANON-03 | P1 | Verify Viem adapter | ANON-02 | Exact type-safe adapter is proven by a working read | DONE |
| ANON-04 | P1 | Verify real anonymizing worker | ANON-03 | Official worker performs an eligible read successfully | DONE |
| ANON-05 | P1 | Measure direct versus Anon-RPC | ANON-04 | Coverage, success rate, latency, and exclusions are recorded | DONE |
| ANON-06 | P1 | Route eligible demo reads by default | ANON-05 | Browser demo default path uses Anon-RPC for supported reads | DONE |
| ANON-07 | P1 | Add privacy comparison reporting | ANON-06 | Measured facts and documented limitations are separated | DONE |
| ANON-08 | P1 | Add Studio Anon-RPC view | ANON-07 | UI displays route coverage and comparison without anonymity overclaims | DONE |
| ANON-09 | P1 | Export redacted RPC comparison snapshot | ANON-08 | A valid comparison downloads as a versioned, redacted JSON artifact with an explicit completeness label | DONE |
| ANON-11 | P1 | Add end-to-end sponsor evidence | ANON-06 | Evidence proves actual default routing and app behavior | DONE |
| ANON-10 | P2 | Keep CLI boundary explicit | ANON-01 | CLI reports browser-only limitation and never simulates the harness | DONE |

ANON-03 is delivered as the `@blocklab/browser-rpc/viem` entry point (Viem
2.57.16, optional peer dependency). It reuses the existing transports, keeps the
read-only allowlist and no-fallback guarantee, and was verified with a real Viem
public client in headless Chrome on both the `passthrough` and `tor-js` workers
(`getChainId`, `getBlockNumber`, `getBalance`, and `eth_call`). ANON-08 adds the
read-only Studio comparison panel (`@blocklab/studio/comparison`): the host page
publishes a `StudioRpcSnapshot`, Studio validates it, recomputes coverage from the
attempts, keeps skipped methods distinct from successes, reports Viem results
separately, and renders fixed privacy limitations. Verified in headless Chrome on
2026-11-05 for passthrough, `tor-js`, and a failing `nox` worker, plus empty,
live-refresh, and malformed-payload paths. ANON-09 adds the export: Studio builds
a `blocklab.rpc-comparison` schema `1.0` artifact from the validated model (never
from the raw payload), with a stable `runId`, an explicit
`complete`/`incomplete`/`failed` label and reasons, redacted error text, and no
raw parameters, headers, accounts, storage, or endpoint URLs. Download delivery
changed during verification: revoking the object URL synchronously aborted the
file in Chrome, so revocation is now deferred. The earlier sponsor-evidence item
was renumbered to ANON-11 to keep ANON-09 for this export work. ANON-04 was
originally verified without an adapter. Verified on 2026-11-05 in headless
Chrome 156: `tor-js` (network worker, mainnet specifier) routed 4/4 eligible
reads; `passthrough` (reference worker) routed 4/4 and is not anonymizing; a
deliberate specifier/chain mismatch failed loudly with no fallback. `nym` and
`nox` were not successfully exercised, and no anonymity property is claimed.

## Arkiv primary integration

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| ARK-01 | P1 | Add Arkiv POC fixture | CLI-09 | `@arkiv-network/sdk@1.0.1` and Viem are used with Rabdi | DONE |
| ARK-02 | P1 | Configure access and signer safely | ARK-01 | No private key is in source; signer is testnet-only/connected | DONE |
| ARK-03 | P1 | Write compact experiment entity | ARK-02 | Real entity write returns verifiable transaction/entity data | DONE (2026-11-06; see notes) |
| ARK-04 | P1 | Query and retrieve entity | ARK-03 | Indexed scenario/status query returns expected payload | DONE |
| ARK-05 | P1 | Verify owner and creator semantics | ARK-04 | Live result records observed ownership behavior | DONE (2026-11-07) — observed `changeOwnership`: owner A → B, creator unchanged, payload and expiry unchanged, `OwnershipTransferred` decoded, A then blocked; see [docs/arkiv-ark05.md](docs/arkiv-ark05.md) | Transfer semantics established from the SDK (`creator` immutable, `owner` mutable, owner must sign, no accept step) and implemented + unit-tested in Studio; no transfer broadcast yet (see note, [docs/arkiv-ark05.md](docs/arkiv-ark05.md)) |
| ARK-06 | P1 | Verify expiry | ARK-04 | Expiry configuration and observed behavior are documented | PARTIAL — configuration documented on both entities; nothing observed expiring yet (`studio-mm-001` expires at block `586222`) |
| ARK-07 | P1 | Implement connected-wallet Studio write | ARK-06 | User signs without pasting a private key | DONE (2026-11-06) — real MetaMask signature from Studio, entity `0x9038f929…bcb7`, tx `0xef91a94a…5f2d9`, 11/11 read-back checks; evidence in [docs/arkiv-ark07.md](docs/arkiv-ark07.md) |
| ARK-08 | P1 | Implement Arkiv history query/retrieve | ARK-07 | Studio displays loading, empty, error, expired, and success states | PARTIAL — implemented and unit-tested; loading/empty/error verified in headless Chrome with the mock wallet, but the success state is only reachable live now that `studio-mm-001` exists (not yet driven through Studio's DOM), and the expired state needs ARK-06 |
| ARK-09 | P1 | Implement validated local replay | ARK-08; CLI-05 | Retrieved definitions are validated before local execution | PARTIAL — retrieval and canonical revalidation are DONE (`arkivRecordFromRow` round-trip, shared contract); replaying a retrieved definition locally from Studio is deliberately out of scope and unbuilt |
| ARK-10 | P1 | Complete evidence documentation | ARK-09 | Schema, friction, reach, rationale, and usage docs contain real evidence | DONE (architecture, Studio README, arkiv-poc.md, plan/backlog) |

Arkiv status notes (Phase 14 POC, [docs/arkiv-poc.md](docs/arkiv-poc.md)):

- **ARK-01 DONE**: `@arkiv-network/sdk@1.0.1` + viem `2.57.16` in `apps/arkiv-poc` only; package and live Rabdi facts verified (`0x76edaf`, 2 s blocks).
- **ARK-02 DONE**: no private key in source; signing is wallet-side EIP-1193; access key optional and git-ignored.
- **ARK-03 DONE (2026-11-06)** — first real publication signed, mined and
  verified. Exactly one `createEntity`: tx
  `0xed989cbe6d5b0aad7db1d03e0d7e16ff6865fb6f5a915d08c08f7bfa3c573f05`, block
  `269199`, entity `0x1d7b6bf841deab1a003cc7c1fa407b97e7e27fb6de276dc287b8e2e0551bb31a`,
  actual gas `0.000209105 tGLM`. Signer `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759`
  (rotated after exposure; key in git-ignored `apps/arkiv-poc/.env.local`).
  Read-back verified: entity queryable by key, `owner == creator ==` signer,
  expiresAt block `571599`, on-chain payload byte-identical to the canonical
  record and re-validating (603 bytes, SHA-256 `410e3d5c…38f4d`).
- **ARK-04 DONE (read-only)**: schema-tagged `arkiv_query`, `getEntity` hit + miss verified live; strict payload decode covered by tests. The published `blocklab.experiment` record is now findable by `experimentId` too.
- **ARK-05 PARTIAL**: `owner == creator` is verified on both published entities
  (`poc-write-001`, and the MetaMask-signed `studio-mm-001`) and on public `posts`
  entities, but every write used a single wallet. The transfer *mechanism* is now
  pinned to the installed SDK, not to names: `OperationType.TransferOwnership = 4`
  with an op of exactly `(bytes32 entityKey, address newOwner)`, a wallet action
  `changeOwnership`, `NotOwner`/`TransferToSelf`/`TransferToZeroAddress` reverts,
  and no recipient-accept step anywhere — so `creator` cannot change, `owner` can,
  and only the owner may sign (evidence table in
  [docs/arkiv-ark05.md](docs/arkiv-ark05.md)). Studio now has a preview → confirm →
  read-back transfer flow with every precondition gated, and it never auto-retries.
  **Creation stage DONE (2026-11-07):** `studio-mm-002` was published once by A
  (entity `0x2b81eff4711b9f5bf4afccf0c427bdd0e5ebad9ebc0dd62e4495b5b016c4b1eb`, tx
  `0x852d9eb1…f9cdc0`, block `285811`, 496 bytes SHA-256 `dfe87f08…3391f9d`, gas
  `0.000187358 tGLM`, owner == creator == signer, expiry `588211`), verified 10/10
  by the driver and 10/10 independently. **Still missing:** the transfer itself, so
  nothing is claimed about live transfer behaviour, gas for a transfer, or the
  `OwnershipTransferred` event.
- **ARK-06 PARTIAL**: expiry *configuration* is evidenced twice — `expiresAt` `571599` on `poc-write-001` and `586222` on `studio-mm-001`, both exactly `creation + 302400` blocks, matching the `expiryDays: 7` request. Nothing has been *observed* expiring: both entities are still inside their windows, so the post-expiry read behaviour (`NoEntityFoundError` / `missing` state) is only unit-tested, never seen against Rabdi.
- **ARK-07 DONE (2026-11-06)**: a real MetaMask approval published the dedicated
  test record `studio-mm-001` from Studio on Rabdi and the entity was read back
  and byte-compared from a separate process: **11/11 checks**. Entity
  `0x9038f929ac92b25eb383fa6648290d631c18e5c9976a51fffc9f964adeecbcb7`, tx
  `0xef91a94aa8eb3df5881d42d801fe3217a764378d9253867b1b981e9dddc5f2d9`, block
  `283822`, signer `0xD431…2EBE9` (MetaMask), payload 493 bytes SHA-256
  `59c090b8…726a6`, gas `197983` → `0.000197983 tGLM`, expiry `+302400` blocks,
  receipt success, byte-identical canonical payload, schema revalidation true,
  indexed retrieval by `experimentId`, `owner == creator == signer`. Explorer:
  `rabdi.explorer.arkiv.network/entity/0x9038f929…bcb7`. The user signed from the
  wallet; no private key was pasted. Duplicate prevention held: any later run on
  this id is refused. Evidence, the full comparison with `poc-write-001`, and the
  shared verifier are in [docs/arkiv-ark07.md](docs/arkiv-ark07.md).
- **ARK-07 lifecycle fix (2026-11-06)**: the driver could neither exit cleanly nor
  report its documented exit code. Forced `process.exit()` while the CDP socket
  and the viem/undici keep-alive sockets were still open made Node abort on
  Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit
  `3221226505`) — reproduced 3/3 with six lines — and the success path returned
  without closing the socket, so after `VERIFIED` the process never exited (>120 s
  still running). Fixed with one exit path: blockers throw a `Stop` carrying the
  exit code, the socket closes in a `finally`, and `process.exitCode` is set so
  Node drains its own handles. `--check-only` on the already-published id now
  exits `2` with zero assertions in ~5 s; the `VERIFIED` tail exits `0` in under a
  second. No exit code or safety behaviour changed.
- **ARK-07 diagnosis + fix (2026-11-06)**: the first real publication attempt was
  refused by MetaMask with `The requested method and/or account has not been
  authorized by the user.` Diagnosed read-only (capture-and-block CDP interceptor,
  nothing sent): the request itself was correct — `from` = the connected
  `0xd431…2ebe9`, `to` = Arkiv `0x4400…0044`, gas `250902`, `eth_estimateGas`
  succeeded, `eth_accounts`/`wallet_getPermissions`/`eth_chainId` all correct for
  origin `http://localhost:5178`, so this was not account/chain drift and not a
  provider mismatch. The real defect was downstream: `classifyError` only knew
  `4001`, and its HTTP-status regex `5\d{2}` matched the hex calldata (the address
  contains `533`), so every provider code — including `4100` — was reported as a
  bogus `network` failure. Classification now reads EIP-1193 codes off the `cause`
  chain first (`4100`/`4900` → `unauthorized`, `4901` → `wrong-network`), before any
  message pattern, and `unauthorized` states that nothing was sent and to
  disconnect/connect again. 6 regression tests; confirmed in the live Studio
  (`[unauthorized] …` rendered, Publish re-enabled). 339 tests / 34 files, 25/25
  browser checks, lint/typecheck/build clean.
- **SUB-03 DONE (2026-11-06)**: a real write/query/retrieve run now exists and is verified (ARK-03 + read-back above); Studio integration for Phase 15 can gate on it instead of mock claims.
- **Phase 15 regression fix (2026-11-06)**: the Connect control was rendered but
  hidden for every status except `missing`, so a detected-but-unauthorized wallet
  (the normal state on load) showed no way to connect, and Disconnect was hidden
  permanently. Visibility now comes from `walletView` and the DOM only obeys it;
  covered by 8 view + 6 DOM tests and 5 new browser checks (connect visible,
  Detect hidden, `eth_requestAccounts` really requested, rejection stays
  disconnected, rejection labelled user-rejected). 25/25 browser checks pass.
- **Phase 15 Studio integration (2026-11-06)**: `apps/studio/src/arkiv/` adds
  wallet connect/chain detection, gated publish with duplicate preflight and
  byte-level read-back, history search over the indexed attributes, record
  details, and a metadata comparison that reuses the shared contract. Verified by
  313 unit tests / 33 files plus `scripts/studio-arkiv-check.mjs` (20/20
  headless-Chrome checks with a labelled mock wallet). The browser run proves
  wiring and gating only and never claims a publication. Real publication claims
  rest on receipts: `poc-write-001` (ARK-03, harness key) and `studio-mm-001`
  (ARK-07, MetaMask-signed from Studio). ARK-05 (two-wallet ownership transfer) and
  ARK-06 (observed expiry) stay PARTIAL and are explicitly not claimed.

### Next Arkiv requirement (implementation ready, live run pending)

**ARK-05 — verify owner and creator semantics.** Highest remaining P1: every Arkiv
write so far used one wallet, so `creator` versus `owner` has never been
meaningfully distinguished.

- **Mechanism: settled from the SDK.** `OperationType.TransferOwnership = 4`, op
  payload exactly `(bytes32 entityKey, address newOwner)`, wallet action
  `changeOwnership`, reverts `NotOwner`/`TransferToSelf`/`TransferToZeroAddress`/
  `EntityExpired`, event `OwnershipTransferred(entityKey, previousOwner,
  newOwner)`, `$owner` queryable and reserved. No accept step exists in the SDK, so
  a transfer is one owner-signed transaction and `creator` cannot change.
  Evidence table: [docs/arkiv-ark05.md](docs/arkiv-ark05.md).
- **Implemented:** preview → confirm → read-back in Studio (`ownership.ts` pure
  logic + `state`/`view`/`dom` + two gateway methods), with every precondition
  gated, a live re-read before sending, an in-process read-back comparison and no
  automatic retry. Unit-tested only so far.
- Acceptance: a live result that records *observed* ownership behaviour, i.e. a
  two-wallet experiment (wallet A creates, wallet B receives) and/or an observed
  `changeOwnership`, with `owner` and `creator` compared before and after, plus the
  negative check that A can no longer transfer. Procedure: the runbook in
  [docs/arkiv-ark05.md](docs/arkiv-ark05.md).
- Dependencies: ARK-04 (DONE). Needs a second funded Rabdi account; must not touch
  `poc-write-001` or `studio-mm-001` — a fresh id (`studio-mm-002`) is required.
- Then ARK-06 (observed expiry), which needs a short-lifetime entity and a wait
  across its `expiresAt` block; and ARK-08's live success/expired states, which
  depend on both.

## ENSv2 conditional

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| ENS-01 | P2 | Recheck current ENSv2 requirements | CLI-09; ANON-06; ARK-06 | Network, addresses, ABI, gas, and wallet requirements are current | TODO |
| ENS-02 | P2 | Decide include/drop | ENS-01 | ENS is included only if central and safe for the deadline | TODO |
| ENS-03 | P2 | Implement real namespace/permission flow | ENS-02 | No hard-coded permission simulation exists | TODO |
| ENS-04 | P2 | Verify grant and revoke | ENS-03 | On-chain grant enables and revoke rejects the action | TODO |
| ENS-05 | P2 | Capture transaction evidence | ENS-04 | UI/docs link to real network evidence | TODO |

## Studio and quality

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| UI-01 | P0 | Build minimal navigation | ARC-05 | Projects, Experiments, History, Settings only | TODO |
| UI-02 | P0 | Build project overview and graph | INS-06; UI-01 | Evidence and limitations are visible | TODO |
| UI-03 | P0 | Build experiment preflight | RUN-07; UI-01 | Target, fault, scope, and safety are explicit | TODO |
| UI-04 | P0 | Build actual event timeline | RUN-01; UI-03 | Timeline is driven by runner events, not animation | TODO |
| UI-05 | P0 | Build result/replay/compare view | RUN-10; UI-04 | Metrics, status, evidence, replay, and comparison are usable | TODO |
| UI-06 | P1 | Add Arkiv history view | ARK-08; UI-01 | Records are read from Arkiv, not mocked | PARTIAL (Studio history panel implemented; live reads exercised by the verified POC entity, mock-limited in browser checks) |
| UI-07 | P1 | Add Anon-RPC comparison view | ANON-08; UI-01 | Browser measurements and exclusions are visible | DONE (Phase 13, comparison panel; exported via studio-view-check/export-check) |
| SAFE-01 | P0 | Test redaction and local evidence | RUN-09 | Secrets, cookies, wallet identifiers, and raw payloads are absent | TODO |
| SAFE-02 | P0 | Test cleanup and cancellation | RUN-02; DEMO-05 | No orphaned process/proxy remains | TODO |
| SAFE-03 | P0 | Security review trust boundaries | SAFE-01; SAFE-02 | High-impact findings are fixed or explicitly documented | TODO |

## Submission

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| SUB-01 | P0 | Complete README and setup | CLI-09; UI-05 | Fresh user reproduces the core demo | TODO |
| SUB-02 | P0 | Add license and AI disclosure | SUB-01 | Repository disclosures are accurate | TODO |
| SUB-03 | P0 | Verify sponsor claims | ANON-11; ARK-10 | Only working integrations are claimed | TODO |
| SUB-04 | P0 | Run clean-clone verification | SUB-01; SAFE-03 | Install, tests, and demo work from clean checkout | TODO |
| SUB-05 | P0 | Record demo evidence | SUB-03; SUB-04 | Video/script shows real CLI, Studio, and selected integrations | TODO |
| SUB-06 | P0 | Submit before deadline | SUB-05 | Submission confirmation and final commit reference saved | TODO |

## Implementation order

1. GOV-01 through GOV-06 (complete).
2. ARC-01 through ARC-06 and TOOL-01 through TOOL-03.
3. INS-01 through INS-07.
4. DEMO-01 through DEMO-05.
5. RUN-01 through RUN-10.
6. CLI-01 through CLI-09.
7. ANON-01 through ANON-10 and ARK-01 through ARK-10.
8. UI-01 through UI-07.
9. SAFE-01 through SAFE-03 and submission tasks.
10. ENS-01 through ENS-05 only if the conditional gate passes.

## Decision log

| Date | Decision | Rationale | Revisit condition |
|---|---|---|---|
| 2026-11-05 | TypeScript/JavaScript dApps first | Focus the MVP | Post-hackathon |
| 2026-11-05 | pnpm workspace monorepo | Approved workspace direction | Tooling friction requires review |
| 2026-11-05 | CLI is first-class and local-first | Core workflow must not depend on Studio | Never for MVP |
| 2026-11-05 | `rpc-blackout` is first complete scenario | Safe, measurable, reproducible | Local proxy feasibility fails |
| 2026-11-05 | Anon-RPC is browser-only primary integration | Official harness boundary and sponsor fit | Browser POC fails |
| 2026-11-05 | Arkiv Rabdi is primary history integration | Real user-owned queryable metadata | Write/query POC fails |
| 2026-11-05 | ENSv2 is conditional and off critical path | Namespace and grant/revoke setup risk | Core and primary integrations finish early |
| 2026-11-05 | Python backend support deferred | Not required for the MVP | Post-hackathon |
