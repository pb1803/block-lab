# BLOCKLAB Architecture

## Boundaries

- `@blocklab/core` contains platform-neutral domain types and validation. It does not import Node.js, browser, filesystem, process, wallet, or network APIs.
- `@blocklab/inspector` will safely inspect project files and produce evidence-labelled summaries. It owns no experiment execution.
- `@blocklab/scenarios` defines supported scenario metadata and validates preconditions. It does not perform I/O.
- `@blocklab/runner` owns Node.js experiment lifecycle concerns, including process ownership, cancellation, loopback enforcement, and future proxy execution.
- `@blocklab/evidence` owns redacted local result persistence, evaluation, digesting, and report formatting.
- `apps/cli` composes the shared packages for local operation without Studio, a hosted account, or remote services.
- `apps/studio` is currently a browser-safe shell. Filesystem and process control must later pass through an explicit local-agent boundary; the browser never receives arbitrary local access.

## Dependency direction

```text
core
├── inspector
├── scenarios
├── runner ──> scenarios
├── evidence
├── apps/cli ──> inspector, scenarios, runner, evidence
└── apps/studio ──> core
```

The browser-only Anon-RPC harness will remain outside the Node.js CLI dependency graph. Arkiv will be added later behind an integration interface, after a real proof of concept.

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

This phase does not create an RPC proxy, intercept requests, inject failures,
launch imported project scripts, or manage Anvil/Docker. Cancellation signals
cooperative tasks; an arbitrary uncooperative asynchronous task cannot be
forcibly terminated by this library.
