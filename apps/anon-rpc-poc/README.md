# Anon-RPC browser POC

This isolated Vite application verifies the browser-only
`@anon-rpc/browser-harness@0.4.0` boundary through the shared
`@blocklab/browser-rpc` transports. The harness is not imported by the CLI or
Node.js runner.

## Run

```powershell
pnpm install
pnpm build
$env:VITE_ANON_RPC_ENDPOINT="https://ethereum-rpc.publicnode.com"
pnpm --filter @blocklab/anon-rpc-poc dev
```

The endpoint is used both as the one-time bootstrap provider and as the
destination passed to the harness. Set `VITE_ANON_RPC_WORKER` to one of the
official adopter workers: `passthrough`, `tor-js`, `nym`, or `nox`. The default
is the official passthrough worker. Worker addresses and classifications are
maintained in `@blocklab/browser-rpc`, transcribed from the official
[adopters.json5](https://github.com/ethereum/anon-rpc/blob/main/adopters.json5).

The page explicitly initializes the transport, awaits worker readiness, runs
only `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, and `eth_call`,
displays redacted observations, and closes the worker. There is no ordinary-RPC
fallback when initialization or a harness request fails.

The official passthrough worker demonstrates sandboxing and hash-pinned worker
loading only. It does **not** provide anonymizing routing. The UI labels each
worker as `reference` or `network` and never describes a reference worker as
anonymizing.

The automated tests live in `@blocklab/browser-rpc` and use a mocked worker
factory. They are not a substitute for the real browser verification described
in [docs/anon-rpc-poc.md](../../docs/anon-rpc-poc.md).