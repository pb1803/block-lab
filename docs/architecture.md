# BLOCKLAB Architecture

## Boundaries

- `@blocklab/core` contains platform-neutral domain types and validation. It does not import Node.js, browser, filesystem, process, wallet, or network APIs.
- `@blocklab/inspector` will safely inspect project files and produce evidence-labelled summaries. It owns no experiment execution.
- `@blocklab/scenarios` defines supported scenario metadata and validates preconditions. It does not perform I/O.
- `@blocklab/runner` owns Node.js experiment lifecycle concerns, including process ownership, cancellation, loopback enforcement, and future proxy execution.
- `@blocklab/evidence` owns redacted local result persistence, evaluation, digesting, and report formatting.
- `apps/cli` composes the shared packages for local operation without Studio, a hosted account, or remote services.
- `apps/studio` is a browser-safe shell plus one read-only comparison panel and one wallet-mediated Arkiv history panel. The comparison panel renders payloads the host page already produced and never executes RPC requests; the Arkiv panel reads Arkiv through its gateway and publishes only through an explicit, wallet-signed action. Neither polls, and neither anonymizes anything. Filesystem and process control must later pass through an explicit local-agent boundary; the browser never receives arbitrary local access.
- `@blocklab/browser-rpc` is the only browser-only package. It owns the `@anon-rpc/browser-harness@0.4.0` dependency, hides it behind lazy imports, and provides two independent routes (`direct`, `anon-rpc`) behind one interface plus the comparison payload. It also exposes an optional Viem adapter (`@blocklab/browser-rpc/viem`, Viem as an optional peer dependency) that delegates every request to those transports. Nothing in the Node.js dependency graph imports it.
- `@blocklab/arkiv-metadata` is the platform-neutral Arkiv record contract: schema version, allowlisted experiment metadata, strict validation, and canonical payload bytes plus digest. It has no dependencies and no I/O, so the CLI, the runner and the browser POC can all import it.
- `apps/arkiv-poc` is an isolated browser POC for the Arkiv sponsor integration. It is the only workspace that imports `@arkiv-network/sdk`, uses a connected EIP-1193 wallet for signing, and writes one compact `blocklab.experiment` entity on the Rabdi testnet. The CLI, runner, core and Studio do not depend on it.

## Dependency direction

```text
core
├── inspector
├── scenarios
├── runner ──> scenarios
├── evidence
├── arkiv-metadata (dependency-free record contract)
├── browser-rpc ──(lazy, browser only)──> @anon-rpc/browser-harness
│   └── /viem subpath ──(optional peer)──> viem
├── apps/cli ──> inspector, scenarios, runner, evidence
├── apps/sample-dapp ──> browser-rpc
├── apps/anon-rpc-poc ──> browser-rpc
├── apps/studio ──> core, browser-rpc, arkiv-metadata, @arkiv-network/sdk (gateway only), viem
├── apps/arkiv-poc ──> arkiv-metadata, @arkiv-network/sdk, viem
```

The browser-only Anon-RPC harness stays outside the Node.js CLI dependency graph: `@blocklab/browser-rpc` is never imported by `apps/cli`, `@blocklab/runner`, `@blocklab/core`, or `@blocklab/evidence`, and `blocklab --help`/`blocklab config` state that Anon-RPC is browser-only and never emulated. The harness itself is reached through a lazy `import()` inside the Anon-RPC transport, so a direct-only session never downloads or evaluates the sandbox. Arkiv follows the same isolation rule: the SDK is imported only by `apps/arkiv-poc` and by Studio's browser gateway module, never by the Node.js graph. Studio's history panel reuses the POC's proven contract after a real write/query/retrieve run existed (see [arkiv-poc.md](arkiv-poc.md)).

### Studio comparison view

`apps/studio/src/comparison` owns the read-only RPC comparison UI and its schema
(`StudioRpcSnapshot`, schema `1.0`). The payload contract is:

- `comparison` — the `RouteComparison` object from `@blocklab/browser-rpc`
  (`window.__blocklabComparison` on the sample page): per-route state, worker
  identity, attempts, latency, harness routing, and coverage.
- `viem?` — Viem public-client probe results, reported separately from the raw
  RPC observations.
- `runtime?` — optional page metadata; never rendered as a claim.

The page publishes the snapshot and dispatches `blocklab:comparison`; Studio
reads it through `mountComparisonView(container, { read, subscribe })`. Studio
recomputes coverage from the attempts (`routed ÷ eligible`), marks unmeasured
methods as skipped, drops invalid entries, redacts error text, and refuses to
substitute missing values. An absent payload renders an empty state and a
malformed one renders an alert listing the issues. Latency is reported as a
transport measurement only; `passthrough` is labelled as a non-anonymizing
reference worker, and routing is never presented as anonymity. There is no
Studio-side RPC engine, so the panel cannot diverge from the measured data.

