# BLOCKLAB — 20-Phase Execution Plan

**Purpose:** Build a realistic, evidence-backed MVP from the approved workspace bootstrap through submission.
**Deadline target:** 7 November 2026, 09:00 IST; verify the live event page before submission.
**Status:** Scope frozen after Phase 03. No phase may claim sponsor completion from documentation alone.

## Execution principles

1. Build the local vertical slice before sponsor integrations: inspect → RPC blackout → evidence → replay.
2. CLI and Studio consume one shared domain model and experiment definition.
3. The CLI is first-class and never pretends to run browser-only Anon-RPC.
4. Studio uses an explicit local application/agent boundary for filesystem and process access.
5. Default fault injection is loopback-only; staging requires explicit authorization.
6. Anon-RPC and Arkiv require working POCs before integration work is marked complete.
7. Arkiv stores compact metadata only; detailed traces remain local.
8. ENSv2 and Python backend support are outside the MVP critical path.
9. Every phase has ten steps and an exit gate.
10. Read diffs, inspect package types, run focused tests, and record evidence.

## Phase 01 — Workspace and project bootstrap

1. Keep `E:\eth-mumbai` as the repository root.
2. Open the root folder in VS Code.
3. Preserve `PRD.md`, `plan.md`, and `backlog.md` at the root.
4. Confirm Node.js, npm, pnpm, Git, and Docker versions.
5. Initialize Git without configuring a remote.
6. Choose pnpm as the package manager.
7. Add the initial README.
8. Add the root `.gitignore`.
9. Confirm no dependencies or application scaffold exist.
10. Review the bootstrap diff and status.

**Exit gate:** Approved bootstrap files exist; no application code or dependencies exist. **Completed.**

## Phase 02 — Technical validation

1. Read the official Anon-RPC specification and repository.
2. Verify `@anon-rpc/browser-harness` version and browser boundary.
3. Verify worker lifecycle, configuration, and trust limitations.
4. Identify the Viem adapter POC needed for default read routing.
5. Verify Arkiv SDK version, Rabdi chain, access-key model, and entity APIs.
6. Verify Arkiv signing, ownership, query, and expiry assumptions.
7. Verify Anvil installation options and local RPC behavior.
8. Verify ENSv2 networks, permission model, and address-source requirements.
9. Record verified, unverified, and blocked assumptions.
10. Decide integration order and POC gates.

**Exit gate:** Technical validation is complete; no integration is claimed without a POC. **Completed.**

## Phase 03 — Product and scope freeze

1. Freeze TypeScript/JavaScript projects as the v1 scope.
2. Freeze React, Next.js, Vite, Wagmi, Viem, and Ethers detection targets.
3. Freeze Foundry detection and Anvil local execution as the core path.
4. Keep Hardhat detection-only unless a tested need appears.
5. Freeze `rpc-blackout` as the first supported scenario.
6. Freeze the lifecycle and four result statuses.
7. Freeze CLI as local-first and Studio as minimal visualization/orchestration.
8. Freeze Anon-RPC as browser-only and Arkiv as connected-wallet Studio functionality.
9. Defer Python backend support and ENSv2 from the critical path.
10. Record measurable MVP acceptance criteria and change-control rules.

**Exit gate:** Scope, safety boundaries, integration order, and MVP acceptance criteria are explicit. **Completed.**

## Phase 04 — Minimal monorepo and architecture

1. Create the pnpm workspace root.
2. Create only the packages needed for the vertical slice.
3. Define shared Project, Dependency, Scenario, Experiment, and Result types.
4. Define the CLI-to-core boundary.
5. Define the Studio-to-local-agent boundary.
6. Define Node.js and browser execution adapter boundaries.
7. Define runner lifecycle, cancellation, and cleanup contracts.
8. Define evidence schema, redaction policy, and digest inputs.
9. Define integration interfaces for Anon-RPC and Arkiv.
10. Document the data flow and remove unnecessary package boundaries.

**Exit gate:** The architecture explains command/button → core → adapter/runner → evidence without hidden execution.

