# BLOCKLAB — Product Requirements Document

**Document status:** Scope-frozen MVP v1.1 — implementation may begin after the gates in `plan.md`  
**Project type:** New ETHGlobal Mumbai 2026 project  
**Target build:** TypeScript / JavaScript Ethereum dApps  
**Primary interfaces:** BLOCKLAB Studio (web) and BLOCKLAB CLI (local)  
**Target submission deadline:** 7 November 2026, 09:00 IST (confirm against the live ETHGlobal submission page before final submission)

---

## 1. Executive summary

BLOCKLAB is an Ethereum dApp resilience and RPC-privacy testing platform. It helps developers understand the dependencies their application relies on, run controlled experiments against an isolated or explicitly authorized environment, observe failure propagation, compare recovery behaviour, and retain reproducible experiment evidence.

BLOCKLAB has two interfaces backed by one shared engine:

- **Studio:** a clean, minimal web application for project onboarding, architecture inspection, experiment configuration, live observation, and result comparison.
- **CLI:** a first-class local developer tool for initializing a project, inspecting it, running experiments, replaying runs, and generating reports without requiring Studio.

The first compelling workflow is to inspect a TypeScript Ethereum dApp, route its test RPC traffic through a loopback-only controlled proxy, inject an RPC failure, observe the application degrade, restore service, and replay the same experiment. Restoration after an outage is not automatic failover; BLOCKLAB must not claim failover unless a secondary endpoint is explicitly configured and tested.

Anon-RPC is a browser-only primary integration for eligible read requests. Arkiv provides user-owned, queryable, expiring experiment definitions and compact result metadata through connected-wallet signing in Studio. The CLI must not pretend to use the browser-only Anon-RPC harness and must remain useful without a hosted account. ENSv2 is outside the MVP critical path and may be reconsidered only after the core experience and primary integrations work.

## 2. Problem statement

Ethereum dApps depend on multiple components: browser frontend, wallet, RPC providers, smart contracts, resolvers, indexers, APIs and deployment infrastructure. Developers often test the happy path but do not systematically verify what happens when one of these dependencies becomes slow, unavailable, privacy-invasive, or permission-restricted.

Existing monitoring may show that a request failed, but it often does not give a developer a reproducible, application-level experiment that connects:

1. a known project and its detected dependencies;
2. a controlled fault with explicit scope and preconditions;
3. observed application behaviour and captured evidence;
4. a measurable recovery result; and
5. a replayable report that can be shared and independently checked.

BLOCKLAB addresses this gap for an intentionally narrow first set of JavaScript/TypeScript Ethereum projects.

## 3. Product vision and positioning

**Tagline:** Break your dApp before the real world does.

**Positioning:** A developer-first experiment workbench for Ethereum dApp resilience and RPC privacy—not a universal vulnerability scanner, exploit framework, or generic monitoring dashboard.

**Product principles:**

- Evidence over unsupported vulnerability scores.
- Safe, scoped experiments over arbitrary live-target attacks.
- Local-first CLI; Studio is an additional interface, not a requirement.
- One shared engine for CLI and Studio.
- Clear disclosure of what was observed, inferred, or not inspected.
- Minimal UI with progressive disclosure.
- Integrations must create user-visible value and satisfy the relevant track's actual requirements.

## 4. Goals

### 4.1 Hackathon MVP goals

1. Inspect a supported JavaScript/TypeScript Ethereum dApp and report detected capabilities and limitations.
2. Produce a dependency graph from evidence available in the source/configuration and runtime instrumentation.
3. Run at least one end-to-end, reproducible RPC failure experiment in an isolated local environment.
4. Capture baseline, fault, application observations, recovery and a structured result.
5. Replay and compare experiments using the same scenario definition.
6. Provide a usable CLI for the primary workflow.
7. Provide a clean Studio flow that makes the experiment understandable and visually compelling.
8. Run an Anon-RPC browser proof of concept, and only claim the integration if eligible reads route through the official harness by default.
9. Run an Arkiv proof of concept, then write and query compact experiment records through a user-facing connected-wallet workflow.
10. Produce a reproducible repository, setup instructions, demo, and evidence for only completed integrations.

### 4.2 Post-hackathon direction

- Additional scenario adapters and project frameworks.
- Python backend inspection and controlled API failure testing.
- More Ethereum networks and wallet integrations.
- CI integration and team workspaces.
- More advanced evidence signing and export formats.

## 5. Non-goals for the hackathon MVP

