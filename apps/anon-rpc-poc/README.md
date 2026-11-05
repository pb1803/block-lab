# Anon-RPC browser POC

This isolated Vite application verifies the browser-only
`@anon-rpc/browser-harness@0.4.0` API. It does not import the harness into the
CLI or Node.js runner.

## Run

```powershell
pnpm install
$env:VITE_ANON_RPC_ENDPOINT="https://ethereum-rpc.publicnode.com"
pnpm --filter @blocklab/anon-rpc-poc dev
```

The endpoint is used both as the one-time bootstrap provider and as the
destination passed to the harness. Set `VITE_ANON_RPC_WORKER_ADDRESS` only when
using a different specifier. The default address is the official passthrough
worker example from the Anon-RPC wallet guide.

The page explicitly initializes the worker, awaits `worker.ready`, runs only
`eth_chainId`, `eth_blockNumber`, `eth_getBalance`, and `eth_call`, displays
redacted observations, collects worker logs, and closes the worker. There is no
ordinary-RPC fallback when initialization or a harness request fails.

The official passthrough worker demonstrates sandboxing and hash-pinned worker
loading only. It does **not** provide anonymizing routing. This POC therefore
does not claim privacy, anonymity, censorship resistance, or failover.

The automated tests use a mocked worker factory. They are not a substitute for
the real browser verification described in [docs/anon-rpc-poc.md](../../docs/anon-rpc-poc.md).