## Phase 05 — Toolchain and test skeleton

1. Configure pnpm workspace scripts.
2. Add strict TypeScript configuration.
3. Add formatter and linter.
4. Add the test runner.
5. Add build, typecheck, lint, and test scripts.
6. Add empty CLI and core entry points.
7. Add the minimal Studio shell boundary.
8. Add a sample domain unit test.
9. Add CI for install, lint, typecheck, and tests.
10. Verify all scripts from a clean install.

**Exit gate:** Clean install, build, typecheck, lint, and tests pass.

## Phase 06 — Domain model and safe inspector

1. Implement Project source and test-mode types.
2. Implement dependency nodes and edges with evidence provenance.
3. Detect package manager and manifest.
4. Detect React, Next.js, and Vite.
5. Detect Wagmi, Viem, and Ethers.
6. Detect Foundry and Hardhat configuration.
7. Parse non-secret chain and RPC references.
8. Redact environment values and sensitive strings.
9. Emit human-readable and stable JSON inspection output.
10. Test fixtures for each supported detection target.

**Exit gate:** Inspection is evidence-labelled and does not execute arbitrary repository scripts or leak secrets.

## Phase 07 — Sample dApp and local environment

1. Create the minimal TypeScript sample dApp.
2. Add a supported read-only chain operation.
3. Make the RPC endpoint configurable.
4. Add the Anvil start configuration.
5. Add a contract only if the read workload needs one.
6. Add a health/read probe.
7. Add sample startup and cleanup commands.
8. Keep the sample dependent on one RPC endpoint initially.
9. Verify baseline behavior against the local endpoint.
10. Document expected sample behavior and limitations.

**Exit gate:** The sample starts reproducibly and a baseline read workload succeeds.

## Phase 08 — Runner foundation

1. Implement `preflight`.
2. Implement `baseline`.
3. Implement `inject`, `observe`, `recover`, and `cleanup`.
4. Implement `evaluate` and `report` stages.
5. Add run IDs and scenario version metadata.
6. Add timeouts and cancellation.
7. Add child-process ownership and cleanup guarantees.
8. Add environment safety checks and loopback enforcement.
9. Persist redacted local evidence.
10. Test success, timeout, cancellation, and cleanup failure.

**Exit gate:** Lifecycle state, cancellation, timeout, cleanup, and safety
contracts are verified independently of UI. A no-op scenario orchestration
through every experiment phase remains part of the later runner/proxy work.

## Phase 09 — RPC proxy and rpc-blackout

1. Bind a local-only proxy to an ephemeral port.
2. Forward baseline JSON-RPC requests unchanged.
3. Restrict accepted targets to loopback.
4. Inject bounded timeout or connection failure.
5. Capture request IDs, timestamps, status, latency, and error categories.
6. Route the sample dApp through the proxy.
7. Capture baseline metrics.
8. Capture fault-phase application observations.
9. Restore forwarding and capture recovery checks.
10. Ensure proxy and local processes close in every exit path.

Phase 09 foundation status: the loopback proxy, bounded blackout window,
redacted proxy evidence, and runner cleanup integration are implemented and
tested. CLI orchestration, application-level baseline/recovery observations,
and evaluator work remain for Phase 10/11; no end-to-end CLI run is claimed by
this phase.

**Exit gate:** One repeatable local run demonstrates baseline, outage, restoration, and cleanup.

## Phase 10 — Evidence, evaluator, replay, and comparison

1. Finalize baseline, fault, and recovery measurement shapes.
2. Add deterministic assertions for the blackout scenario.
3. Implement `passed`, `failed`, `partial`, and `inconclusive`.
4. Add evidence digest generation.
5. Persist experiment definitions and results locally.
6. Implement replay after preflight validation.
7. Implement comparison for compatible scenario versions and environments.
8. Distinguish restoration from tested automatic failover.
9. Add JSON and Markdown reports.
10. Verify reproducibility from documented commands.

