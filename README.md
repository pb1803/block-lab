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

Planning and workspace bootstrap.

BLOCKLAB is under development. The repository currently contains project requirements and bootstrap documentation; application code and dependencies have not yet been added.

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

The repository is a pnpm workspace. The initial implementation contains shared domain and boundary packages plus a minimal CLI and Studio shell. Anon-RPC, Arkiv, ENSv2, and the RPC blackout runner are not implemented yet.

Inspect a local project without executing its scripts:

```bash
pnpm --filter @blocklab/cli build
node apps/cli/dist/index.js inspect path/to/project
node apps/cli/dist/index.js inspect path/to/project --json
```

Inspection output is evidence-labelled and redacts environment values, credentials,
tokens, and private-key material.

The Phase 07 sample dApp and local Anvil instructions are documented in
[docs/sample-dapp.md](docs/sample-dapp.md).
