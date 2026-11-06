# UI-08 Studio audit

## Audit scope and baseline

Audit date: 2026-11-06. HEAD: `e16bf7a` on `main`. The worktree was clean
before this documentation change. The Studio is a Vite browser application at
`apps/studio`, served on port 5178. It is not a Next.js application.

Baseline validation:

- `pnpm typecheck`: passed.
- `pnpm test`: 37 files, 405 tests passed.
- `pnpm build`: passed for all workspace projects.
- `pnpm lint`: passed with existing warnings, including style suggestions in
  `apps/arkiv-poc/src/status.test.ts`, `apps/studio/src/arkiv/dom.ts`,
  `apps/studio/src/arkiv/record.test.ts`, and unused-import suggestions in
  Arkiv tests. These are not changed by UI-08.
- `git diff --check`: passed.

The browser baseline rendered `BLOCKLAB Studio / Arkiv history` with wallet,
publish, history, record details, ownership transfer, and comparison surfaces.
With no injected wallet it showed the explicit `Detect wallet` state and no
signing controls. No network request was made by the read-only comparison
model or DOM renderer.

## Current screen audit

### Studio entry page: Arkiv experiment history

**Exists:** `apps/studio/index.html`, `src/main.ts`, `src/style.css`.
`main.ts` resolves an EIP-1193 wallet, validates Rabdi chain state, constructs
the Arkiv gateway, mounts the Arkiv controller and comparison surface, and
performs initial wallet detection.

**Works:** Wallet missing, disconnected, wrong-network, connected, explicit
connect, explicit switch, disconnect, account/chain change handling, and
wallet error classification. No private key is read. The access key is not
rendered or added to wallet configuration.

**Partially works:** The page is an Arkiv operations console rather than a
project-oriented Studio. There is no project context, current inspection,
experiment context, local-agent status, or route/navigation state. The page
does not communicate whether a record is local, remote, expired, malformed, or
currently actionable at a product-level location; those facts are buried in
panel copy.

**UX problems:** One long page mixes wallet setup, publication, querying,
record details, ownership mutation, and comparison. There is no persistent
navigation, clear primary action, unsaved-input protection, URL-addressable
state, or responsive information hierarchy. The heading describes only Arkiv,
so a first-time user cannot discover the core inspect → test → report flow.

**Backend dependencies:** EIP-1193 wallet, Rabdi chain, Arkiv access key,
`ArkivGateway`, and `@blocklab/arkiv-metadata`. Future project and experiment
work must not be added directly to this page; it needs the local-agent
boundary described in [ui-08-hybrid-architecture.md](./ui-08-hybrid-architecture.md).

**Redesign:** Make this the History/Evidence destination. Keep the existing
wallet and Arkiv safety semantics, but move publication, history search,
details, ownership, and comparison into task-oriented tabs or routes. Show
record provenance and expiry uncertainty next to every record rather than only
inside detail copy.

### Wallet & network

**Exists:** `walletView`, `ArkivController` wallet events, and DOM actions.

**Works:** Missing provider, connect, explicit Rabdi switch, disconnect, account
changes, chain changes, and user rejection are represented as separate states.

**Missing:** No connection health, permission scope, last synchronization time,
or explanation of why a wallet is needed for read-only history versus writes.

**Redesign:** Persistent compact connection indicator in the shell; detailed
wallet drawer only when opened. Separate “read history” capability from
“publish/transfer” capability. Keep chain mismatch blocking writes.

### Publish to Arkiv

**Exists:** Validated textarea input, disclosure list, duplicate preflight,
exactly-one-write controller path, receipt wait, canonical read-back, and
uncertain-outcome handling.

**Works:** Validated records can be loaded; sensitive credential-shaped content
is rejected; the disclosure preview shows public metadata; publication is
explicitly approved by the user; no blind retry occurs.

**Missing/partial:** It is not connected to a project or experiment result
workflow. Users must paste JSON. There is no local evidence picker, digest
verification affordance, or publication history tied to the current project.

