# Distribution and deployment readiness

## Architecture audit

The local CLI dependency graph is:

```text
@blocklab/core
├── @blocklab/inspector
├── @blocklab/scenarios
│   └── @blocklab/runner
└── @blocklab/evidence

blocklab CLI -> core, inspector, scenarios, runner, evidence
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

The CLI needs an explicit loopback upstream. Its experiments can run outside
the monorepo after npm installation; they do not execute dApp scripts or
manage Anvil. An installed CLI contains the runner, RPC proxy, scenarios,
inspector, and evidence logic.

The Local Agent is a separate, inspect-only workspace application. In a source
checkout it can be started with Node after building, and it calls the safe
inspector. It is not included in the npm CLI package and does not run
experiments, launch processes, or install dependencies.

Studio uses a typed browser client to manually pair with a known Local Agent
URL and one-time code, then list and inspect explicitly authorized projects.
The agent validates an allowlisted browser origin and uses an in-memory bearer
session. Studio has no discovery mechanism and cannot request experiments,
execution status, or evidence from the agent. Its default allowed origins are
the local development origins; the current agent executable has no origin
configuration option for a deployed Studio origin. Consequently, remote
Vercel-to-agent pairing is not a supported workflow yet.

## npm package

The workspace CLI package has private `workspace:*` development links for
typechecking and building. `pnpm build` creates `apps/cli/dist/blocklab.js`
with esbuild and stages a separate production manifest under
`apps/cli/dist/npm`. The staging manifest contains no workspace dependencies,
and the stage copies only the bundled executable, this README, and the MIT
license. It does not copy source, tests, environment files, local evidence, or
workspace `node_modules`.

The generated package requires Node.js 24 or newer, follows the existing
repository runtime requirement, and uses the Node.js built-in APIs at runtime.
The npm command name `blocklab` returned HTTP 404 from the public npm registry
when checked on 2026-11-06; recheck name availability and account ownership
before any future publication. Nothing in this phase publishes the package.

From the repository root, build and inspect the package:

```powershell
pnpm install --frozen-lockfile
pnpm build
npm pack --dry-run ./apps/cli/dist/npm
npm pack ./apps/cli/dist/npm --pack-destination "$env:TEMP\blocklab-pack"
```

The generated tarball can be installed and invoked globally with
`npm install -g <path-to-tarball>`. The package has no persistent service
command; use `blocklab test <scenario> --upstream <loopback-url>` to run an
experiment, or `blocklab scenarios` to list supported scenarios.

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
wallet approval. Static deployment does not change the Local Agent's
development-origin allowlist or add remote experiment execution.

No production deployment has been performed.

## Developer journey and current end-to-end boundary

1. **Install BLOCKLAB:** locally validated from a generated npm tarball; public
   npm publication has not happened.
2. **List scenarios:** `blocklab scenarios` and `blocklab scenarios --json`.
3. **Start a local Ethereum node:** use Anvil/Hardhat separately. BLOCKLAB does
   not install or manage it. The sample dApp docs include Anvil commands.
4. **Point a dApp at a BLOCKLAB proxy:** not currently supported as a persistent
   proxy endpoint. `blocklab test` owns its proxy and sends its own controlled
   read-only requests, then closes it. The sample dApp's RPC endpoint currently
   points at the configured RPC upstream, not at a concurrently running
   BLOCKLAB process.
5. **Run an experiment:** supported from the installed CLI with an explicit
   loopback upstream and one of the implemented RPC fault scenarios.
6. **Inspect evidence:** supported locally with `runs list`, `runs show`,
   `report`, `replay`, and `compare`; evidence remains in the platform's local
   data directory by default.
7. **Publish compact metadata through Arkiv:** the Studio UI supports its
   wallet-mediated Arkiv workflow when configured. The CLI does not publish
   evidence or metadata to Arkiv.

Before Studio can trigger local experiments, the smallest safe next design is
an explicitly paired Local Agent capability limited to selecting a supported
scenario, validating a loopback upstream and bounded configuration, returning
execution status, and exposing only validated redacted evidence. It needs a
deployed-origin allowlist, strict request schemas, one active execution per
session (or an explicit concurrency policy), cancellation and cleanup, and
browser states for disconnect/failure. It must not add arbitrary commands,
filesystem access, dependency installation, signing, or transaction methods.
This is a product/security design blocker, not functionality provided by this
package or this deployment configuration.