Phase 10 foundation status: versioned evidence normalization, deterministic
baseline/fault/recovery evaluation, metrics, local JSON persistence, replay
configuration, and compatible-run comparison are implemented. CLI commands,
report formatting, and end-to-end application observations remain for Phase 11;
this phase does not claim CLI orchestration.

**Exit gate:** The CLI can run, replay, compare, and report a truthful local scenario.

## Phase 11 — First-class CLI

1. Implement `blocklab init`.
2. Implement `blocklab inspect [--json]`.
3. Implement `blocklab scenarios`.
4. Implement `blocklab test rpc-blackout`.
5. Implement `blocklab replay <experiment-id>`.
6. Implement `blocklab compare <a> <b>`.
7. Implement `blocklab report <id> [--format json|md]`.
8. Add help and stable exit codes.
9. Require confirmation for authorized staging mode.
10. Verify the core workflow without Studio or a hosted account.

Phase 11 status: `inspect`, `scenarios`, `test rpc-blackout`, `runs`,
`report`, `replay`, `compare`, `config`, help/version output, stable exit
codes, local evidence storage, signal cancellation, and npm packaging metadata
are implemented. `blocklab init` and authorized staging confirmation remain
unimplemented.

**Exit gate:** The local CLI is independently useful and has actionable failure messages.

## ATTACK-01 — Deterministic RPC latency injection

The `rpc-latency` scenario is implemented on the existing loopback `RpcProxy`.
It accepts an explicit fixed `delayMs`, `startOffsetMs`, fault `durationMs`,
and overall `experimentDurationMs`. A request is delayed only when its start
timestamp is inside `[startOffsetMs, startOffsetMs + durationMs)`; the
interval is half-open, deterministic, and has no jitter. Delay timers are
abortable through proxy cleanup and do not forward cancelled requests.

The CLI command is:

```text
blocklab test rpc-latency --upstream <loopback-url> --delay <ms>
  [--start-offset <ms>] [--duration <ms>]
  [--experiment-duration <ms>] [--timeout <ms>]
```

Latency evidence records request/completion timestamps, injected state,
observed latency, phase metrics, cancellation/timeout terminal state, and
limitations. It proves proxy behavior and recovery forwarding only; it does
not prove dApp-level resilience. Replay and comparison remain local and
require an explicit loopback upstream.

**Status:** Complete and validated by runner, evidence, and CLI tests.

## ATTACK-02 through ATTACK-05 — Additional deterministic RPC fault patterns

The broader fault suite is implemented on the same loopback `RpcProxy` and
shared runner/evidence pipeline. The supported scenario IDs are:

- `rpc-intermittent-failure` — periodic failure windows with deterministic
  recovery intervals.
- `rpc-rate-limit` — strict request quota with `Retry-After` throttling.
- `rpc-connection-failure` — socket reset or premature close during a bounded
  fault window.
- `rpc-malformed-response` — invalid JSON and invalid JSON-RPC payloads during
  the configured fault interval.

Each variation keeps the same safety guarantees: loopback-only, read-only,
request/response validation, cancellation cleanup, and redacted evidence. The
proxy evidence records whether the fault was injected, which mode was active,
and how the request recovered. These scenarios prove the transport behavior of the
proxy; they do not prove application correctness or resilience by themselves.

**Status:** Complete and validated by runner, evidence, and CLI tests.

## Phase 12 — Anon-RPC browser POC

1. Use `@anon-rpc/browser-harness@0.4.0` in a browser-only fixture.
2. Start with the official passthrough worker.
3. Verify readiness, fetch, error, logging, and close behavior.
4. Connect an existing read-only bootstrap provider.
5. Test eligible read methods.
6. Implement the exact Viem transport adapter. *(Done in the ANON-03 follow-up:
`@blocklab/browser-rpc/viem` wraps both routes with Viem 2.57.16
`createTransport`, verified in a real browser on the `passthrough` and `tor-js`
workers.)*
7. Test a real anonymizing worker from official adopter data.
8. Compare direct and Anon-RPC workloads.
9. Record coverage, success rate, latency, and exclusions without raw payloads.
10. Make a go/no-go decision based on working default routing.

