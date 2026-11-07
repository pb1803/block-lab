# Distribution and deployment readiness

## Architecture audit

The local CLI dependency graph is:

```text
@blocklab/core
├── @blocklab/inspector
├── @blocklab/scenarios
│   └── @blocklab/runner
├── @blocklab/evidence
└── @blocklab/local-agent

blocklab CLI -> core, inspector, scenarios, runner, evidence, local-agent
```

The CLI composes inspection, local experiment lifecycle, proxy, scenario
metadata, evaluation, and persistence. The npm build bundles these internal
workspace modules into one Node executable. Its remaining runtime imports are
Node.js built-ins; there are no external runtime dependencies or required
assets. `@blocklab/browser-rpc`, the Anon-RPC harness, Arkiv SDK, and Studio are
not part of the CLI bundle.

The CLI currently provides `inspect`, `scenarios`, `test`, `runs`, `report`,
`replay`, `compare`, and `config`. A test command starts one loopback-only RPC
proxy, runs its controlled read-only workload, persists redacted evidence, and
closes the proxy during runner cleanup. The proxy is not a persistent service.
There is deliberately no `blocklab start` command: a persistent proxy intended
to receive arbitrary dApp traffic needs a separately designed workload and
evidence lifecycle, so the existing experiment command is the supported path.

The CLI supports explicit loopback upstreams and a Quick Run workflow that
discovers common local RPC ports or starts a BlockLab-owned Anvil node when
Anvil is installed. Experiments do not execute dApp scripts. An installed CLI
contains the runner, RPC proxy, scenarios, inspector, and evidence logic.

The Local Agent remains an inspect-only workspace application. Its reusable
server module is also bundled into the npm CLI and is started with
`blocklab agent start <explicit-project-directory>`. It calls the safe
inspector, binds to loopback, and does not run experiments, launch processes, or
install dependencies.

Studio uses a typed browser client to exchange a short-lived launch capability
for an in-memory, project-scoped session after a CLI report handoff. The
capability is stored in the URL fragment for at most five minutes, is bounded
to eight exchanges, and is never sent as an HTTP URL or referrer. The session
token remains in the client closure and Authorization header only. Studio can
also manually pair with a standalone Local Agent using a one-time code.
Sessions are independently revocable and expire after ten minutes.

The Agent validates exact Origin and Host values and binds only to
`127.0.0.1`. CLI handoffs explicitly authorize the report project and the
configured evidence directory; bootstrap sessions cannot read other
authorized projects. Report APIs are authenticated, read-only, and return only
digest-verified evidence. The CLI defaults the allowlist to the exact deployed
Studio origin (`https://block-lab-eight.vercel.app`); standalone
`blocklab-agent` startup requires an exact `--allowed-origin` for that
deployed origin. A browser may still require explicit local-network permission
for an HTTPS-hosted Studio to access loopback. Studio never executes
experiments or stores evidence in the cloud.

## npm package

The workspace CLI package has private `workspace:*` development links for
typechecking and building. `pnpm build` creates `apps/cli/dist/blocklab.js`
with esbuild and stages a separate production manifest under
`apps/cli/dist/npm`. The staging manifest contains no workspace dependencies, and the stage copies
only the bundled executable, this README, and the MIT license. It does not copy
source, tests, environment files, local evidence, or workspace `node_modules`.
The generated `bin.blocklab` entry points to `./blocklab.js`, the executable
included in the tarball.

The generated package requires Node.js 24 or newer, follows the existing
repository runtime requirement, and uses the Node.js built-in APIs at runtime.
The public npm registry currently lists `blocklab@0.1.0`. The workspace CLI
manifest is being prepared for `0.2.0`; that version has not been published.
Nothing in this phase publishes the package.

From the repository root, build and inspect the package:

```powershell
pnpm install --frozen-lockfile
pnpm build
npm pack --dry-run ./apps/cli/dist/npm
npm pack ./apps/cli/dist/npm --pack-destination "$env:TEMP\blocklab-pack"
```