The optional export (`apps/studio/src/comparison/export.ts`, artifact kind
`blocklab.rpc-comparison`, schema `1.0`) is built from that validated model, not
from the raw page payload, so it is a whitelist rather than a filter. It records
a deterministic run identifier, an explicit completeness label with reasons, and
the redacted measurement data; it never carries raw RPC parameters, headers,
accounts, storage, worker internals, endpoint URLs, or unredacted error text. A
payload Studio could not render is rejected, and a run with no recorded attempt
is rejected instead of exported as an empty success. Partial and failed runs are
exportable only with their label intact. `download.ts` is the sole browser
delivery module and defers object-URL revocation, because revoking synchronously
cancels the download in Chrome.

`apps/anon-rpc-poc` is a thin browser-only Vite application over the shared
package: it exposes explicit initialize/run/close buttons and a worker selector,
and it has no ordinary-RPC fallback. `apps/sample-dapp` adds route selection and
the comparison workflow on top of the same transports.

### Arkiv proof of concept

`apps/arkiv-poc` is deliberately outside the runner and the CLI. It composes:

- `config.ts` — verified Rabdi constants (chain id `7794095`/`0x76edaf`, RPC host,
  2 s blocks, `tGLM`, explorer) and the optional access key from
  `VITE_ARKIV_ACCESS_KEY`.
- `entity/experiment-schema.ts` — `defineSchema("blocklab.experiment")` with six
  indexed discovery columns and one non-indexed `payload` byte attribute.
- `status.ts` — typed wallet/publish state machine; `reduce` refuses out-of-order
  confirmations and every publish path is gated by an explicit checklist.
- `wallet.ts` — EIP-1193 helpers, error classification (`4001` is a user
  rejection, not a network failure) and an explicit network switch with a
  `4902` add-chain fallback only.
- `gateway.ts` — `ArkivGateway` over `createPublicClient`/`walletClient`:
  duplicate preflight by `experimentId`, write, read-back, strict payload decode.
- `workflow.ts` — orchestrates preflight → signature → confirmation → read-back
  with a generation counter so stale async results cannot mutate newer state.

The record itself lives in `@blocklab/arkiv-metadata`, which the CLI and runner
can import without pulling in the SDK. Detailed evidence stays local; only the
validated record is written. The POC is not wired into Studio; Studio implements
its own browser path over the same contract (below).

### Studio Arkiv history

A real browser-wallet publication (ARK-07) is a separate, human-approved run, not a
test path: [arkiv-ark07.md](arkiv-ark07.md) documents the dedicated `studio-mm-001`
probe record, the read-only `preflight:test` gate, and the CDP driver
`apps/studio/scripts/studio-arkiv-live.mjs`, which requires a genuine MetaMask
provider, checks balance and duplicates before signing, waits for the mined
receipt, and re-reads the entity from a separate process for a byte comparison.
The mocked browser check (`scripts/studio-arkiv-check.mjs`) is never evidence of a
publication.

That run happened on 2026-11-06 and is recorded in [arkiv-ark07.md](arkiv-ark07.md):
entity `0x9038f929…bcb7`, eleven checks, byte-identical payload. It is attributed
to the MetaMask account (`0xD431…2EBE9`), not the POC harness signer, so the two
publications prove different paths and are never conflated. The driver exits
through one path that closes its CDP socket and sets `process.exitCode`, because
forcing `process.exit()` over live socket handles aborts Node on Windows.

`apps/studio/src/arkiv` promotes the POC into a Studio product feature once a real
write/query/retrieve run existed (`poc-write-001`, verified in
[arkiv-poc.md](arkiv-poc.md)). Boundaries:

- The SDK's client/transport surface is imported only by `gateway.ts`; the
  dependency-free schema builder subpath (`@arkiv-network/sdk/schema`) is imported
  only by `schema.ts` to declare columns. Everything else depends on the small
  `ArkivGateway` interface (find, publish, read, query, current block), which is
  what tests substitute.
- `@blocklab/arkiv-metadata` stays the single record contract: the browser writes
  canonical payload bytes produced by `metadataToPayloadBytes`, and an entity that
  does not re-validate (or does not round-trip byte-for-byte) is rejected as
  malformed. No field is ever substituted for a missing one.
- `schema.ts` mirrors the POC's `defineSchema("blocklab.experiment")`; the
  discovery attributes are exactly `DISCOVERY_ATTRIBUTES` (experimentId,
  experimentType, scenarioName, status, targetChainId, startedAtMs). Only the
  compact record is published; traces and evidence stay local.
- `wallet.ts` is the EIP-1193 adapter: connect, read chain, an explicit
  `wallet_switchEthereumChain` with a `4902` add-chain fallback that carries no
  access key, and event attachment with removable handlers. Studio never switches
  networks on its own.