- A universal scanner for every GitHub repository or every blockchain.
- Exploiting arbitrary public dApps or injecting faults into third-party production infrastructure.
- Testing a live URL beyond explicitly authorized, externally observable checks.
- Private backend source inspection from a public URL alone.
- Automatic remediation or autonomous code changes.
- A full vulnerability database, CVE scanner, or AI-generated security verdict.
- Python backend support in v1.
- Production-grade multi-tenant SaaS, billing, teams, or enterprise RBAC.
- A large collection of half-working attack scenarios.
- ENSv2 integration unless its technical spike passes and it remains central to the user workflow.

## 6. Target users and jobs-to-be-done

### Primary: Ethereum dApp developer

Needs to test whether their application continues to behave safely when RPC or another dependency fails. Wants a local command, clear evidence and a repeatable regression test.

### Secondary: Web3 security / reliability engineer

Needs to reproduce dependency failures, compare configurations and share evidence with the development team.

### Tertiary: Hackathon judge / evaluator

Needs to understand the product quickly, run the demo, inspect real integration code and verify that sponsor technology is meaningfully used.

## 7. Supported project scope

### In scope for v1

- JavaScript and TypeScript repositories.
- React, Next.js and Vite frontends.
- Wagmi, Viem and Ethers integrations where detectable/testable.
- Solidity projects using Foundry or Hardhat where local contract testing is needed.
- Ethereum-compatible local development networks, with Anvil as the preferred local EVM for the MVP.
- Local project directories and explicitly authorized staging deployments.
- Public GitHub source import as a convenience, subject to license, environment and runtime compatibility.
- Public URL external observation mode with clearly limited claims.
- Hardhat configuration detection; Hardhat execution support is not required for the first scenario.

### Out of scope for v1

- Python backend instrumentation (planned future adapter).
- Automatic testing of arbitrary production URLs.
- Mainnet transactions or destructive actions.
- Automated wallet signing or access to user private keys.
- Python backend inspection and instrumentation.
- ENSv2 in the MVP critical path.

## 8. Product modes and inspection truthfulness

BLOCKLAB must distinguish three modes in the UI and reports:

1. **Local deep test:** source and local runtime are available; controlled adapters can inject faults into the test environment.
2. **Authorized staging test:** a user explicitly confirms ownership/authorization and supplies a supported test environment. Scope and safeguards must be explicit.
3. **External observation:** only externally observable browser/HTTP behaviour is checked. It cannot claim to know private source, private backend topology, hidden RPC configuration, secrets, or full contract permissions.

A URL-only scan must never be presented as a full source audit. Every finding must include its evidence source and confidence/coverage limitations.

## 9. Core user journeys

### Journey A — Local CLI resilience test

1. Developer opens a supported project.
2. Runs `npx blocklab init`.
3. Reviews and confirms detected project metadata.
4. Runs `npx blocklab inspect`.
5. Reviews dependency graph and inspection limitations.
6. Runs `npx blocklab test rpc-blackout`.
7. BLOCKLAB validates the local environment and starts an isolated runner/proxy.
8. Baseline requests are measured; controlled RPC failure is injected.
9. Application observations and request traces are collected.
10. The runner restores state and cleans up.
11. Developer reviews result and applies a fallback configuration.
12. Developer replays the experiment and compares results.

### Journey B — Studio project and experiment

1. Developer imports a local project or a GitHub repository they are authorized to test.
2. Studio shows what was detected and what could not be inspected.
3. Developer opens the architecture map and selects an eligible dependency.
4. Developer chooses a scenario and reviews its scope/preconditions.
5. Developer starts the isolated experiment.
6. The graph and event timeline update from actual runner events.
7. Developer stops or completes the test, reviews evidence and replays it.

### Journey C — Anon-RPC privacy comparison (conditional target track)

1. Supported browser dApp uses the official Anon-RPC browser harness for eligible RPC reads by default.
2. BLOCKLAB runs a defined read workload.
3. It captures only permitted, non-sensitive measurement metadata.
4. It compares the conventional route and Anon-RPC route for latency, success rate, request coverage and observable metadata exposure.
5. UI clearly separates measured performance from privacy claims; no unsupported claim of perfect anonymity.
6. Studio can reproduce the comparison; the CLI reports that this browser-only integration is unavailable rather than simulating it.

### Journey D — Arkiv experiment registry