Phase 12 status: superseded by Phase 13. The verified harness lifecycle
(constructor, `ready`, `fetch`, `acceptLog`, `close`) now lives in
`@blocklab/browser-rpc`, so the POC contains no local harness code and no
harness tests of its own. Step 6 (Viem transport adapter) is still open and is
tracked as backlog item `ANON-03`.

**Exit gate:** Anon-RPC is either proven in the browser or explicitly excluded from sponsor claims.

## Phase 13 — Anon-RPC integration

1. Integrate the verified browser adapter into the sample dApp.
2. Make eligible reads use Anon-RPC by default.
3. Keep signing, transactions, bootstrap reads, and unsupported methods excluded.
4. Add route coverage indicators.
5. Define a repeatable read workload.
6. Measure direct and Anon-RPC latency and success rate.
7. Document the network-specific trust and privacy limitations.
8. Add the Studio comparison payload.
9. Keep the CLI explicit that the harness is browser-only.
10. Capture end-to-end evidence of default routing.

Phase 13 status: implemented. `@blocklab/browser-rpc` provides one interface with
two independent transports (`direct`, `anon-rpc`), a fixed read-only allowlist,
typed errors, lazy browser-only harness loading, explicit init/close, and a
stable `1.0` comparison payload. The sample dApp selects Anon-RPC by default,
keeps Direct RPC as an explicit control with no silent fallback, and exposes
method, route, timestamps, latency, success/failure, error category, worker
readiness, harness-routed count, and coverage. `scripts/browser-selftest.mjs`
verifies the browser path over CDP without an automation dependency.

Verified in headless Chrome 156 on 2026-11-05 against a public mainnet endpoint:
reference `passthrough` routed 4/4 (avg 941 ms vs 365 ms direct); the anonymizing
`tor-js` worker routed 4/4 (avg 2996 ms vs 376 ms direct); a deliberate
specifier/chain mismatch failed with `not-ready` on all attempts, 0% coverage,
and no direct fallback. `nym` and `nox` were not successfully exercised, and no
anonymity property is claimed or measured. The CLI states that the harness is
browser-only and never simulates it.

ANON-03 (Viem adapter), ANON-08 (read-only Studio comparison view), and ANON-09
(redacted comparison export) were completed afterwards as separate changes.

The Studio panel renders the
`RouteComparison` payload and the Viem probe results without executing any RPC
request itself: it validates untrusted input, recomputes coverage from the
attempts, keeps skipped methods distinct from successes, labels `passthrough` as
a non-anonymizing reference worker, and states that latency is not privacy.

The export downloads a validated
`blocklab.rpc-comparison` schema `1.0` artifact with a stable run id and an
explicit completeness label; it is built from the validated model, so raw
parameters, headers, accounts, storage, endpoint URLs, and unredacted error text
cannot reach it. A future Studio phase may add orchestration behind the
local-agent boundary, but the comparison panel stays read-only.

**Exit gate:** The supported browser demo routes eligible reads through Anon-RPC by default, or the feature is dropped.

## Phase 14 — Arkiv POC

1. Use `@arkiv-network/sdk@1.0.1` with Viem. (**done, verified 1.0.1 / viem 2.57.16**)
2. Configure Rabdi testnet and a documented access key. (**done** — chain id `7794095`/`0x76edaf` verified live; access key via `VITE_ARKIV_ACCESS_KEY`, git-ignored; `""` = public rate-limited endpoint.)
3. Use a dedicated testnet signer without source-code secrets. (**done** — signing stays in the browser wallet via EIP-1193; `try-write.mjs` uses an env-provided key only, and refuses to sign without a balance.)
4. Write one compact experiment entity. (**done, verified 2026-11-06** — exactly one real `createEntity` signed and mined: tx `0xed989cbe6d5b0aad7db1d03e0d7e16ff6865fb6f5a915d08c08f7bfa3c573f05`, block `269199`, entity `0x1d7b6bf841deab1a003cc7c1fa407b97e7e27fb6de276dc287b8e2e0551bb31a`, gas `0.000209105 tGLM`.)
5. Query it by indexed attributes. (**verified** — schema-tagged `arkiv_query` returns live `posts` entities and now also the published `blocklab.experiment` record by `experimentId`.)
6. Retrieve its payload and system metadata. (**verified** — the published entity was read back with `getEntity`; on-chain payload bytes are byte-identical to the canonical record and re-validate (603 bytes, SHA-256 `410e3d5c…38f4d`).)
7. Verify ownership and creator behavior from live results. (**partial** — the published entity has `owner == creator ==` the signing wallet; no two-wallet experiment, so no claim on transfer behaviour.)
8. Verify expiry behavior. (**partial** — the published entity reports `expiresAt` block `571599` == 7 days from creation per `expiryDays`; no observation of an entity actually expiring.)
9. Record transaction and explorer evidence. (**done** — explorer page 200; tx/entity recorded in `docs/arkiv-poc.md`.)
10. Decide the smallest user-facing history feature. (**deferred to Phase 15**; Studio integration now has a real write/query/retrieve run to gate on.)