The generated tarball can be installed and invoked globally with
`npm install -g <path-to-tarball>`. Use `blocklab agent start
<project-directory>` for the inspect-only Local Agent, or
`blocklab test <scenario> --upstream <loopback-url>` to run an experiment.

## Vercel Studio deployment

`apps/studio/vite.config.ts` sets Vite dev port `5178`, preview port `5179`,
and static output directory `dist-app`. `vercel.json` configures the repository
root as the Vercel project root, a pnpm frozen-lockfile install, the
dependency-aware Studio build, the static output directory, and an SPA fallback
to `index.html`. The dependency-aware command was verified from the monorepo:

```powershell
pnpm --filter @blocklab/studio... build
```

Dashboard settings:

- **Root Directory:** repository root (`.`); do not enable “Include source
  files outside of the Root Directory” because the root workspace is the build
  context.
- **Install Command:** `pnpm install --frozen-lockfile`
- **Build Command:** `pnpm --filter @blocklab/studio... build`
- **Output Directory:** `apps/studio/dist-app`
- **Framework Preset:** Other (the repository `vercel.json` supplies commands
  and output).
- **Node.js Version:** 24.x, matching the repository requirement.
- **Environment variables:** none are required to build or load Studio.
  `VITE_ARKIV_ACCESS_KEY` is optional and enables the Arkiv gateway. Vite embeds
  `VITE_*` values into public JavaScript, so only use an access key explicitly
  intended to be public and rate-limit-only. Never configure a private key,
  seed phrase, wallet secret, or privileged credential. Without this optional
  value the Arkiv panel remains display-only. `VITE_RPC_URL` is used by the
  sample dApp, not by Studio.

Studio is static: no BLOCKLAB cloud execution backend is provisioned. The
wallet-mediated Arkiv feature still requires an explicit user action and
wallet approval. The static Studio deployment does not provide an execution
backend. CLI report handoffs configure the Local Agent to accept the exact
deployed Studio Origin for loopback read-only report access; standalone agents
must be configured with the desired allowed origin.

No production deployment has been performed.

## Developer journey and current end-to-end boundary

1. **Install BLOCKLAB:** `0.1.0` is published; `0.2.0` is prepared locally but
   remains unpublished. The generated `0.2.0` tarball can be validated without
   publishing.
2. **List scenarios:** `blocklab scenarios` and `blocklab scenarios --json`.
3. **Start a local Ethereum node:** Quick Run discovers a loopback RPC or
   starts an Anvil node managed by BLOCKLAB when Anvil is installed. Other
   flows accept an explicit loopback upstream; the sample dApp docs include
   Anvil commands.
4. **Point a dApp at a BLOCKLAB proxy:** not currently supported as a persistent
   proxy endpoint. `blocklab test` owns its proxy and sends its own controlled
   read-only requests, then closes it. The sample dApp's RPC endpoint currently
   points at the configured RPC upstream, not at a concurrently running
   BLOCKLAB process.
5. **Run an experiment:** supported from the installed CLI with an explicit
   loopback upstream and one of the implemented RPC fault scenarios. Quick Run
   discovers local loopback RPCs or starts a managed Anvil node when
   available, then starts the Local Agent and opens the scoped Studio report
   handoff.
6. **Inspect evidence:** supported locally with `runs list`, `runs show`,
   `report`, `replay`, and `compare`; evidence remains in the platform's local
   data directory by default.
7. **Publish compact metadata through Arkiv:** the Studio UI supports its
   wallet-mediated Arkiv workflow when configured. The CLI does not publish
   evidence or metadata to Arkiv.

Studio cannot trigger experiments. Any future experiment-control API would
need a separately reviewed design for explicit confirmation, strict schemas,
loopback target authorization, cancellation, cleanup, and disconnect states.
The current Local Agent exposes only project inspection and verified reports;
it has no execution endpoint. Arkiv metadata remains an optional
wallet-mediated feature. Anon-RPC remains browser-only. Swarm is not
implemented in this release.