1. User connects a wallet in Studio using the documented Rabdi testnet flow.
2. BLOCKLAB writes an experiment definition or compact result metadata entity to the current Arkiv Rabdi testnet.
3. Entity ownership, indexed fields and expiry are explicit.
4. User queries and retrieves their experiments through a visible Studio feature.
5. User can replay an experiment definition from the retrieved record, after local validation.
6. README documents writer wallet(s), a runnable query and the schema.

### Journey E — ENSv2 project identity (conditional)

1. Project owner creates/uses an ENSv2 namespace on an eligible network.
2. Owner grants a narrowly scoped role to a tester.
3. Tester performs an allowed project action.
4. Owner revokes the role.
5. The same action is rejected by the real ENSv2 permission check.
6. UI and documentation show onchain transaction evidence.

## 10. Functional requirements

### FR-01 Project onboarding

- Accept local project path through CLI.
- Accept GitHub URL through Studio/CLI only where clone/read access is available and permitted.
- Accept public URL for external observation mode only.
- Require explicit mode selection and display the mode in project metadata.
- Validate URL/path and report actionable errors.

### FR-02 Project inspection

- Detect package manager and manifest/lockfile.
- Detect React/Next.js/Vite where possible.
- Detect Wagmi/Viem/Ethers dependencies and relevant config references.
- Detect Foundry/Hardhat configuration and Solidity sources.
- Detect chain IDs, contract addresses and RPC configuration only when present in inspected files or runtime evidence.
- Never print or persist secret environment values.
- Output machine-readable JSON and a human-readable summary.

### FR-03 Dependency model

- Represent components and directed dependency edges.
- Attach evidence source and confidence to each node/edge.
- Distinguish detected, inferred and user-declared dependencies.
- Permit manual correction where detection is incomplete.

### FR-04 Experiment lifecycle

- Validate scenario preconditions.
- Require safe target/environment confirmation.
- Capture baseline before injection.
- Inject one controlled fault at a time for MVP.
- Collect timestamped observations.
- Restore/tear down in a `finally`-style cleanup path.
- Mark incomplete or unsafe runs honestly.

### FR-05 MVP scenario: RPC blackout

- Route test traffic through a BLOCKLAB-controlled local proxy/adapter.
- Support timeout or connection failure first; HTTP error and latency injection are optional extensions.
- Measure request count, success/failure, latency and recovery.
- Verify application-level behaviour through a sample dApp test/health probe.
- Do not alter the user's real production endpoint or wallet state.
- Distinguish outage restoration from automatic failover; failover requires a tested secondary endpoint.

### FR-06 RPC privacy comparison (conditional Anon-RPC track)

- Integrate `@anon-rpc/browser-harness` in the browser only; do not invent a substitute protocol.
- Route the supported dApp's RPC reads through Anon-RPC by default in the demo.
- Define exactly which methods/traffic are routed and which are intentionally excluded.
- Measure performance and coverage; explain the privacy model and limitations.
- Do not log wallet addresses, query contents or other sensitive identifiers unnecessarily.

### FR-07 Evidence and evaluation

- Store structured experiment ID, scenario ID/version, timestamps, environment type, measurements, observations, cleanup status and evidence digest.
- Use deterministic rules for pass/fail/partial/inconclusive.
- Avoid a single arbitrary “vulnerability percentage”.
- Include reproduction steps and remediation suggestions clearly labelled as suggestions.

### FR-08 Replay and comparison

- Replay a scenario from a stored definition after validating current environment and permissions.
- Compare two runs using same scenario version and comparable environment metadata.
- Show differences in success rate, latency and recovery behaviour.
- Record whether recovery was restoration or tested failover.

### FR-09 CLI

Initial command contract:

```bash
npx blocklab init
npx blocklab inspect [--json]
npx blocklab scenarios
npx blocklab test rpc-blackout [--config <path>]
npx blocklab replay <experiment-id>
npx blocklab compare <experiment-a> <experiment-b>
npx blocklab report <experiment-id> [--format json|md]
```

- Commands have help text, stable exit codes and actionable errors.
- Destructive or externally directed tests require explicit confirmation and are not enabled by default.
- Local use must not require a hosted BLOCKLAB account.
- The CLI does not invoke the browser-only Anon-RPC harness.

### FR-10 Studio

- Project list/detail.
- Project inspection summary.
- Interactive but uncluttered dependency map.
- Scenario selection and preflight panel.
- Live event timeline and experiment status.
- Result details and run comparison.
- Arkiv experiment registry view if integration is complete.
- ENS identity/permission view only if integration is complete.