**Exit gate:** A real write/query/retrieve flow succeeds, or Arkiv is excluded without mock claims. **Met (2026-11-06):** one real, confirmed, verified publication exists (see docs/arkiv-poc.md); the write/query/retrieve loop is proven end to end with the harness signer. Two deliberate follow-ups remain experiments (two-wallet ownership, waiting out an expiry), not blockers.

**Phase 14B status (2026-11-05):** unblocked and pre-verified. The signer was
rotated after an exposure report, funded with `5 tGLM` (on-chain transfer
verified), and an Arkiv access key is configured locally. `scripts/prepub-check.mjs`
runs all eight read-only gates (funding transaction + receipt, live balance,
key/address match, secret hygiene, access keys, authenticated RPC, duplicate
preflight for `poc-write-001`, funds coverage vs the SDK worst-case gas cap)
and reports 8/8 PASS with the signer holding `5 tGLM`. The write harness
`try-write.mjs` is idempotent (`poc-write-001`, live duplicate preflight
shared with the browser gateway, bounded transport, post-failure re-check
instead of blind re-signing). The publication is **done and verified**: with
approval, the harness signed exactly one real `createEntity`; the receipt is
mined, the entity reads back, every payload field matches, actual gas was
`0.000209105 tGLM`. Details and evidence: `docs/arkiv-poc.md`.

## Phase 15 — Arkiv experiment history

1. Define the compact experiment-definition schema.
2. Define result metadata and evidence-digest fields.
3. Set explicit expiry values.
4. Implement connected-wallet signing in Studio.
5. Implement entity writes with error handling.
6. Implement owner/scenario/status queries.
7. Implement retrieval and local replay validation.
8. Implement empty, expired, loading, and error states.
9. Keep detailed traces local.
10. Complete evidence and judging documentation from real results.

**Exit gate:** Users can save, query, retrieve, and safely replay an Arkiv-backed experiment definition.

**Status (2026-11-06): implemented in Studio; replay stays validated-only.**

1. **DONE** — the compact schema already existed in `@blocklab/arkiv-metadata`
   (schema `1.0`, closed allowlist); Studio reuses it as the only contract and
   writes canonical `metadataToPayloadBytes`.
2. **DONE** — result counts, `rpcFailureCount`, latency summary and
   `evidenceDigest` are part of the record; the digest is documented as a hash of
   local evidence, not a trust claim.
3. **DONE** — `expiryDays` is explicit (POC record: 7 days; the real entity's
   `expiresAt` block is recorded in docs/arkiv-poc.md). `MAX_LIFETIME_DAYS` caps
   it at 180.
4. **DONE** — Studio connects via EIP-1193, displays the account, detects the
   Rabdi chain id (`0x76edaf`) and refuses to publish on another chain; the
   wallet switch happens only on an explicit click, with no access key in the
   added chain config.
5. **DONE** — exactly one `createEntity` per approval: duplicate preflight before
   signing, confirmation only after a mined receipt, read-back byte comparison,
   distinct user-rejection/network/validation/unknown errors, and an uncertain
   outcome reported without re-signing.
