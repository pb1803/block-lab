# Sample dApp and local RPC

The sample dApp is a small Vite/TypeScript browser application in
[apps/sample-dapp](../apps/sample-dapp). It does not connect a wallet, sign,
broadcast transactions, or execute project scripts. It sends four read-only
requests (`eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_call`) over one
of two routes:

- **Anon-RPC** (default): hash-pinned worker inside a browser sandbox.
- **Direct RPC** (control): the configured endpoint, fetched normally.

Selecting a route is explicit; a failed Anon-RPC worker never falls back to a
direct request. Route details are in [anon-rpc-poc.md](anon-rpc-poc.md).

## Run the sample

From the repository root:

```powershell
Copy-Item apps/sample-dapp/.env.example apps/sample-dapp/.env.local
pnpm --filter @blocklab/sample-dapp dev
```

Open the URL printed by Vite. Set `VITE_RPC_URL` in
`apps/sample-dapp/.env.local` to change the endpoint, and
`VITE_ANON_RPC_WORKER` (`passthrough`, `tor-js`, `nym`, or `nox`) to change the
worker. Environment files are ignored by Git. Do not put credentials in the
endpoint or commit local configuration. Run `pnpm build` first so
`@blocklab/browser-rpc` exists as built output.

The page exposes four actions: **Run requests** on the selected route,
**Compare routes** (same workload on both routes, then coverage, success rate,
average latency, harness-routed count, and the privacy limits), **Run Viem
client** (the same route through Viem's `createPublicClient`, calling
`getChainId`, `getBlockNumber`, `getBalance`, and one read-only contract
`call`), and **Close worker**. The comparison payload is also available as
`window.__blocklabComparison`.

The local experiment flow is:

```text
sample dApp -> configurable RPC endpoint -> BLOCKLAB local proxy -> Anvil
```

Start the proxy as part of a runner experiment and point the sample at the
reported local proxy URL. The proxy has no hosted mode and only accepts a
loopback upstream. Its blackout window is deterministic and closes during
runner cleanup. Full CLI orchestration and application-level evaluation remain
later phases.

## Start Anvil

Native Anvil is preferred:

```powershell
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

Stop it with `Ctrl+C`. BLOCKLAB does not install Foundry automatically.

If native Anvil is unavailable and Docker Desktop is installed and running:

```powershell
docker compose -f docker-compose.anvil.yml up
docker compose -f docker-compose.anvil.yml down
```

The fallback binds Anvil to loopback and uses chain ID `31337`. The current
machine has neither native Anvil nor a running Docker daemon, so neither local
runtime was started during this phase.

## Baseline probe

`@blocklab/rpc-probe` provides `probeRpc`. It uses bounded `fetch` requests,
records ISO start/end timestamps and latency, and categorizes:

- connection failures
- timeouts
- HTTP errors
- invalid JSON
- JSON-RPC errors
- invalid or unexpected chain IDs

Only the JSON-RPC method, sanitized endpoint origin, timestamps, latency,
success state, and safe error category/message are retained. Raw parameters
are not stored.

## Expected output

With Anvil running and `VITE_RPC_URL=http://127.0.0.1:8545`, the direct route
shows four successful reads with the reported chain ID `31337` and latest block,
plus measured per-request latency. With a worker configured, the Anon-RPC route
shows the same methods marked as harness-routed, and the comparison panel shows
both routes side by side.

Headless-browser verification of the same page (no automation dependency):

```powershell
node scripts/browser-selftest.mjs --url http://127.0.0.1:5173/ --timeout 200000
```

When the endpoint is unavailable, the page shows a categorized RPC error and
does not display the configured endpoint. When the worker fails to initialize,
the failure is shown with the harness message and no direct request is made.

## Limitations

- The sample has no wallet or transaction flow, and wallet/signing methods are
  rejected at runtime.
- It performs four fixed read-only requests on whichever route is selected.
- It does not claim resilience or failover.
- Anon-RPC routing is measured, but anonymity is not: `passthrough` is a
  reference worker with no privacy, `network` classification is the adopter
  list's claim, and exit IPs, observer views, and traffic analysis are out of
  scope. See [anon-rpc-poc.md](anon-rpc-poc.md).
- The proxy currently rejects JSON-RPC batches and transaction/signing methods.
- The runner does not forcibly terminate an uncooperative asynchronous task.
- Full `blocklab test rpc-blackout` orchestration and evaluator are planned for
  later phases.

## Phase 10 evidence

The runner returns redacted proxy records after an execution. The evidence
package normalizes those records with execution timestamps and the blackout
schedule, then evaluates baseline, fault, and recovery independently. This
proves proxy/request behavior only; it does not claim application-level
failover. Evidence can be written to a local versioned JSON file, replayed as
configuration with new IDs, and compared to another compatible run. No CLI
experiment command is provided yet.

The built CLI can run the same read-only request schedule without executing
the sample project's scripts:

```powershell
pnpm --filter blocklab build
node apps/cli/dist/index.js test rpc-blackout `
  --upstream http://127.0.0.1:8545
```

Use the printed execution ID with `runs show` or `report`. An explicit local
upstream is mandatory and the command does not claim recovery unless a
post-blackout request succeeds.
