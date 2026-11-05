# Anon-RPC browser integration

## Scope and boundary

Anon-RPC is a browser-only integration. The official harness,
`@anon-rpc/browser-harness@0.4.0`, is imported by exactly one place:
the lazy loader inside `@blocklab/browser-rpc`. That package is consumed by
browser applications only.

```text
apps/sample-dapp ─┐
apps/anon-rpc-poc ─┼─> @blocklab/browser-rpc ──(lazy import)──> @anon-rpc/browser-harness
apps/studio*      ─┘
```

`apps/cli`, `@blocklab/runner`, `@blocklab/core`, and `@blocklab/evidence` do
not depend on `@blocklab/browser-rpc`. `blocklab --help` states that Anon-RPC is
browser-only and is never emulated by the CLI.
\* Studio does not use it yet.

## Verified harness API

Confirmed from the installed package declarations
(`dist/types/host/AnonRpcWorker.d.ts`, `@anon-rpc/harness-core` `spec-types.d.ts`)
and the official wallet guide:

```ts
const worker = new AnonRpcWorker({
  address,           // IWorkerSpecifier address
  config,            // optional, worker-defined plain value
  preExisting: { rpcProvider: { request } },
});

await worker.ready;                 // rejects if specifier/bundle/worker fails
const res = await worker.fetch(url, init);   // bound fetch-like function
const entry = await worker.acceptLog({ signal });
worker.close();                     // synchronous teardown
```

Resolution behaviour verified from `harness-core/src/specifier.ts`:

1. The bootstrap provider performs two `eth_call`s against the specifier
   address: `workerHash()` and `workerResolvers()`.
2. A resolver URL is fetched and `keccak256(bundle)` is compared with the
   on-chain hash. **The hash is the trust anchor, not the URL.**
3. `kps:` resolvers use the bundled WebRTC client; `https:` resolvers use
   ordinary HTTP.
4. Any failure (wrong chain, unresolvable specifier, hash mismatch, worker
   crash) rejects `ready`; the harness then fails all fetches rather than
   degrading to a direct request.

The specifier chain is not the chain being queried. `nox` lives on Sepolia
(11155111); `passthrough`, `tor-js`, and `nym` live on Ethereum mainnet (1).

## Worker registry

