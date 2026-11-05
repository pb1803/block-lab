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
4. Write one compact experiment entity. (**partially blocked** — code complete (`createEntity` after a duplicate preflight and a checkbox), but no real write: zero tGLM, faucet needs a browser wallet, anonymous `arkiv_query` budget exhausted. Nothing was signed.)
5. Query it by indexed attributes. (**verified read-only** — schema-tagged `arkiv_query` returns live `posts` entities; the `blocklab.experiment` schema and sample record validate.)
6. Retrieve its payload and system metadata. (**verified on public entities** — `getEntity` returns key + owner/creator/expiresAt; strict payload decode covered by tests.)
7. Verify ownership and creator behavior from live results. (**partial** — observed as `owner == creator` on public `posts`; no two-wallet experiment, so no claim made.)
8. Verify expiry behavior. (**not experimentally verified** — SDK semantics read (`fromDays`, max cap, `max(expiresAt, currentBlock + minLifetime)`); needs a real write + wait.)
9. Record transaction and explorer evidence. (**not done** — requires the blocked write.)
10. Decide the smallest user-facing history feature. (**deferred to Phase 15**; Studio integration stays gated on a real write/query/retrieve run.)

**Exit gate:** A real write/query/retrieve flow succeeds, or Arkiv is excluded without mock claims. **Not met cleanly:** the POC is verified live read-only, the write path is verified only up to a rejected wallet signature (mock wallet), and the real write is blocked by infrastructure (faucet + no funds + exhausted anonymous budget). Arkiv stays out of Studio until a real run exists; the write is not excluded, because the only missing pieces are external (testnet funds/access key).

**Phase 14B status (2026-11-05):** unblocking. A dedicated signer
(`0x9Ff86Ef02CC6857e7F6942f58Ec78B8380ADe74A`) is prepared in the git-ignored
`apps/arkiv-poc/.env.local`; the write harness is now idempotent
(`poc-write-001`, live duplicate preflight shared with the browser gateway,
bounded transport, post-failure re-check instead of blind re-signing) and was
run against the real chain — it correctly reported `0 tGLM` and exited code 2
without signing. The official faucet (wallet session + captcha, 24 h cooldown)
and access-key flow (wallet sign-in + captcha) were verified from the Hub UI
and the docs; both are human steps. A real write/query/retrieve completes once
the faucet funds the signer and the access key is set; no mock claim stands in
for it.

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
