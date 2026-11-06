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

## Arkiv experiment history (added in Phase 15)

`src/arkiv/` adds wallet-mediated publish, history search, record details and
record comparison to Studio. The comparison panel stays **read-only**; the Arkiv
panel adds exactly one write path (Publish), and only from an explicit click.

### Boundaries (unchanged core rules)

- The `@arkiv-network/sdk` client/transport is imported by exactly one module,
  `src/arkiv/gateway.ts`; the schema builder subpath (`/schema`, no client) is
  imported only by `src/arkiv/schema.ts`. Everything else talks to the
  `ArkivGateway` interface.
- `@blocklab/arkiv-metadata` is the only record contract: every payload written
  or read is validated against it and encoded canonically
  (`metadataToPayloadBytes`). A read that fails validation is reported as
  malformed and is never rendered as fact.
- Studio never reads a private key. Signing happens in the wallet
  (`eth_sendTransaction`); Studio calls only `eth_requestAccounts`,
  `eth_chainId`, `eth_accounts`, and the explicit wallet switch.
- The Arkiv access key (`VITE_ARKIV_ACCESS_KEY`) is never rendered, logged, or
  written into the wallet's chain configuration (`wallet_addEthereumChain`
  carries the public RPC URL only).
- `apps/cli`, `@blocklab/runner`, `@blocklab/core` and `@blocklab/evidence`
  never import anything from `apps/studio` or `@blocklab/browser-rpc`'s Arkiv
  surface; Studio remains browser-only.

### Publish

1. Paste a validated BLOCKLAB record (JSON). It is re-validated by the shared
   schema and its canonical payload bytes are precomputed in the browser.
2. A disclosure list shows exactly what becomes public (indexed fields, counts,
   latency summary, digest, lifetime) with the honest note that the digest does
   not by itself prove trustworthy execution.
3. The **Review & approve** action first runs a duplicate preflight
   (`findExperiment`), then sends exactly one `createEntity`. If the preflight
   cannot run, the write is refused (an unknown duplicate state is never treated
   as "no duplicate").
4. Confirmation is only shown after a mined receipt. The read-back step fetches
   the entity and compares its payload bytes to the submitted canonical bytes;
   `verified` / `mismatch` / `unavailable` are all shown honestly.
5. If the write outcome is uncertain, the controller re-queries for the entity
   and, if one exists, reports it with "nothing was re-signed" — it never retries
   blindly and never invents a transaction hash or entity key.

### History, details and compare

- Search uses the indexed `DISCOVERY_ATTRIBUTES`: `experimentId`, `scenarioName`,
  `status`. A genuine empty result is a distinct state from a failed query.
- Details render every allowlisted field plus system metadata (owner, creator,
  entity key, created/updated/expiry blocks) and the digest disclaimer. Missing,
  expired (SDK `NoEntityFoundError`), malformed and unreadable records have
  distinct, honest states.
- `compareRecords` reuses the shared metadata contract field by field. It is not
  a second RPC comparison engine — `src/comparison/` remains the only per-method
  measurement engine. Local (pasted) records are always labelled "Local record".

### Verification

- Unit tests in `src/arkiv/*.test.ts` cover the reducer, wallet adapter
  (fake EIP-1193 provider), record decode/validation/redaction, gateway
  mapping, controller flows (duplicate, rejection, uncertainty, races), and the
  DOM wiring with the same fake-element convention as the comparison tests.
- Real-browser wiring checks: `scripts/studio-arkiv-check.mjs` drives the built
  app in headless Chrome with a labelled mock wallet (`isBlocklabMockWallet`,
  always 4001 on `eth_sendTransaction`) and asserts the gating throughout — it
  never claims a publication. Real publication remains the POC harness's
  verified result (`poc-write-001`).
- Configuration: `VITE_ARKIV_ACCESS_KEY` enables the read/write gateway. Without
  it the panel is display-only and every gateway-dependent action reports
  "Gateway is not ready." — no silent fallback.