**Redesign:** Replace paste-first with “Publish this verified result” from the
Evidence page. Retain a guarded advanced JSON import. Show a public disclosure
diff, digest, expiry semantics, network, estimated transaction state, and
irreversible action warning before wallet approval.

### History

**Exists:** Indexed search by `experimentId`, `scenarioName`, or `status`,
bounded result list, loading/empty/error states, and record selection.

**Works:** Queries go through `ArkivGateway`; records are validated before
display; malformed records are not rendered as facts.

**Missing/partial:** Expired and nonexistent entities are indistinguishable at
the raw lookup layer. There is no pagination or saved query state. Rows do not
show provenance, expiry confidence, or whether the record is local or Arkiv
until opened.

**Redesign:** Add filter chips, result provenance, status/expiry badges, and
explicit “missing or expired” wording. Never claim an exact expiry boundary
contradicted by observed protocol behavior. Add cursor pagination only after
the gateway contract supports it.

### Record details

**Exists:** Key/experiment lookup, validated detail rows, malformed/error
states, and local-trace disclaimer.

**Works:** Reads are classified and validated. The UI distinguishes the
metadata record from detailed local traces.

**Missing:** No links to the originating local evidence, replay action, report,
project, or scenario. No digest verification action is exposed.

**Redesign:** Make details a read-only evidence summary with links to local
evidence when available, digest status, scenario version, execution status,
provenance, and limitations. Keep raw payload behind an expandable technical
section.

### Ownership transfer

**Exists:** Preview → confirm → read-back flow, ownership/creator comparison,
role gating, caveats, and no automatic retry.

**Works:** The controller performs a fresh read before confirmation and reports
uncertain outcomes without re-signing.

**Missing:** It is exposed beside routine history operations without a clear
destructive-action boundary or audit trail.

**Redesign:** Move it into a record “Administration” tab with explicit owner
role, recipient validation, irreversible-action warning, current/expected
state diff, and transaction/read-back timeline.

### RPC comparison view

**Exists:** `apps/studio/src/comparison` provides a pure validated model,
read-only view tree, DOM mount, redacted export, coverage calculation, Viem
summary, and fixed privacy limitations.

**Works:** Invalid payloads are rejected; unsupported methods and sensitive
fields are excluded; direct and Anon-RPC route states, readiness, method
results, latency, errors, coverage, and export feedback are represented.

**Missing/partial:** This panel is not mounted in the current Studio entry
page as the main experiment workflow. It is consumed by the sample dApp via a
window event. There is no experiment list, live runner timeline, replay launch,
or comparison route in Studio.

**Redesign:** Promote comparison to the Experiments/Evidence workflow. Accept
only a typed snapshot from the local agent/browser adapter; never let the
Studio execute RPCs or access filesystem/process APIs.

## Cross-cutting findings

- State ownership is strong inside pure Arkiv/comparison models, but the
  application shell has no route-level state model.
- DOM rendering is deliberately testable and redaction-aware; preserve this
  approach while adding page composition.
- The current page is desktop-readable but not information-architected for
  tablet navigation, dense tables, keyboard focus, or screen-reader landmarks.
- The existing integration boundaries are safer than a direct browser-to-local
  process bridge. Product work must not bypass them for convenience.
- The current implementation supports verified Arkiv writes/history and
  browser RPC comparison, but not project import, runner orchestration, or
  local-agent execution from Studio.

## Recommended implementation order

1. Establish shell/navigation and route state without changing integrations.
2. Add read-only project context supplied by a future local agent.
3. Add Attack Lab preflight as a typed configuration review.
4. Add execution timeline from actual runner events.
5. Add result/evidence/replay/compare views.
6. Rehouse Arkiv history and Anon-RPC comparison behind those workflows.
7. Add secure local-agent pairing only after its protocol and threat model are
   reviewed.
