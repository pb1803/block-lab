# @blocklab/browser-rpc

Browser-only RPC routing for BLOCKLAB. It exposes one interface over two
independent routes and a Viem adapter for applications that already use Viem.

- **Direct route** (`DirectRpcTransport`): ordinary `fetch` to the configured
  endpoint. This is the control, never a fallback.
- **Anon-RPC route** (`AnonRpcTransport`): the request is performed by a
  hash-pinned worker inside a browser sandbox, loaded lazily from
  `@anon-rpc/browser-harness`.

This package is imported only by browser applications. `apps/cli`,
`@blocklab/runner`, `@blocklab/core`, and `@blocklab/evidence` must not import
it: it owns the browser-only harness dependency.

## Entry points

```ts
import {
  AnonRpcTransport,
  DirectRpcTransport,
  findWorker,
  runWorkload,
  buildComparison,
} from "@blocklab/browser-rpc";

// Optional adapter entry; requires viem (optional peer dependency).
import { createViemRoute } from "@blocklab/browser-rpc/viem";
```

## Supported methods

`eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_call`.

Wallet, signing, and transaction methods (`eth_send*`, `eth_sign*`,
`eth_accounts`, `personal_*`, `wallet_*`) are rejected at runtime with category
`unsupported-method`. Parameters are validated against fixed read-only shapes
(`[address, blockTag?]`, `[callObject, blockTag?]`); `eth_call` state overrides
are refused. Parameters are never retained in observations or evidence.

## Transport lifecycle

```ts
const transport = new DirectRpcTransport({ endpoint }); // ready immediately
await transport.initialize();   // idempotent; required for Anon-RPC
const observation = await transport.request("eth_chainId"); // no throwing
const raw = await transport.requestResult("eth_chainId");   // throws typed errors
transport.close();              // terminal
```

- `request()` returns a serializable observation and never throws for RPC-level
  failures; use it for measurements and evidence.
- `requestResult()` returns the raw JSON-RPC result and throws
  `BrowserRpcError` with a `category`; use it from adapters.
- `initialize()` is memoized: concurrent callers share one attempt. Anon-RPC
  performs the on-chain specifier read and the bundle download here.
- An initialization failure sets `failed`; a later `initialize()` retries with a
  fresh worker. A **closed** transport is terminal and never resurrects a
  worker.
- `close()` aborts log collection, closes the worker, and makes later requests
  fail with `not-ready`. There is no fallback at any point.

## Viem adapter

`@blocklab/browser-rpc/viem` wraps a transport as a Viem
`createTransport`-based transport. Viem 2.x is an optional peer dependency
(`^2.0.0`); the main entry point never imports it.

```ts
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { createAnonViemRoute } from "@blocklab/browser-rpc/viem";

const route = createAnonViemRoute({
  endpoint: "https://ethereum-rpc.publicnode.com",
  bootstrapRpcUrl: "https://ethereum-rpc.publicnode.com",
  worker: findWorker("passthrough")!,
});

const client = createPublicClient({ chain: mainnet, transport: route.transport });

const chainId = await client.getChainId();
const blockNumber = await client.getBlockNumber();
const balance = await client.getBalance({ address });
const result = await client.call({ to, data: "0x18160ddd" });

route.close();
```

Exports:

| Export | Purpose |
|---|---|
| `createViemRoute(instance, options?)` | Wrap an existing transport you own |
| `createDirectViemRoute(options, adapter?)` | Create + wrap a `DirectRpcTransport` |
| `createAnonViemRoute(options, adapter?)` | Create + wrap an `AnonRpcTransport` |
| `BlocklabViemRoute` | `{ transport, instance, route, state, initialize, request, close }` |
| `BlocklabRpcError` | Viem `BaseError` carrying the BLOCKLAB `category` and the original error as `cause` |
| `isBlocklabRpcError(error)` | Narrowing helper for both error classes |

`ViemAdapterOptions`: `key`, `name`, `retryCount` (default **0**),
`retryDelay`, `timeoutMs` (default: transport timeout + 5 s so BLOCKLAB's
classification wins).

### Ownership and lifecycle

- A `BlocklabViemRoute` **owns** the transport it created. `route.close()` is
  the only correct disposal path; the route does not close itself, and Viem has
  no client-disposal hook.
- The Viem transport initializes the underlying transport lazily on the first
  request and memoizes it in the transport, so any number of clients created
  from the same route share exactly one worker. Creating a second route creates
  a second, independent worker.
- There is no process-wide singleton and no hidden global state.
- Closing a route while one client is still polling simply makes that client's
  next call reject with `not-ready`; it never re-routes to direct or silently
  creates a new worker. Create a new route to resume.
- Initialization errors propagate through the first Viem call as
  `BlocklabRpcError` with `category: "initialization"`.

### Error classification

Viem re-throws its own `BaseError` subclasses and wraps anything else in
`UnknownRpcError`, so the adapter converts `BrowserRpcError` into
`BlocklabRpcError extends BaseError`. Callers can read:

```ts
try {
  await client.getBlockNumber();
} catch (error) {
  if (isBlocklabRpcError(error)) {
    console.log(error.category);      // not-ready | timeout | worker | ...
    console.log(error.cause);         // original BrowserRpcError
  }
}
```

### Behavior differences from a normal Viem transport

- Viem-level retries default to `0`; a failure is reported once.
- Viem's `request` has no abort signal, so an aborted Viem call cannot cancel
  the in-flight request. BLOCKLAB's own timeout (and `close()`) still bounds it.
- Requests before readiness are not queued: the adapter initializes first, so a
  direct-only workload pays no harness cost and an Anon-RPC workload waits for
  readiness instead of returning a spurious `not-ready`.
- Anonymous-route transports only answer the four allowlisted methods; any
  other Viem action fails with `unsupported-method` even if Viem would normally
  call something else (for example `eth_estimateGas`).

## Privacy and measurement limits

Latency and success rate are transport measurements, not privacy measurements.
`passthrough` is a reference worker with no anonymity. `network` workers are
classified as network workers by the official adopter list; BLOCKLAB does not
verify exit IPs, observer views, or traffic analysis, and makes no anonymity
claim.

Repository-level context and browser verification results live in
[`docs/anon-rpc-poc.md`](../../docs/anon-rpc-poc.md).
