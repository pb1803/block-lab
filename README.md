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

- Ethereum Foundation Anon-RPC
- Arkiv
- ENSv2 is conditional and will be included only if its real, central workflow is validated within the project timeline.

These integrations are planned and are not implemented yet.

## Project status

The local inspector, loopback RPC proxy, deterministic `rpc-blackout`
experiment, evidence evaluator, replay/comparison APIs, and first-class CLI are
implemented. Studio, Anon-RPC, Arkiv, ENSv2, automatic failover, and hosted
services remain out of scope for the current local workflow.

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
