# BLOCKLAB Architecture

## Boundaries

- `@blocklab/core` contains platform-neutral domain types and validation. It does not import Node.js, browser, filesystem, process, wallet, or network APIs.
- `@blocklab/inspector` will safely inspect project files and produce evidence-labelled summaries. It owns no experiment execution.
- `@blocklab/scenarios` defines supported scenario metadata and validates preconditions. It does not perform I/O.
- `@blocklab/runner` owns Node.js experiment lifecycle concerns, including process ownership, cancellation, loopback enforcement, and future proxy execution.
- `@blocklab/evidence` owns redacted local result persistence, evaluation, digesting, and report formatting.
- `apps/cli` composes the shared packages for local operation without Studio, a hosted account, or remote services.
- `apps/studio` is currently a browser-safe shell. Filesystem and process control must later pass through an explicit local-agent boundary; the browser never receives arbitrary local access.
- `@blocklab/browser-rpc` is the only browser-only package. It owns the `@anon-rpc/browser-harness@0.4.0` dependency, hides it behind lazy imports, and provides two independent routes (`direct`, `anon-rpc`) behind one interface plus the comparison payload. Nothing in the Node.js dependency graph imports it.

## Dependency direction

```text
core
├── inspector
├── scenarios
├── runner ──> scenarios
├── evidence
├── browser-rpc ──(lazy, browser only)──> @anon-rpc/browser-harness
├── apps/cli ──> inspector, scenarios, runner, evidence
├── apps/sample-dapp ──> browser-rpc
├── apps/anon-rpc-poc ──> browser-rpc
└── apps/studio ──> core
```

The browser-only Anon-RPC harness stays outside the Node.js CLI dependency graph: `@blocklab/browser-rpc` is never imported by `apps/cli`, `@blocklab/runner`, `@blocklab/core`, or `@blocklab/evidence`, and `blocklab --help`/`blocklab config` state that Anon-RPC is browser-only and never emulated. The harness itself is reached through a lazy `import()` inside the Anon-RPC transport, so a direct-only session never downloads or evaluates the sandbox. Arkiv will be added later behind an integration interface, after a real proof of concept.

`apps/anon-rpc-poc` is a thin browser-only Vite application over the shared
package: it exposes explicit initialize/run/close buttons and a worker selector,
and it has no ordinary-RPC fallback. `apps/sample-dapp` adds route selection and
the comparison workflow on top of the same transports.

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

Measured results and their limits are recorded in
[docs/anon-rpc-poc.md](anon-rpc-poc.md).