6. **PARTIAL** — Studio queries the indexed `experimentId`, `scenarioName` and
   `status`. "Owner" is displayed on the record but is not a search field (the
   SDK filters supported by this schema are the indexed attributes).
7. **DONE for validation, not replay** — retrieved payloads are re-validated and
   must round-trip canonically before display; a record that fails is reported as
   malformed. Studio does not execute an experiment from a retrieved definition
   (that would need the runner and a local-agent boundary), so this item is
   recorded as validated retrieval rather than execution.
8. **DONE** — loading, empty (genuine zero results), failed, missing/expired,
   malformed, wrong-network and wallet-rejection states are separate and tested.
9. **DONE** — only the compact record is published; traces and evidence files stay
   local (enforced by the schema allowlist, the disclosure preview, and the
   credential-shape pre-sign check).
10. **DONE** — README, architecture, Studio docs, plan/backlog and
    docs/arkiv-poc.md describe the feature with its verified scope; ARK-05
    (two-wallet ownership) and ARK-06 (observed expiry) remain PARTIAL and are
    not claimed.

11. **DONE** — ARK-07 real-wallet publication. A real MetaMask approval published
    `studio-mm-001` from Studio on Rabdi and the result was independently read back
    and byte-compared: 11/11 checks, entity
    `0x9038f929ac92b25eb383fa6648290d631c18e5c9976a51fffc9f964adeecbcb7`, tx
    `0xef91a94a…5f2d9`, block `283822`, gas `0.000197983 tGLM`, byte-identical
    payload (493 bytes, SHA-256 `59c090b8…726a6`), `owner == creator == signer`,
    indexed retrieval by `experimentId`. No private key was pasted: the signature
    is the wallet's. Evidence and the `poc-write-001` distinction are in
    [docs/arkiv-ark07.md](docs/arkiv-ark07.md).

    The path itself was built earlier: a dedicated `studio-mm-001` probe record
    (`idle`, zero counts, fixed timestamp, digest of a documented note), a read-only
    live preflight (`preflight:test`), and a CDP driver
    (`apps/studio/scripts/studio-arkiv-live.mjs`) that refuses any provider whose
    `isMetaMask` is not true, checks gas before signing, re-runs the duplicate
    preflight, requires the pasted record to equal the canonical bytes, waits for
    the mined receipt and re-reads the entity from a separate process. `--check-only`
    rehearses every gate without signing, and verification is a shared module
    (`src/arkiv/verify-publication.ts`, 12 tests) with a standalone `verify:entity`
    CLI — validated live as a control against the existing `poc-write-001` entity
    (10/10 checks, byte-identical, gas reproduced). ARK-07 depends on ARK-06, which
    stays PARTIAL because no entity has been observed to actually expire.

    Two defects found and fixed on the way: provider refusals were classified as
    network failures (`8df5ee3`), and the driver crashed at exit
    `3221226505` while the success path never exited at all (`Stop` + `finally`
    lifecycle, this phase).

    ARK-05 (ownership transfer) was brought to implementation-ready without any
    broadcast: the transfer mechanism was pinned to the installed SDK
    (`OperationType.TransferOwnership = 4`, `changeOwnership`, owner-must-sign,
    no accept step) and Studio gained a gated preview → confirm → read-back flow
    plus an honest-uncertainty path that re-reads once and never auto-retries.
    ARK-05 is DONE: with explicit authorization, one `changeOwnership` moved the
    owner of `studio-mm-002` from A to B while `creator` stayed A, payload and
    expiry were unchanged, the `OwnershipTransferred` event decoded to
    `(entityKey, A, B)`, and A was then blocked from transferring again. Two
    defects were fixed on the way (case-sensitive address comparison, stale owner
    in the detail panel). Evidence: [docs/arkiv-ark05.md](docs/arkiv-ark05.md).

    ARK-06 (expiry) was then taken as far as investigation allows without a write.
    The protocol rules came from SDK source rather than inference: expiry is a pair
    of `uint64` **block** values resolved as `max(expiresAt, landingBlock +
    minLifetime)`, capped at 7 884 000 blocks, with no protocol minimum (1 block, ~2 s,
    is expressible), no way to shorten an expiry afterwards (`ExpiryNotExtended`), no
    expiry event, and a `null` from `arkiv_getEntity` for a dead key — so an expired
    entity is indistinguishable from a nonexistent one unless the read is timed
    against `$expiresAt`. The three existing entities are 6.6–7.0 days from their
    deadlines and cannot be shortened, so the plan is a single 5-block probe
    (`ark06-expiry-001`, harness signer, ~0.0002 tGLM, ~3 min) with a poller armed
    before the create and independent read-backs on both sides of the boundary;
    waiting out `poc-write-001` (6.6 days, zero gas) is the documented fallback. The
    same work lists four ARK-08 mismatches (no expired state, an unreachable
    `expired` reason, no re-read of an open panel, history rows silently vanishing).
    Design and success criteria: [docs/arkiv-ark06.md](docs/arkiv-ark06.md). ARK-06
    stays PARTIAL — nothing has expired yet.

    ARK-06B then built both sides without broadcasting: a `--expect-expired` mode for
    `verify:entity` that only passes on the documented missing result at/past the
    deadline, with the deadline taken from the `EntityCreated` event on `--tx` (or an
    explicit `--expires-at`), and distinct exit 5 for "the lookup could not be read"
    so a failed query can never be sold as an expiry — 19 unit tests. The probe
    (`ark06-expiry-001`, 5 blocks) is dry-run by default and cannot broadcast; under
    `--live` it predicts the key with `NO_SALT` before signing, arms the poller
    first, never retries a create (it reconciles through the entity nonce instead),
    and prints the independent verification command. Dry-run: 8/8 preflight,
    payload validated, poller exercised, verifier exercised across all nine branches
    including a real `EntityCreated` decode — nothing broadcast. See
    [docs/arkiv-ark06b.md](docs/arkiv-ark06b.md).

    It then ran: one authorized create of `ark06-expiry-001` at 5 blocks landed at
    block `289297` with `expiresAt` `289302` (= landing + 5), was observed live at
    `289299`/`289301` and was gone by head `289301`, while a second process verified
    `expected-expired` 7/7 exit 0 from the `EntityCreated` deadline. Gas
    `0.000177056 tGLM`; the three existing entities were re-read unchanged. The run
    **refuted** the plan's boundary assumption: an entity dies at `expiresAt − 1`, not
    at `expiresAt`, so ARK-08's "expires at block N" wording is one block optimistic
    and an expired key arrives as `missing`, indistinguishable from a typo. The
    poller's boundary print was also found one block optimistic; the verifier is the
    authority. ARK-06 is DONE.

