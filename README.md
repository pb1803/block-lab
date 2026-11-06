# BLOCKLAB

**Break your dApp before the real world does.**

BLOCKLAB is an Ethereum dApp resilience and RPC-privacy testing platform. It is designed to help developers inspect application dependencies, run controlled experiments in isolated environments, observe failure and recovery behaviour, and retain reproducible evidence.

## Main capabilities

- Ethereum dApp inspection and dependency mapping
- Controlled local resilience testing
- RPC privacy experiments
- A first-class local CLI
- A minimal Studio web interface

## Technology direction

BLOCKLAB is planned as a TypeScript/JavaScript pnpm workspace monorepo with a shared experiment engine, a local CLI, and Studio. The initial local test environment will prefer Anvil, with support for selected React, Next.js, Vite, Wagmi, Viem, Ethers, Foundry, and Hardhat projects where detectable and testable.

## Planned integrations

- Ethereum Foundation Anon-RPC — browser integration implemented (see below)
- Arkiv — Rabdi testnet proof of concept with one verified real entity write, plus a Studio history feature (see below)
- ENSv2 is conditional and will be included only if its real, central workflow is validated within the project timeline.

## Project status

The local inspector, loopback RPC proxy, deterministic `rpc-blackout` and
`rpc-latency` experiments, evidence evaluator, replay/comparison APIs, and
first-class CLI are implemented. The Anon-RPC browser integration is implemented in
`@blocklab/browser-rpc` and used by `apps/sample-dapp` and `apps/anon-rpc-poc`.
The Arkiv proof of concept lives in `apps/arkiv-poc` and has one verified real
entity publication (tx, entity key, receipt and read-back in `docs/arkiv-poc.md`)
plus a Studio history feature over the same contract. ENSv2, automatic failover,
and hosted services remain out of scope for the current local workflow. Anon-RPC
is browser-only: the CLI never imports or emulates the harness, and neither does
it import the Arkiv SDK.

The inspect-only Local Agent is available for Studio onboarding. Start it with
an explicit project directory, pair with its short-lived code in Studio
Projects, and inspect the project through the existing safe inspector. It binds
to loopback, rejects unapproved browser origins, never executes project code,
and does not yet run experiments or import GitHub repositories. See
[docs/deploy-01-local-agent.md](docs/deploy-01-local-agent.md).

## Anon-RPC browser routes

Eligible read-only calls (`eth_chainId`, `eth_blockNumber`, `eth_getBalance`,
`eth_call`) can run on two independent routes behind one interface: `direct`
(ordinary RPC, used as the control) and `anon-rpc` (hash-pinned worker inside a
browser sandbox). There is no silent fallback in either direction, and no
wallet, signing, or private-key handling anywhere.

```bash
pnpm install
pnpm build
cp apps/sample-dapp/.env.example apps/sample-dapp/.env.local
pnpm --filter @blocklab/sample-dapp dev
```

Anon-RPC is the default selected route in the sample dApp. **Compare routes**
runs the same workload on both routes and reports method, route, timestamps,
latency, success/failure, error category, worker readiness, harness-routed
count, coverage, and the privacy limits of the measurement.

The comparison panel is rendered by the read-only Studio view
(`@blocklab/studio/comparison`). The page publishes a snapshot and Studio
validates and presents it: it recomputes coverage from the attempts, marks
methods that were never attempted as skipped rather than successful, reports
Viem probe results separately, and states that latency is not privacy and that
the `passthrough` reference worker does not anonymize anything. Studio never
issues an RPC request and never polls.

Once a comparison is displayed, **Export JSON** downloads it as a redacted
`blocklab.rpc-comparison` schema `1.0` artifact: a stable `runId`, an explicit
`complete` / `incomplete` / `failed` label with reasons, per-attempt status,
latency, harness routing, coverage, and Viem summaries. Raw parameters, headers,
accounts, storage, endpoint URLs, and unredacted error text are never included,
and exporting does not re-run the experiment.

Existing Viem applications can use the same routes through
`@blocklab/browser-rpc/viem`:

```ts
const route = createAnonViemRoute({ endpoint, bootstrapRpcUrl, worker });
const client = createPublicClient({ chain: mainnet, transport: route.transport });
await client.getBalance({ address });
route.close();
```

Viem is an optional peer dependency, the adapter reuses the existing
transports, and `route.close()` is the only disposal path. Details:
[packages/browser-rpc/README.md](packages/browser-rpc/README.md).

Headless-browser verification (no browser-automation dependency):

