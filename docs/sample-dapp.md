# Sample dApp and local RPC

The sample dApp is a small Vite/TypeScript browser application in
[apps/sample-dapp](../apps/sample-dapp). It does not connect a wallet, sign,
broadcast transactions, or execute project scripts. It sends read-only
`eth_chainId` and `eth_blockNumber` requests to the configured endpoint.

## Run the sample

From the repository root:

```powershell
Copy-Item apps/sample-dapp/.env.example apps/sample-dapp/.env.local
pnpm --filter @blocklab/sample-dapp dev
```

Open the URL printed by Vite. Set `VITE_RPC_URL` in
`apps/sample-dapp/.env.local` to change the endpoint. Environment files are
ignored by Git. Do not put credentials in the endpoint or commit local
configuration.

The intended future flow is:

```text
sample dApp -> configurable RPC endpoint -> future BLOCKLAB local proxy -> Anvil
```

The proxy and fault injection are not implemented in this phase.

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

With Anvil running and `VITE_RPC_URL=http://127.0.0.1:8545`, the page shows:

```text
RPC connection successful.
Chain ID: 31337
Latest block: 0
Read latency: <measured milliseconds>
```

When the endpoint is unavailable, the page shows a categorized RPC error and
does not display the configured endpoint.

## Limitations

- The sample has no wallet or transaction flow.
- It currently performs one chain-ID read and one block-number read.
- It does not claim resilience or failover.
- The BLOCKLAB proxy, blackout scenario, and process lifecycle manager are
  planned for later phases.