### FR-11 Arkiv integration (target track)

- Use Rabdi testnet and `@arkiv-network/sdk@1.0.1` with Viem.
- Define entities, ownership, queried fields and expiry in `/arkiv/schema.md`.
- Write real entities and read them through a user-visible feature.
- Include writer wallet address(es) and one reproducible query in README.
- Complete `/arkiv/friction.md`, `/arkiv/reach.md`, `/arkiv/why-arkiv.md`, `/arkiv/how-you-use-arkiv.md`.
- Never store secrets, private keys, raw sensitive logs or unencrypted confidential references in public entities.
- Studio signing uses a connected wallet; users must never paste private keys into BLOCKLAB.

### FR-12 ENSv2 integration (conditional)

- Use actual ENSv2 contracts/libraries on an eligible network (confirm current prize wording; current page says mainnet or Sepolia).
- Use a real hierarchical registry/namespace and actual Enhanced Access Control or relevant ENSv2 permission feature.
- Demonstrate grant and revocation in a functional flow.
- No hard-coded permission simulation presented as ENSv2.
- Drop this integration if the technical spike cannot be completed reliably before feature freeze.

### FR-13 Documentation and submission

- Public repository and approved open-source licence.
- README with setup, architecture, limitations, demo, sponsor integration evidence and AI-use disclosure.
- Track-specific files and links.
- Demo video requirements checked against the final selected track(s).
- Submission form completed before the official deadline.

## 11. Non-functional requirements

### Safety and authorization

- Default to local isolated targets.
- Never run active tests against a third-party production URL without explicit authorization and a bounded scope.
- No private-key collection or signing.
- No mainnet state changes.
- Apply request/time/rate limits to test adapters.
- Clean up processes, containers, proxies and temporary files even after failures.
- Provide a visible emergency stop for active experiments.

### Privacy and security

- Redact environment secrets, tokens, cookies, authorization headers and wallet identifiers from logs by default.
- Keep detailed traces local unless the user explicitly exports them.
- Store only minimal metadata on Arkiv; entities are public/queryable according to network semantics.
- No third-party client trackers/analytics for EF CROPS eligibility.
- Validate imported repository commands; never execute arbitrary repository scripts without explicit user approval and sandboxing.

### Reliability

- Scenario runner must have deterministic setup/teardown.
- An experiment must be marked inconclusive if baseline or cleanup fails.
- Every result records scenario version and tool version.
- UI must distinguish live measurements from illustrative/demo data.

### Usability

- Primary experiment discoverable in three actions or fewer after project import.
- Minimal navigation and progressive disclosure.
- Clear labels; avoid arbitrary risk scores.
- CLI commands must be self-documenting and work without Studio.

## 12. High-level architecture

```text
                 +-----------------------+
                 |       Studio          |
                 | projects / graph / UI |
                 +-----------+-----------+
                             |
                 +-----------v-----------+
                 |   Application API     |
                 | auth / orchestration  |
                 +-----------+-----------+
                             |
+----------------+  +--------v---------+  +------------------+
|      CLI       +->| Shared Core API  |<-+      SDK         |
+----------------+  +--------+---------+  +------------------+
                             |
          +------------------+-------------------+
          |                  |                   |
+---------v--------+ +-------v--------+ +--------v---------+
| Project Inspector| | Experiment     | | Evidence &       |
| manifests/config | | Runner         | | Evaluator        |
+------------------+ +-------+--------+ +------------------+
                             |
                 +-----------v------------+
                 | Scenario + Adapters    |
                 | RPC proxy / local EVM  |
                 +-----------+------------+
                             |
                 +-----------v------------+
                 | Local dApp / test env  |
                 +------------------------+

Optional integrations: Anon-RPC browser harness, Arkiv testnet,
ENSv2 network contracts (conditional).
```

### Suggested monorepo shape

```text
blocklab/
├── apps/
│   └── studio/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── inspector/
│   ├── runner/
│   ├── proxy/
│   ├── scenarios/
│   ├── evidence/
│   ├── evaluator/
│   ├── sdk/
│   └── integrations/
│       ├── anon-rpc/
│       ├── arkiv/
│       └── ensv2/             # conditional
├── examples/
│   └── sample-dapp/
├── docs/
├── arkiv/
└── README.md
```

The exact package boundaries may be simplified during implementation. Avoid creating packages before a working vertical slice proves they are needed.

## 13. Data model (initial)

### Project