```bash
node scripts/browser-selftest.mjs --url http://127.0.0.1:5173/ --timeout 200000
node scripts/studio-view-check.mjs --url http://127.0.0.1:5173/ --timeout 200000
```

Verified on 2026-11-05 in HeadlessChrome 156 against
`https://ethereum-rpc.publicnode.com`: the reference `passthrough` worker routed
4/4 reads (avg 941 ms vs 365 ms direct), and the anonymizing `tor-js` worker
routed 4/4 reads (avg 2996 ms vs 376 ms direct). A deliberate specifier/chain
mismatch failed loudly with `not-ready` on all four attempts, 0% coverage, and no
direct request. These numbers measure routing and cost, **not** anonymity:
`passthrough` is a reference worker that provides no privacy, `network` worker
classification is the adopter list's claim, and BLOCKLAB does not measure exit
IPs, observer views, or traffic analysis. Details and limitations:
[docs/anon-rpc-poc.md](docs/anon-rpc-poc.md).

## Arkiv Rabdi proof of concept

`apps/arkiv-poc` is an isolated browser POC for the Arkiv sponsor integration. It
uses the verified `@arkiv-network/sdk@1.0.1` and `viem` against the Rabdi testnet
(chain id `7794095` = `0x76edaf`, 2 s blocks, `tGLM`, explorer
`https://rabdi.explorer.arkiv.network`), and writes one compact
`blocklab.experiment` entity through a connected EIP-1193 wallet. The record
contract lives in `@blocklab/arkiv-metadata` (dependency-free): a schema-versioned
allowlist with six indexed discovery attributes and one non-indexed payload
attribute. Detailed evidence stays local; only the compact, validated, redacted
record is ever written.

Publishing is gated: valid record, connected wallet, chain id exactly `0x76edaf`,
an explicit confirmation checkbox, and a completed duplicate preflight. A wrong
network disables publish instead of switching silently, a rejected signature
leaves nothing behind, signing never leaves the wallet, and no private key is
ever pasted or stored.

What is verified:

- Read-only JSON-RPC check (`scripts/arkiv-net-check.mjs`): 11/11 live checks
  (chain id, head block, 2 s block timing, schema-tagged query, ownership fields,
  `getEntity` hit/miss, no transaction sent).
- Browser POC check (`scripts/arkiv-poc-check.mjs`): live read-only probe plus
  wrong-network gating and the mock-wallet user-rejection path up to exactly one
  rejected `eth_sendTransaction`.
- **One real publication, verified end to end (2026-11-06, `poc-write-001`)**:
  exactly one `createEntity` — tx
  `0xed989cbe6d5b0aad7db1d03e0d7e16ff6865fb6f5a915d08c08f7bfa3c573f05` (block
  `269199`), entity
  `0x1d7b6bf841deab1a003cc7c1fa407b97e7e27fb6de276dc287b8e2e0551bb31a`, actual gas
  `0.000209105 tGLM`, signer `0x8C58af332c90B90bfcD2D5021F7Ff6e7880B8759` (rotated
  after an exposure report; the key exists only in git-ignored
  `apps/arkiv-poc/.env.local`). The entity reads back with
  `owner == creator ==` the signer, `expiresAt` block `571599` (7 days), and a
  payload byte-identical to the canonical record. Full evidence:
  [docs/arkiv-poc.md](docs/arkiv-poc.md).

The browser-wallet write (ARK-07) is now also real, and separate from this POC: a
human MetaMask approval published `studio-mm-001` from Studio, verified 11/11 with
a byte-identical payload and `owner == creator == signer`. Full evidence:
[docs/arkiv-ark07.md](docs/arkiv-ark07.md).

ARK-05 is DONE as a dedicated two-wallet run: `studio-mm-002` was created by
wallet A, then transferred to wallet B, with the `creator` proven immutable, the
payload and expiry proven unchanged and the `OwnershipTransferred` event decoded;
evidence in [docs/arkiv-ark05.md](docs/arkiv-ark05.md).

ARK-06 is DONE as a dedicated short-lifetime probe: `ark06-expiry-001` was created
once at 5 blocks, watched live, and observed gone before its `expiresAt` block, with a
second process verifying `expected-expired` 7/7 from the `EntityCreated` deadline.
The run corrected the plan: an entity dies at `expiresAt − 1`, not at `expiresAt`
([docs/arkiv-ark06.md](docs/arkiv-ark06.md) §15,
[docs/arkiv-ark06b.md](docs/arkiv-ark06b.md)).

