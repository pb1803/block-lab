# Anon-RPC Browser POC

## Scope

Phase 12 verifies the browser harness boundary using
`@anon-rpc/browser-harness@0.4.0`. The harness is imported only by
`apps/anon-rpc-poc`; it is not imported by the CLI, runner, or shared
platform-neutral packages.

## Verified API

The installed package declarations and official wallet guide verify:

```ts
const worker = new AnonRpcWorker({
  address,
  preExisting: { rpcProvider },
});

await worker.ready;
const response = await worker.fetch(url, requestInit);
const log = await worker.acceptLog({ signal });
worker.close();
```

`worker.fetch` is a standard fetch-like function and is bound by the package.
The bootstrap provider is used once to read the worker specifier. Worker
initialization rejects when the specifier, resolver, hash verification, or
worker startup fails. `close()` is synchronous and tears down the sandbox.

## Browser procedure

1. Copy `.env.example` to `.env.local` and set
   `VITE_ANON_RPC_ENDPOINT` to a public endpoint that supports the four
   read-only methods.
2. Run `pnpm --filter @blocklab/anon-rpc-poc dev`.
3. Open the Vite URL in a real browser.
4. Click **Initialize worker** and confirm the readiness status.
5. Click **Run read-only checks**.
6. Record the displayed observations, including method, timestamps, duration,
   result status, error category, readiness, and harness receipt.
7. Click **Close worker** and confirm that the page remains usable.

The default worker address is the official passthrough example from the
Anon-RPC wallet guide:
`0x4fd77be300f31c5fe6ab266d35d27750a3478d27`.

## Verification status

The automated test suite uses a mock worker factory and verifies readiness
ordering, allowed methods, worker errors, log collection, cleanup, and absence
of ordinary-RPC fallback. It does not prove browser routing.

Real browser verification is **not claimed until the Vite app is opened and
executed against a reachable endpoint**. A failed bootstrap or request is
recorded as a harness/upstream failure or inconclusive result, never converted
to success.

The passthrough worker sends requests through ordinary `fetch` inside the
sandbox. It is not an anonymizing worker. Actual privacy routing, direct versus
Anon-RPC comparison, Viem transport integration, and default application
routing remain future work.

On 2026-11-05, the real browser run used
`https://ethereum-rpc.publicnode.com`: initialization succeeded, all four
read-only methods returned responses through the harness, and cleanup left the
page usable. The initial `https://cloudflare-eth.com` trial returned a
bootstrap JSON-RPC error and was correctly surfaced as an initialization
failure; it was not retried through an ordinary fallback.

## Safety and data handling

Only read-only JSON-RPC methods are sent:

- `eth_chainId`
- `eth_blockNumber`
- `eth_getBalance` for the zero address
- `eth_call` to the zero address with empty calldata

The UI stores method names, timestamps, durations, statuses, error categories,
and response results in memory only. It does not store raw request parameters,
wallet identifiers, credentials, cookies, tokens, or private keys. There is no
silent direct-RPC fallback.
