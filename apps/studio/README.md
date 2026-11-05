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

## Export (schema `1.0`)

`buildComparisonExport(snapshot, { exportedAt?, requireComplete? })` produces a
downloadable artifact, `kind: "blocklab.rpc-comparison"`, from the **validated
model** — not from the raw page payload. The artifact records:

- `run.runId` (`rpc-` + 64-bit FNV-1a of the exported run, so the same run always
  gets the same id), `run.generatedAt`, and the comparison schema version;
- `run.completeness` (`complete` | `incomplete` | `failed`) with reasons, and the
  worker `id`, `kind`, classification string, and readiness;
- `direct` and `anonRpc` routes: state, readiness, initialization error, one
  entry per eligible method (`success`, `latencyMs`, `harnessRouted`,
  `errorCategory`), totals, success rate, average latency, routed count;
- `methods.eligible` / `methods.excluded`, `coverage` (recomputed routed ÷
  eligible, skipped methods counted separately), and `limitations`;
- `viem` probe summaries, `runtime.origin` (origin only), and the fixed
  `redaction.excluded` list.

Never exported: private keys/signer material, wallet identifiers, addresses or
account lists, cookies or browser storage, tokens/API keys/bearer headers,
credential-bearing RPC URLs (only an origin may appear), raw RPC parameters and
state overrides, request/response headers, worker internals, and unredacted
exception messages. Error text passes through `redactMessage`, which reduces any
URL to its origin and caps length.

Semantics: a payload Studio cannot display is **rejected**, never exported. A run
with no recorded attempt is rejected. A valid but partial run (direct-only,
skipped methods, a failed method, worker initialization failure) is exported with
`completeness: "incomplete"` or `"failed"` and explicit reasons; `requireComplete:
true` turns that into a rejection for hosts that accept only complete results.
Methods outside the read-only allowlist are rejected rather than exported.

The panel's **Export JSON** action is disabled until a valid comparison is
displayed, exports exactly the displayed snapshot (re-read at click time), does
not re-run any request, and does not modify the snapshot. Downloads use a Blob
object URL; revocation is deferred because revoking synchronously cancels the
download in Chrome (verified in headless Chrome). Feedback is shown next to the
action.

Validate a downloaded file by parsing it and checking `schemaVersion === "1.0"`,
`kind === "blocklab.rpc-comparison"`, and `run.runId`/`run.completeness`.

## Boundaries

- `apps/studio` depends on `@blocklab/core` and, for the comparison panel, the
  browser-safe base of `@blocklab/browser-rpc` (payload types and the
  `redactMessage` helper). It must never import the browser-only harness, the
  Viem subpath, or any execution engine.
- `comparison/export.ts` is environment-neutral; only `comparison/download.ts`
  touches the browser download API, and `comparison/dom.ts` is the only module
  that touches the document.
- Filesystem and process control are out of scope for this package; they would
  need an explicit local-agent boundary.

## Verification

Unit tests cover the model, the view tree, the export artifact, the download
helper (with an injected environment), and the mount wiring (with a minimal fake
element tree — this repository does not depend on a DOM library). Real-browser
checks are scripted in `scripts/studio-view-check.mjs` (rendered panel) and
`scripts/studio-export-check.mjs` (download). The export script performs a real
comparison, clicks Export JSON, reads the file Chrome wrote, compares it with the
rendered table, and asserts that zero network requests were made during the
export.