Verification for this phase: 339 tests / 34 files, lint/typecheck/build clean, and
25/25 headless-Chrome checks with a labelled mock wallet (wiring and gating only —
the publication claim rests on the read-back above, never on a mock run).

## Phase 16 — ENSv2 conditional gate

1. Recheck current official prize requirements.
2. Recheck current eligible network and deployment addresses.
3. Recheck official ABI/library sources.
4. Estimate wallet, gas, and namespace setup time.
5. Decide whether ENS is central to a real BLOCKLAB action.
6. Prototype registration only if all core gates pass.
7. Prototype real grant and revoke only if safe.
8. Verify on-chain rejection after revocation.
9. Capture transaction evidence if complete.
10. Drop ENS claims and UI if any gate is incomplete.

**Exit gate:** ENSv2 is included only with a real central grant/revoke workflow; otherwise it remains deferred.

## Phase 17 — Minimal Studio

1. Build Projects, Experiments, History, and Settings navigation.
2. Build local/GitHub/URL import with mode labels.
3. Build project overview and limitations.
4. Build the evidence-labelled dependency graph.
5. Build experiment preflight and safety confirmation.
6. Connect the local agent boundary for project and process control.
7. Stream actual runner events to the timeline.
8. Show results, evidence, replay, and compare.
9. Add Arkiv history only after the real integration gate.
10. Add Anon-RPC comparison only after its browser gate.