Transcribed verbatim from the official
[adopters.json5](https://github.com/ethereum/anon-rpc/blob/main/adopters.json5).
Nothing here is invented; `kind` is the adopter list's own classification.

| id | specifier | kind | chain | note |
|---|---|---|---|---|
| `passthrough` | `0x4fd77be300f31c5fe6ab266d35d27750a3478d27` | reference | 1 | ordinary fetch inside the sandbox — **not anonymizing** |
| `tor-js` | `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` | network | 1 | full Tor client in Wasm; needs a gateway config |
| `nym` | `0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0` | network | 1 | Nym mixnet client (~18 MB bundle) |
| `nox` | `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` | network | 11155111 | Sphinx mixnet; specifier read on Sepolia |

`tor-js` uses the demonstration gateway published in `adopters.json5`
(`152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ`). The
adopter file warns that this gateway has limited capacity and may disappear.

## Route architecture

```text
sample dApp
  ├── DirectRpcTransport ── fetch ──────────────────────────> RPC endpoint
  └── AnonRpcTransport ── worker.fetch ── sandboxed worker ──> RPC endpoint
                              │
                              └── bootstrap provider (one specifier read only)
```

Both transports implement one interface (`initialize`, `request`, `close`,
`state`, `label`) and share one JSON-RPC call path, so HTTP, JSON, JSON-RPC,
timeout, and cancellation handling is identical on both routes. The only
difference is the transport underneath.

Guarantees:

- Only `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, and `eth_call` are
  routable. Parameters are generated internally (zero address, `latest`), so no
  wallet identifier or caller-supplied parameter can leak into evidence.
- `eth_send*`, `eth_sign*`, `eth_accounts`, `personal_*`, and `wallet_*` throw a
  typed `unsupported-method` error at runtime, not just at compile time.
- There is no fallback path: a failed or closed harness returns `not-ready`
  observations and never performs a direct request.
- `receivedThroughHarness` is `true` only when the harness answered. A worker
  crash is reported as `worker`, not `connection`, so it cannot be mistaken for
  an upstream failure.
- Worker log entries are counted, never retained or displayed.

## Viem adapter

`@blocklab/browser-rpc/viem` exposes the same routes through Viem's standard
public client. Viem 2.x is an optional peer dependency; the main package entry
does not import it.

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

await client.getChainId();
await client.getBlockNumber();
await client.getBalance({ address });
await client.call({ to: contract, data: "0x18160ddd" });

route.close(); // owned worker
```

Design points:

- The adapter contains no RPC logic. It calls `requestResult`, which shares the
  engine, allowlist, timeout handling, and error classification with the
  observation path.
- Initialization stays lazy and memoized in the transport, so multiple clients
  built from one route share a single worker; separate routes never share one.
- `route.close()` is terminal. Viem clients have no disposal hook, so a client
  built from a closed route rejects with `not-ready` instead of silently
  re-initializing or falling back.
- Viem wraps unknown thrown values, so the adapter throws
  `BlocklabRpcError extends viem.BaseError` carrying `category` and the original
  `BrowserRpcError` as `cause`.
- Viem retries default to `0`; the Viem timeout is set above the transport
  timeout so the specific category wins.
- Caller parameters are validated: `eth_getBalance` takes
  `[address, blockTag?]`, `eth_call` takes `[callObject, blockTag?]`, call fields
  are allowlisted, and state overrides are refused. Parameters are never stored.
- Viem actions outside the four allowlisted methods fail with
  `unsupported-method`.

## Running the sample dApp

```powershell
pnpm install
pnpm build            # builds @blocklab/browser-rpc before the Vite apps
Copy-Item apps/sample-dapp/.env.example apps/sample-dapp/.env.local
pnpm --filter @blocklab/sample-dapp dev
```

`.env.local`:

```dotenv
VITE_RPC_URL=https://ethereum-rpc.publicnode.com
VITE_ANON_RPC_WORKER=passthrough   # passthrough | tor-js | nym | nox
# VITE_ANON_RPC_BOOTSTRAP_RPC_URL=https://ethereum-rpc.publicnode.com
```

Anon-RPC is the default selected route: the page initializes the worker on load
and routes eligible reads through it. Selecting **Direct RPC** is an explicit
user action, never an automatic fallback. **Compare routes** runs the same
four-method workload on both routes and renders success rate, average latency,
harness-routed count, coverage, and the privacy limitations. The serializable
payload is also exposed as `window.__blocklabComparison` for future Studio use.

The page also has a **Viem public client** section that runs
`getChainId`, `getBlockNumber`, `getBalance`, and one read-only contract `call`
through the selected route using `createPublicClient`.

The worker's readiness timeout defaults to 60 s because initialization includes
an on-chain read plus a bundle download (the `nym` bundle is ~18 MB and Tor
needs to build a circuit before the first response).

## Repeatable browser verification

`scripts/browser-selftest.mjs` drives headless Chrome over the DevTools protocol
using Node's built-in WebSocket client — no Playwright/Puppeteer dependency. It
opens the page with `?selftest=1`, runs both routes, and prints the payload.

```powershell
pnpm --filter @blocklab/sample-dapp dev -- --port 5173
node scripts/browser-selftest.mjs --url http://127.0.0.1:5173/ --timeout 200000
```

Exit codes: `0` result produced (check `ok` in the payload), `1` browser could
not be driven, `4` self-test did not finish in time.

## Verified browser results (2026-11-05)

Environment: Windows, HeadlessChrome/156.0.0.0, endpoint
`https://ethereum-rpc.publicnode.com`, four read-only methods.

| run | worker | direct | anon | harness-routed | coverage |
|---|---|---|---|---|---|
| A | `passthrough` (reference) | 4/4, avg 364.5 ms | 4/4, avg 941.0 ms | 4/4 | 100% |
| B | `tor-js` (network) | 4/4, avg 375.8 ms | 4/4, avg 2995.8 ms | 4/4 | 100% |
| C | `nox` with a mainnet bootstrap (deliberate mismatch) | 4/4, avg 400 ms | 0/4, init failed | 0/4 | 0% |

### Viem adapter runs (2026-11-05)

Same page, same endpoint, `?selftest=1`; each run adds the Viem public-client
probe on both routes (chain ID, block number, zero-address balance, empty
`eth_call`).

| run | worker | direct workload | anon workload | Viem direct | Viem anon |
|---|---|---|---|---|---|
| D | `passthrough` (reference) | 4/4, avg 247.8 ms | 4/4, avg 1015.5 ms | ok, block 26350471 | ok, block 26350471 |
| E | `tor-js` (network) | 4/4, avg 241.3 ms | 4/4, avg 1594.5 ms | ok, block 26350473 | ok, block 26350477 |
| F | `nox` with a mainnet bootstrap | 4/4 | 0/4, init failed | ok | not run (worker not ready) |

In run E the direct and Anon-RPC Viem probes returned different block numbers,
which is expected because each route issued its own real requests. Run F shows
that a failed worker leaves the Direct route usable while the Anon-RPC Viem probe
is skipped, with no fallback and no uncaught page error.

Run B per-method latency: `eth_chainId` 3632 ms, `eth_blockNumber` 1484 ms,
`eth_getBalance` 1920 ms, `eth_call` 4947 ms.

Run C verifies the failure boundary: the Sepolia specifier read against mainnet
returned `short bytes32 return`, initialization failed, all four Anon-RPC
attempts were `not-ready`, and **no direct request was made on the Anon-RPC
route**. The 4/4 direct result in that row comes from the separate deliberate
direct measurement.

A separate interactive check of `apps/anon-rpc-poc` (passthrough) exercised
initialize → four routed requests → close → page still usable, with latencies
1355/560/834/872 ms.

### Studio comparison view runs (2026-11-05)

`scripts/studio-view-check.mjs` drives headless Chrome the same way, waits for
the page to publish its snapshot, and then inspects the DOM that
`@blocklab/studio/comparison` rendered (route cards, method rows, coverage, Viem
cards, alert state). It does not re-run any request: Studio only renders the
payload the page already produced.

| run | worker | rendered routes | coverage | Viem cards |
|---|---|---|---|---|
| G | `passthrough` (reference) | direct ready 4/4, Anon ready 4/4, worker `passthrough` labelled *not anonymizing* | 100% | both succeeded |
| H | `tor-js` (network) | direct ready 4/4, Anon ready 4/4, worker `tor-js` labelled *network (declared anonymizing)* | 100% | both succeeded |
| I | `nox` with a mainnet bootstrap | direct ready 4/4, Anon `failed`, error `short bytes32 return` | 0% (4 skipped) | direct ok, Anon not run |

Run H sample row: `eth_chainId` succeeded on both routes with separate measured
latencies and harness-routed `yes`. Run I sample row: `eth_chainId` failed on
the Anon route with category `not-ready`, harness-routed `no`, and the summary
line read "Anon-RPC did not become ready; no harness request was attempted and
no fallback occurred". A failed attempt's duration renders as `0 ms (failed)`
rather than a plain latency.

Live refresh was verified without the self-test flag: the page opened on
"No comparison yet" (140 characters), **Compare routes** was clicked, and the
same panel re-rendered both routes and the four method rows (1989 characters) —
no reload, no polling in Studio. Injecting `{ schemaVersion: "1.0", comparison:
null }` into `window.__blocklabStudioSnapshot` replaced the panel with a
`role="alert"` block listing the issue, with zero fabricated rows.

### Export verification (2026-11-05)

`scripts/studio-export-check.mjs` performs a real comparison, clicks **Export
JSON**, and reads the file Chrome actually wrote. It also records every network
request made after the click.

| run | worker | button | downloaded artifact | requests during export |
|---|---|---|---|---|
| L | `passthrough` (reference), self-test | disabled before, enabled after | `completeness: complete`, 4/4 on both routes, coverage 100%, worker classified *not anonymizing* | 0 |
| M | `passthrough`, interactive Compare routes | disabled before, enabled after | `completeness: complete`, coverage 100% | 0 |
| N | `tor-js` (network), self-test | disabled before, enabled after | `completeness: failed`, reason "Worker did not become ready within 60000ms", no fallback | 0 |
| O | `nox` with a mainnet bootstrap | disabled before, enabled after | `completeness: failed`, reason `short bytes32 return`, no fallback | 0 |

Run N was a real failure: the `tor-js` gateway did not become ready twice in a
row at the time of verification. The export was still produced and is labelled
`failed` with reasons, which is the intended behaviour; no completed network-worker
run is claimed for this date.

The downloaded JSON for run L was inspected directly: top-level keys
`schemaVersion, kind, exportedAt, direct, anonRpc, methods, coverage, viem,
runtime, limitations, redaction, run`; `run.runId` = `rpc-<16 hex>`; four direct
and four Anon-RPC attempts; `runtime.origin` = `http://127.0.0.1:5210`; no
endpoint host, token, `Bearer` value, parameter, header, account, or private-key
field. The panel confirmed `Exported blocklab-rpc-comparison-…json (complete)`,
and `window.__blocklabComparison` / `window.__blocklabStudioSnapshot` were
byte-identical before and after the click.

A real bug was found and fixed during this verification: revoking the Blob object
URL synchronously after `click()` aborted the download in Chrome (the file stayed
`.crdownload`). Revocation is now deferred; the unit tests assert the deferred
order and the browser run downloads a complete file.

## What these numbers do and do not show

They show that eligible read-only calls were routed through a hash-pinned,
sandboxed worker, and that the harness (not a direct fetch) produced the
responses. They show the measurable cost of that routing: roughly 2.6× latency
for the reference worker and roughly 8× for `tor-js` in this sample.

They do **not** show anonymity. BLOCKLAB does not measure the exit IP, the
observer's view, resistance to traffic analysis, endpoint honesty, or
censorship resistance. A `reference` worker performs an ordinary fetch inside
the sandbox and provides no privacy at all. `network` classification is the
adopter list's claim, not something this test verifies. Latency is a transport
measurement and must never be read as a privacy signal.

## Failure behaviour (implemented and tested)

- Initialization failure: surfaced with the harness message, worker closed, all
  requests report `not-ready`, no fallback.
- Readiness timeout: `initialization`/`timeout` error, worker closed.
- Repeated `initialize()`: one worker, no duplicate sandbox.
- Retry after failure: previous worker closed before a new one starts.
- `close()` during initialization: stays `closed`, does not resurrect as
  `failed`.
- Request cancellation and timeout: `aborted`/`timeout`, timers cleared.
- Unsupported/wallet methods: typed rejection before any network activity.
- Error messages: embedded URLs reduced to their origin, query strings dropped,
  length capped.

## Known limitations

- No Studio view for the comparison payload yet (`ANON-08`).
- The Viem adapter supports the four allowlisted methods only; Viem actions that
  need other methods (for example `estimateGas`, `getTransactionReceipt`, or
  `multicall`) fail with `unsupported-method`.
- Viem's request function carries no abort signal, so a cancelled Viem call
  cannot cancel the in-flight request; BLOCKLAB's timeout and `close()` still
  bound it.
- `nym` and `nox` were not exercised successfully; only `passthrough` and
  `tor-js` produced verified routed reads. `nox` was only used to verify the
  failure path.
- Anonymity properties of `tor-js`/`nym`/`nox` are not independently verified.
- The demonstration Tor gateway may disappear; a durable setup needs a
  self-hosted gateway.
- Headless Chrome runs are real browser executions but not a full manual UI
  walkthrough; the interactive POC check covers the click path.
