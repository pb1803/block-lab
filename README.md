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

pnpm is the chosen package manager. The full pnpm workspace and package manifests will be added in a later implementation phase.