**Exit gate:** A first-time user understands import → inspect → test → recover → report without a dashboard overload.

### UI-08 status (2026-11-06)

The complete Studio audit and redesign blueprint are documented in:

- [docs/ui-08-studio-audit.md](docs/ui-08-studio-audit.md)
- [docs/ui-08-redesign-spec.md](docs/ui-08-redesign-spec.md)
- [docs/ui-08-hybrid-architecture.md](docs/ui-08-hybrid-architecture.md)
- [docs/ui-08-attack-catalogue.md](docs/ui-08-attack-catalogue.md)

The audit confirms that the current Studio is a functional Arkiv history and
RPC comparison surface, not yet the Phase 17 product shell. No UI rewrite or
local-agent bridge was started in UI-08.

### UI-09 status (2026-11-06)

The Studio now has a route-aware dark application shell, responsive sidebar
navigation, shared visual tokens, accessible status indicators, an honest
Overview page, and an Evidence Vault route containing the existing Arkiv and
comparison surfaces. Projects, Attack Lab, Experiments, Network Intelligence,
and Settings are intentionally marked unavailable until their safety boundaries
and data contracts are implemented. No Local Agent was added.

### UI-10 + DEPLOY-01 status (2026-11-06)

The inspect-only Local Agent MVP and Projects workflow are implemented and
documented in:

- [docs/deploy-01-local-agent.md](docs/deploy-01-local-agent.md)
- [docs/ui-10-project-workflow.md](docs/ui-10-project-workflow.md)

The agent binds to loopback, uses strict browser Origin validation, short-lived
in-memory pairing/session credentials, explicit startup directory authorization,
revocation, and the existing safe inspector. Studio renders actual connection,
project, and inspection state. Arbitrary command execution, process control,
GitHub import, cloud runners, and experiment execution remain deferred.

## Phase 18 — Hardening and security review

1. Run all flows from a clean checkout.
2. Test cleanup after success, failure, timeout, and cancellation.
3. Test emergency stop.
4. Test malformed project/config input.
5. Test secret and identifier redaction.
6. Test loopback and staging authorization enforcement.
7. Verify no arbitrary imported scripts run without approval.
8. Verify no client trackers or sensitive Arkiv payloads.
9. Perform a focused security review of trust boundaries.
10. Fix only high-impact issues and freeze features.

**Exit gate:** No known critical safety, cleanup, secret-leak, or data-loss issue remains on the demo path.

## Phase 19 — Documentation and demo evidence

1. Write README setup and quick start.
2. Document architecture, supported stacks, and limitations.
3. Document safety and data handling.
4. Add license and AI-use disclosure.
5. Document exact RPC blackout commands and expected evidence.
6. Document verified Anon-RPC routing and exclusions if selected.
7. Complete Arkiv schema and judging documents if selected.
8. Remove unsupported ENS or sponsor claims.
9. Run the README from a fresh environment.
10. Record the demo script and required video evidence.

**Exit gate:** A fresh user and judge can reproduce the core workflow and verify every claimed integration.

## Phase 20 — Final submission and contingency

1. Recheck the official deadline and timezone.
2. Recheck selected sponsor tracks against working code.
3. Verify repository visibility, license, and clean install.
4. Verify CLI local workflow.
5. Verify RPC blackout evidence and reports.
6. Verify Anon-RPC default-routing evidence if selected.
7. Verify Arkiv writer, query, ownership, and expiry evidence if selected.
8. Confirm ENS is omitted unless genuinely complete.
9. Submit with a time buffer.
10. Save confirmation and final commit reference.

**Exit gate:** Submission is complete before the confirmed deadline, with a fallback recording if needed.

## Critical cut line

Preserve in this order:

- Local CLI, sample dApp, RPC blackout, evidence, replay, and comparison.
- Anon-RPC browser POC and default routing.
- Arkiv write/query/retrieve and history.
- Minimal Studio.
- ENSv2 only if already proven.
- Additional scenarios, broad imports, Swarm, and polish.
