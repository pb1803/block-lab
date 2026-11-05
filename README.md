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
- Arkiv — planned
- ENSv2 is conditional and will be included only if its real, central workflow is validated within the project timeline.

## Project status

The local inspector, loopback RPC proxy, deterministic `rpc-blackout`
experiment, evidence evaluator, replay/comparison APIs, and first-class CLI are
implemented. The Anon-RPC browser integration is implemented in
`@blocklab/browser-rpc` and used by `apps/sample-dapp` and `apps/anon-rpc-poc`.
Studio, Arkiv, ENSv2, automatic failover, and hosted services remain out of scope
for the current local workflow. Anon-RPC is browser-only: the CLI never imports
or emulates the harness.

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

Evidence is stored outside the inspected project by default. Use
`--evidence-dir <path>` or `BLOCKLAB_EVIDENCE_DIR` to override it. On Windows
the default is `%APPDATA%\blocklab\evidence`; on macOS it is
`~/Library/Application Support/blocklab/evidence`; on Linux it is
`$XDG_DATA_HOME/blocklab/evidence` or `~/.local/share/blocklab/evidence`.

The package is prepared for a future npm publication as `blocklab`, but it has
not been published.

The Phase 07 sample dApp and local Anvil instructions are documented in
[docs/sample-dapp.md](docs/sample-dapp.md).
