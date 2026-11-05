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
| ANON-01 | P1 | Add browser POC fixture | CLI-09 | `@anon-rpc/browser-harness@0.4.0` is used only in a browser | TODO |
| ANON-02 | P1 | Verify worker lifecycle and errors | ANON-01 | Ready, fetch, close, and failure paths are observed | TODO |
| ANON-03 | P1 | Verify Viem adapter | ANON-02 | Exact type-safe adapter is proven by a working read | TODO |
| ANON-04 | P1 | Verify real anonymizing worker | ANON-03 | Official worker performs an eligible read successfully | TODO |
| ANON-05 | P1 | Measure direct versus Anon-RPC | ANON-04 | Coverage, success rate, latency, and exclusions are recorded | TODO |
| ANON-06 | P1 | Route eligible demo reads by default | ANON-05 | Browser demo default path uses Anon-RPC for supported reads | TODO |
| ANON-07 | P1 | Add privacy comparison reporting | ANON-06 | Measured facts and documented limitations are separated | TODO |
| ANON-08 | P1 | Add Studio Anon-RPC view | ANON-07 | UI displays route coverage and comparison without anonymity overclaims | TODO |
| ANON-09 | P1 | Add end-to-end sponsor evidence | ANON-06 | Evidence proves actual default routing and app behavior | TODO |
| ANON-10 | P2 | Keep CLI boundary explicit | ANON-01 | CLI reports browser-only limitation and never simulates the harness | TODO |

## Arkiv primary integration

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| ARK-01 | P1 | Add Arkiv POC fixture | CLI-09 | `@arkiv-network/sdk@1.0.1` and Viem are used with Rabdi | TODO |
| ARK-02 | P1 | Configure access and signer safely | ARK-01 | No private key is in source; signer is testnet-only/connected | TODO |
| ARK-03 | P1 | Write compact experiment entity | ARK-02 | Real entity write returns verifiable transaction/entity data | TODO |
| ARK-04 | P1 | Query and retrieve entity | ARK-03 | Indexed scenario/status query returns expected payload | TODO |
| ARK-05 | P1 | Verify owner and creator semantics | ARK-04 | Live result records observed ownership behavior | TODO |
| ARK-06 | P1 | Verify expiry | ARK-04 | Expiry configuration and observed behavior are documented | TODO |
| ARK-07 | P1 | Implement connected-wallet Studio write | ARK-06 | User signs without pasting a private key | TODO |
| ARK-08 | P1 | Implement Arkiv history query/retrieve | ARK-07 | Studio displays loading, empty, error, expired, and success states | TODO |
| ARK-09 | P1 | Implement validated local replay | ARK-08; CLI-05 | Retrieved definitions are validated before local execution | TODO |
| ARK-10 | P1 | Complete evidence documentation | ARK-09 | Schema, friction, reach, rationale, and usage docs contain real evidence | TODO |

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
| UI-06 | P1 | Add Arkiv history view | ARK-08; UI-01 | Records are read from Arkiv, not mocked | TODO |
| UI-07 | P1 | Add Anon-RPC comparison view | ANON-08; UI-01 | Browser measurements and exclusions are visible | TODO |
| SAFE-01 | P0 | Test redaction and local evidence | RUN-09 | Secrets, cookies, wallet identifiers, and raw payloads are absent | TODO |
| SAFE-02 | P0 | Test cleanup and cancellation | RUN-02; DEMO-05 | No orphaned process/proxy remains | TODO |
| SAFE-03 | P0 | Security review trust boundaries | SAFE-01; SAFE-02 | High-impact findings are fixed or explicitly documented | TODO |

## Submission

| ID | Priority | Task | Dependencies | Acceptance criteria | Status |
|---|---|---|---|---|---|
| SUB-01 | P0 | Complete README and setup | CLI-09; UI-05 | Fresh user reproduces the core demo | TODO |
| SUB-02 | P0 | Add license and AI disclosure | SUB-01 | Repository disclosures are accurate | TODO |
| SUB-03 | P0 | Verify sponsor claims | ANON-09; ARK-10 | Only working integrations are claimed | TODO |
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