- `projectId`
- `name`
- `sourceType`: `local | github | url`
- `testMode`: `local | authorized-staging | external-observation`
- `detectedStack[]`
- `dependencies[]`
- `createdAt`

### Dependency node

- `nodeId`, `type`, `label`
- `evidenceSource`
- `confidence`: `detected | inferred | user-declared`
- `metadata` (redacted; no secrets)

### Experiment definition

- `experimentId`
- `projectId`
- `scenarioId`, `scenarioVersion`
- `targetDependencyId`
- `parameters` (validated and non-secret)
- `createdBy`
- `expiresAt` (where stored on Arkiv)

### Experiment result

- `runId`, `experimentId`
- `startedAt`, `finishedAt`
- `environmentFingerprint` (non-sensitive)
- `baselineMetrics`
- `faultMetrics`
- `recoveryMetrics`
- `observations[]`
- `status`: `passed | failed | partial | inconclusive`
- `cleanupStatus`
- `evidenceDigest`

Detailed logs remain local by default. Arkiv stores only the fields required for user-visible discovery, ownership, replay and judging evidence.

## 14. Evaluation model

BLOCKLAB evaluates a specific scenario, not the entire security of an application.

For RPC blackout, possible checks include:

- Did baseline requests succeed?
- Did the proxy inject the intended fault?
- Did the application fail, degrade safely, or use a fallback?
- Did the app recover after restoration/failover?
- Did cleanup complete?

Result meanings:

- **Passed:** the defined resilience expectation was met.
- **Failed:** the test ran correctly and the expected resilience behaviour was not met.
- **Partial:** some expected behaviour worked, but one or more checks failed.
- **Inconclusive:** preconditions, instrumentation or cleanup were insufficient to support a conclusion.

No result should claim “the project is secure” or “the project is X% vulnerable”.

## 14.1 MVP acceptance criteria

The MVP is accepted only when all of the following are true:

1. `blocklab inspect` safely inspects the included sample and emits human-readable and JSON output.
2. The sample dApp runs against an explicitly configured local endpoint.
3. `rpc-blackout` executes `preflight → baseline → inject → observe → recover → cleanup → evaluate → report`.
4. The run records request counts, success/failure counts, latency, fault interval, error categories, recovery checks, cleanup status, and an evidence digest.
5. Results use only `passed`, `failed`, `partial`, or `inconclusive`, with deterministic checks.
6. Replay validates the environment and scenario version before execution; compare rejects incompatible runs.
7. Fault injection is loopback-only by default and never changes production endpoints or wallet state.
8. The CLI runs the core workflow without Studio or a hosted account.
9. Anon-RPC is accepted only after a browser POC proves default eligible-read routing and reports coverage, success rate, and latency without claiming complete anonymity.
10. Arkiv is accepted only after a real Rabdi write/query/retrieve flow demonstrates ownership and expiry using connected-wallet signing.

## 15. Success metrics

### Product metrics

- A developer can initialize and inspect the sample project using CLI.
- The primary RPC blackout experiment completes end to end and produces reproducible evidence.
- The same scenario can be replayed and compared after a configuration change.
- Studio visualizes actual runner events, not fabricated animation.
- A fresh user can follow the README and reproduce the main demo.

### Anon-RPC track metrics (if selected)

- Supported demo app routes RPC reads through the official Anon-RPC harness by default.
- Coverage of eligible RPC reads is measured and disclosed.
- A comparison is reproducible, and performance/privacy trade-offs are documented.

### Arkiv track metrics (if selected)

- Real testnet entity write succeeds.
- A visible feature queries and renders stored entities.
- Ownership, filters and expiry match the product's use case.
- README includes writer wallet and reproducible query.
- All required judging files are present and specific.

### ENSv2 (if selected)

- Actual ENSv2 namespace/registry flow works on eligible network.
- Permission grant and revocation are onchain and observable.
- The product meaningfully depends on the ENSv2 permission/identity model.

## 16. Sponsor strategy and decision gates

### Primary target A — Ethereum Foundation: Best Use of Anon-RPC

Official prize requirements currently state that an application must route its RPC reads through Anon-RPC by default. The judging page calls out end-to-end functionality, UX, share of traffic routed through Anon-RPC, ship-readiness and technical depth. BLOCKLAB's privacy comparison/playground is a direct fit if the official browser harness can be integrated correctly.

**Gate:** do not claim eligibility until the official harness works in the supported demo app and the default read path is demonstrably routed through it.