What is **not** claimed: no anonymity property is measured, and the three long-lived
entities have still not been watched to their own (much later) deadlines. These stay
experiments, not claims. See [docs/arkiv-ark05.md](docs/arkiv-ark05.md).

## Studio Arkiv history

`apps/studio/src/arkiv` (Phase 15) makes Arkiv an actual Studio feature: a
wallet panel (connect, chain detection, explicit switch to `0x76edaf`, no silent
network switching), a publish flow (paste a validated record, review the
disclosure preview, exactly one wallet-signed `createEntity` after a duplicate
preflight, confirmation only after a mined receipt, byte-level read-back), a
history search over the indexed `experimentId` / `scenarioName` / `status`
attributes, record details (owner/creator/entity key/expiry blocks with the
digest disclaimer), and a metadata comparison that reuses the shared
`@blocklab/arkiv-metadata` contract — `apps/studio/src/comparison` stays the only
measurement engine.

The Arkiv SDK is imported by a single browser module
(`apps/studio/src/arkiv/gateway.ts`); the Node.js side (`cli`, `runner`, `core`,
`evidence`) stays free of it, exactly like the Anon-RPC harness rule. The access
key (`VITE_ARKIV_ACCESS_KEY`) is never rendered and never added to the wallet's
chain configuration. Without a key the panel is display-only and every
gateway-dependent action fails honestly with "Gateway is not ready." — never a
silent fallback.

Verified by unit tests plus a real headless-Chrome run with a labelled mock
wallet (`isBlocklabMockWallet`, always `4001` on `eth_sendTransaction`), which
asserts the gating and honest failure states across 20 checks:

```bash
node scripts/studio-arkiv-check.mjs --url http://localhost:5178/ --port 9552
```

That run verifies wiring and gating, not a real publication; the only real
publication claim remains the verified `poc-write-001` entity above.

A real MetaMask publication is a separate, human-approved run, documented in
[docs/arkiv-ark07.md](docs/arkiv-ark07.md): a deterministic `studio-mm-001` probe
record, a read-only `preflight:test` gate, and a CDP driver that refuses any
non-MetaMask provider, checks gas and duplicates before signing, and re-reads the
entity in a separate process for a byte comparison. The signature happened on
2026-11-06: 11/11 checks passed, so ARK-07 is DONE — the tooling alone never made
the claim.

## Package manager

pnpm is the chosen package manager and is configured as the repository workspace manager.

## Development

Requirements:

- Node.js 24+
- pnpm 10+

Install dependencies and run the foundation checks:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The repository is a pnpm workspace. The implementation contains shared domain and boundary packages plus a local
CLI and minimal Studio shell.

Inspect a local project without executing its scripts:

```bash
pnpm --filter @blocklab/cli build
node apps/cli/dist/index.js inspect path/to/project
node apps/cli/dist/index.js inspect path/to/project --json
```

Inspection output is evidence-labelled and redacts environment values, credentials,
tokens, and private-key material.

Run a local read-only RPC blackout experiment. An explicit loopback upstream is
required; no public RPC endpoint is selected automatically:

```powershell
node apps/cli/dist/index.js test rpc-blackout `
  --upstream http://127.0.0.1:8545
node apps/cli/dist/index.js runs list
node apps/cli/dist/index.js report <execution-id>
node apps/cli/dist/index.js replay <execution-id> `
  --upstream http://127.0.0.1:8545
node apps/cli/dist/index.js compare <execution-a> <execution-b>
```

Run deterministic RPC latency injection with a fixed delay. Requests starting
in `[start-offset, start-offset + duration)` wait exactly `--delay`
milliseconds:

```powershell
node apps/cli/dist/index.js test rpc-latency `
  --upstream http://127.0.0.1:8545 `
  --delay 250 --start-offset 100 --duration 500 --experiment-duration 800
```

Latency evidence measures proxy-observed request behavior and does not prove
application-level resilience. All experiments remain read-only and loopback
only.

Evidence is stored outside the inspected project by default. Use
`--evidence-dir <path>` or `BLOCKLAB_EVIDENCE_DIR` to override it. On Windows
the default is `%APPDATA%\blocklab\evidence`; on macOS it is
`~/Library/Application Support/blocklab/evidence`; on Linux it is
`$XDG_DATA_HOME/blocklab/evidence` or `~/.local/share/blocklab/evidence`.

The package is prepared for a future npm publication as `blocklab`, but it has
not been published.

The Phase 07 sample dApp and local Anvil instructions are documented in
[docs/sample-dapp.md](docs/sample-dapp.md).