- `controller.ts` orchestrates publish/history/detail with a generation counter:
  preflight → exactly one `createEntity` → wait for the mined receipt → read back
  and compare bytes. A failed preflight blocks signing; an uncertain write is
  re-queried once and reported with "nothing was re-signed" — never retried and
  never given a fabricated hash or key.
- `state.ts` is the pure reducer (wallet/publish/history/detail), `view.ts` the
  pure view model, `compare.ts` the metadata field diff, and `dom.ts` the only
  DOM-touching module. `compare.ts` is not a second RPC comparison engine;
  `comparison/` remains the only measurement engine.
- `VITE_ARKIV_ACCESS_KEY` enables reads/writes. Without it no gateway is built
  and every gateway-dependent action reports "Gateway is not ready." — an honest
  failure, not a silent fallback.

The Node.js side is untouched: `apps/cli`, `@blocklab/runner`, `@blocklab/core`
and `@blocklab/evidence` import neither Studio nor `@blocklab/browser-rpc`, so
the CLI stays free of the browser harness and the Arkiv SDK.

## Experiment data flow

```text
CLI or Studio
  -> shared scenario definition
  -> explicit local-agent/runner boundary
  -> preflight
  -> baseline
  -> inject
  -> observe
  -> recover
  -> cleanup
  -> evaluate
  -> redacted local evidence and report
```

The current foundation defines these boundaries and contracts only. It does not implement a fake RPC blackout, sponsor integration, or decorative Studio dashboard.

## Safe inspector data flow

`blocklab inspect` resolves a local directory, reads `package.json`, lockfiles, and
supported configuration/source files as plain text, and never executes repository
scripts or makes network requests. The inspector emits the stable `1.0` JSON shape:

- `rootPath`, `manifest`, `packageManagers`, and `packageManagerConflict`
- `detectedStack`
- `dependencies`: evidence-labelled nodes with `nodeId`, `type`, `name`,
  `evidenceSource`, `evidence`, `confidence`, and redacted metadata
- `edges`: evidence-labelled declarations from `package.json`
- `chainIds`, `networkNames`, and sanitized `rpcReferences`
- `limitations`

Environment files are skipped. Environment-variable references are reported by
variable name only, and URL references are reduced to their origin. Sensitive
configuration values are never copied into findings. Multiple lockfiles are
reported as a conflict rather than silently selecting one package manager.

## Runner lifecycle and safety

`@blocklab/runner` owns one `ExecutionContext` per execution. The context
centrally validates these transitions:

```text
created -> preparing -> running -> completed
                         |       -> failed
                         |       -> cancelling -> cancelled
                         |                    -> timed_out
```

The context records lifecycle timestamps and structured events, owns an
`AbortSignal`, and registers cleanup handlers for resources created by that
execution. Cleanup runs in reverse registration order, is idempotent, continues
after individual failures, and reports all cleanup failures separately from the
primary execution error.

`preflightExecution` validates timeout/resource limits, rejects sensitive
configuration, and enforces loopback-only targets. An authorization interface is
defined for future staging support, but authorized staging execution remains
disabled rather than simulated.

## Local RPC proxy boundary

The runner now provides a Node.js-only `RpcProxy` for local experiments. It
binds to `127.0.0.1`, accepts one explicit HTTP(S) upstream that must also be
loopback, rejects batches and transaction/signing methods, limits request
bodies, and applies an upstream timeout. It records only redacted metadata
(method, request ID, timestamps, latency, origin, and outcome category); raw
request bodies, query strings, credentials, and RPC parameters are not stored.

The `rpc-blackout` schedule uses the interval
`[startOffsetMs, startOffsetMs + durationMs)`: the start boundary is blocked
and the end boundary forwards again. Blackout responses preserve the JSON-RPC
request ID and do not contact the upstream. `runRpcBlackout` starts the proxy
inside an existing execution and registers its close operation with the
execution cleanup stack, including timeout and cancellation paths.

This phase does not launch imported project scripts, manage Anvil/Docker, or
provide a hosted proxy. Cancellation signals cooperative tasks; an arbitrary
uncooperative asynchronous task cannot be forcibly terminated by this library.

## Evidence, evaluation, replay, and comparison

`@blocklab/evidence` consumes the runner's redacted proxy records and terminal
execution metadata; it does not depend on Node HTTP internals or create a
second lifecycle. Evidence schema `1.0` stores the execution identity,
`rpc-blackout` version `1.0.0`, normalized blackout schedule, terminal state,
phase-labelled observations, evaluation, metrics, warnings, and limitations.
Raw RPC bodies, parameters, credentials, query strings, and authorization
headers are never persisted.