### Primary target B — Arkiv: Build on Arkiv From Scratch

A natural fit for user-owned, queryable, expiring experiment definitions and result references. A visible query/replay feature must read from Arkiv. Arkiv used only as a log is insufficient.

**Gate:** do not claim eligibility until a real write and user-facing read/query work against the current Arkiv testnet and all required documentation files exist.

### Conditional target C — ENS: Best Use of ENSv2

Potential fit for project namespaces and delegated/revocable experiment permissions. ENSv2 must be central and functional, not cosmetic.

**Gate:** include only if real network deployment/interaction and grant/revoke demo are completed before feature freeze without jeopardizing the two primary integrations and core MVP.

### Alternative target — Ethereum Foundation: Best CROPS App

Potentially relevant if BLOCKLAB's lead property becomes a structurally privacy-preserving or dependency-independent tool. Do not select it merely because the product is security-related. EF awards at most one prize per project, and the Anon-RPC track is the more direct target for the current product.

### Optional Arkiv + Swarm bonus

Only consider if a real user-facing artifact is stored/retrieved through Swarm and referenced meaningfully from Arkiv, with encryption and public-reference risks handled. Do not add this if it distracts from the core app.

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Anon-RPC browser harness integration takes longer than expected | Track eligibility at risk | Run a browser POC after the local MVP; keep RPC resilience independent |
| Arkiv SDK/testnet friction or signing access | Track eligibility at risk | Run a real write/query POC; keep local JSON evidence functional |
| ENSv2 complexity | Scope expansion | Conditional gate; drop if not proven quickly |
| Arbitrary GitHub repos fail to run | Poor onboarding/demo | Support source inspection broadly, dynamic execution only for validated templates |
| URL-only scan overclaims | Trust/safety failure | Separate external observation from deep testing |
| Fault runner damages user environment | Safety/reliability | Isolated local target, explicit authorization, limits and cleanup |
| UI overbuilt | Time lost | Minimal Projects/Experiments/History/Settings design; one excellent experiment |
| Fake or non-reproducible evidence | Judge/user trust loss | Actual runner events, deterministic evaluator, reproducible scripts |
| Sponsor requirements change | Submission risk | Re-check official page before track selection and submission |

## 18. Release definition — hackathon MVP

BLOCKLAB MVP is complete when:

- The repo installs and starts from documented instructions.
- CLI initializes and inspects the included sample dApp.
- A dependency graph is generated with evidence/coverage labels.
- RPC blackout runs safely against the local sample environment.
- The experiment captures baseline, injected failure, observations, recovery and cleanup.
- Replay and comparison work.
- Studio can import/open the sample project, show its graph, run the experiment and render actual events/results.
- At least one target sponsor integration is end-to-end and verifiable; two are preferred only if both are real.
- README, license, AI disclosure, setup, limitations, architecture and demo instructions are complete.
- Track-specific evidence and submission video are complete.

The critical implementation order is: local CLI and RPC blackout, evidence/replay, Anon-RPC browser POC and integration, Arkiv POC and history workflow, minimal Studio, then only optional polish. ENSv2 and Python support are not release blockers.

## 19. Documentation and repository requirements

Root-level files:

- `README.md`
- `LICENSE`
- `PRD.md`
- `plan.md`
- `backlog.md`
- `SECURITY.md`
- `CONTRIBUTING.md` (short, if time permits)

Arkiv directory, if Arkiv track selected:

- `arkiv/schema.md`
- `arkiv/friction.md`
- `arkiv/reach.md`
- `arkiv/why-arkiv.md`
- `arkiv/how-you-use-arkiv.md`

Other evidence:

- Anon-RPC integration instructions and exact routed traffic description.
- ENSv2 transaction/permission evidence if selected.
- Demo script and limitations.
- AI-use attribution as required by ETHGlobal.

## 20. Assumptions requiring validation

- Current ETHGlobal Mumbai event page and deadline remain as stated at the time of final submission.
- Current Anon-RPC browser harness supports the chosen browser/app stack.
- Current Arkiv testnet, SDK and query API are operational and documented.
- ENSv2 Sepolia/mainnet interfaces and deployments are accessible if we pursue ENS.
- Local Anvil/Foundry and selected frontend stack can be run in the developer's environment.
- The team can publish a public repository and demo link within the event rules.

**This PRD defines intended behaviour, not proof that integrations are already implemented.** All integration claims must be backed by code, test output, transaction/query references and a reproducible demo.
