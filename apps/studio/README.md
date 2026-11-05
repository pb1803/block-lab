# @blocklab/studio

Read-only browser surfaces for BLOCKLAB experiments. The Studio package is
pure: it renders provided data and never executes RPC requests, never fetches
anything itself, and never runs anonymous workers.

## Layout

- `src/index.ts` — the application shell (`studioShell`).
- `src/comparison/` — the read-only RPC comparison view:
  - `model.ts` — schema, validation, and normalization of the snapshot
    (`parseStudioSnapshot`, `createStudioSnapshot`, `StudioRpcSnapshot`).
  - `view.ts` — a pure node tree for the panel (`comparisonViewNodes`). No DOM.
  - `dom.ts` — the only DOM-touching module (`mountComparisonView`).

The `@blocklab/studio/comparison` subpath also re-exports the model types so
producers (currently the sample dApp) stay on one schema.

## Data contract

Studio consumes a `StudioRpcSnapshot` that the host page already produced:

- `schemaVersion` — `"1.0"`.
- `comparison` — the `RouteComparison` payload from `@blocklab/browser-rpc`
  (`window.__blocklabComparison`).
- `viem?` — optional probe results from the Viem adapter, kept separate from
  the raw RPC observations (`{ direct?, anonRpc? }`).
- `runtime?` — optional `{ userAgent, url }`, shown only in the payload.

Studio recomputes coverage as *harness-routed requests ÷ eligible methods* and
never counts a skipped method as successful. Missing, malformed, or untrusted
values are dropped or reported and are never substituted.

## Rendering

`mountComparisonView(container, { read, subscribe? })` mounts the panel:

- **Before any payload:** "No comparison yet" plus a read-only notice.
- **Invalid payload (`role="alert"`):** each issue is listed; nothing is guessed
  or substituted. The page owns the payload, so corrupted data stays visible
  instead of being hidden.
- **Ready:** route status cards (transport state, readiness, worker kind and ID,
  initialization errors), a per-method table (success/failure, latency, harness
  routing, error category), coverage with an explicit denominator, Viem results,
  and the fixed privacy limitations (latency ≠ privacy, `passthrough` is not
  anonymizing, routing ≠ anonymity, results are run-specific).

The view refreshes only when the page publishes — Studio does not poll, and
`unmount()` removes the subscription and the tree. Error text is redacted
through `@blocklab/browser-rpc` before it is rendered.

## Boundaries

- `apps/studio` depends on `@blocklab/core` and, for the comparison panel, the
  browser-safe base of `@blocklab/browser-rpc` (payload types and the
  `redactMessage` helper). It must never import the browser-only harness, the
  Viem subpath, or any execution engine.
- Filesystem and process control are out of scope for this package; they would
  need an explicit local-agent boundary.

## Verification

Unit tests cover the model and the view tree (no DOM needed). Real-browser
checks are scripted in `scripts/studio-view-check.mjs` and run against the
sample dApp (`?selftest=1`); they assert the rendered text, table rows, route
cards, and live refresh, and re-run against passthrough, a network worker, and
a failing worker.