Observations use the same half-open interval as the proxy:
`[startOffsetMs, startOffsetMs + durationMs)`. Baseline is before the start,
fault is inside the interval, and recovery is at or after the end. A run passes
only when a healthy baseline, an observed injected blackout, and a successful
post-blackout forwarding request are all established. Missing observations are
`inconclusive`; genuine upstream failures are not counted as injected faults.
Cancelled and timed-out executions cannot be reported as fully passed.

Metrics use milliseconds and include counts by phase, forwarded successes,
upstream errors, injected failures, invalid requests, average/median latency,
recovery count, and time from blackout end to first successful recovery. Replay
copies only the normalized schedule and creates new IDs. Comparison rejects
incompatible schema versions and labels metrics as non-comparable when
configurations differ; it does not infer causation or application failover.

Evidence persistence is local JSON only. Writes create a temporary file and
atomically link it into place without overwriting an existing record. Reads
validate the schema, and malformed or unsupported files fail explicitly.

## First-class CLI

`apps/cli` is a local Node.js composition layer. It does not duplicate
inspection, proxy, evaluation, or persistence logic: commands call the
corresponding package APIs. `inspect` reads projects without running scripts;
`test rpc-blackout` generates read-only `eth_chainId` observations against an
explicit loopback upstream; `runs`, `report`, `replay`, and `compare` operate
on validated local evidence records. Replay stores only the normalized schedule
and requires a new explicit upstream because full upstream URLs are not
persisted.

The default evidence directory is platform-specific and outside inspected
projects. `--evidence-dir` takes precedence over the
`BLOCKLAB_EVIDENCE_DIR` override, followed by the platform default. CLI exit
codes are `0` for success, `2` for usage errors, `3` for operation failures,
and `4` when evidence is inconclusive. The CLI handles SIGINT/SIGTERM by
requesting cooperative execution cancellation; proxy cleanup remains owned by
the runner lifecycle.

## Browser RPC routes

Two transports implement one interface (`initialize`, `request`, `close`,
`state`, `label`):

```text
DirectRpcTransport ── fetch ───────────────────────────────> RPC endpoint
AnonRpcTransport  ── worker.fetch ── sandboxed worker ─────> RPC endpoint
                        └── bootstrap provider: specifier read only
```

Both routes share `callJsonRpc` for encoding, timeouts, aborts, and error
classification, so a difference between the routes can only come from the
transport. The eligible surface is fixed to `eth_chainId`, `eth_blockNumber`,
`eth_getBalance`, and `eth_call` with internally generated parameters, and
wallet/signing methods are rejected at runtime. A failed or closed harness
reports `not-ready` and never falls back to a direct request. An initialization
failure closes the worker, is shown in the UI, and `receivedThroughHarness` stays
`false`, so a routed response can never be claimed for a request that did not go
through the sandbox.

`buildComparison` produces the stable `1.0` payload (`window.__blocklabComparison`):
per-route attempts with method, route, start/end timestamps, latency, success,
error category, worker readiness, and `receivedThroughHarness`; per-route
summaries; coverage; worked examples of excluded methods; and explicit notes that
latency is not a privacy measurement and that `reference` workers do not
anonymize.

`scripts/browser-selftest.mjs` drives headless Chrome over CDP with Node's built-in
WebSocket client, opens `?selftest=1`, and prints the payload, so the browser path
is verifiable without a manual click-through and without a browser-automation
dependency. `apps/sample-dapp/src/selftest.ts` publishes only that payload on
`window.__blocklabSelfTest`.

### Viem adapter

`@blocklab/browser-rpc/viem` turns a route into a Viem transport built with
Viem's `createTransport`, so applications can use the normal public client:

```ts
const route = createAnonViemRoute({ endpoint, bootstrapRpcUrl, worker });
const client = createPublicClient({ chain: mainnet, transport: route.transport });
```

Boundaries:

- No RPC execution is duplicated: the adapter calls
  `instance.requestResult(method, { params })`, which is the same engine used by
  `request()` and therefore keeps the allowlist, classification, timeouts, and
  no-fallback guarantee.
- Initialization stays where it already was: lazy, memoized by the transport,
  and shared by every client built from the same route. There is no global
  singleton, and `route.close()` is the only disposal path.
- Viem wraps unknown thrown values in `UnknownRpcError`, so the adapter throws
  `BlocklabRpcError extends viem.BaseError` with the BLOCKLAB `category` and the
  original error as `cause`.
- Viem-level retries default to `0`, and the Viem timeout is set above the
  transport timeout so BLOCKLAB's classification wins.
- Caller-supplied parameters are validated (`eth_getBalance` address + block
  tag, `eth_call` call object + block tag). State overrides and unknown call
  fields are refused. Parameters are never stored in observations.
- The `viem` peer dependency is optional, so importing the main entry point does
  not require Viem.

Measured results and their limits are recorded in
[docs/anon-rpc-poc.md](anon-rpc-poc.md).
