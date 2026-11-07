# blocklab

BLOCKLAB is a local-first Ethereum dApp inspection and RPC resilience testing
tool. The build creates a standalone npm package containing the CLI, experiment
engine, and inspect-only Local Agent runtime. Version 0.2.0 is prepared but not
published; the npm registry currently lists 0.1.0.

## Install

Node.js 24 or newer is required.

```powershell
npm install -g blocklab@0.2.0
blocklab
```

The 0.2.0 installation command becomes available after that version is
published. This repository change prepares the release but does not publish it.

The default command opens the interactive terminal menu when attached to a
TTY. In CI and other non-TTY environments, use the commands below; no prompt
is required.

The Quick Run menu detects an already-running loopback RPC on common local
ports, or starts a BlockLab-owned Anvil node when Anvil is installed. It asks
only for the scenario and uses validated safe defaults. Custom Configuration
keeps the advanced schedule and upstream controls available.
Project discovery checks the current directory and its parents for
`package.json`, `foundry.toml`, or Hardhat configuration without executing
project scripts.

From the repository root:

```powershell
pnpm build
node apps/cli/dist/index.js --help
```

For the npm-ready package, `pnpm build` stages it at
`apps/cli/dist/npm`. Preview it with
`npm pack --dry-run ./apps/cli/dist/npm`. The staged package requires Node.js
24 or newer and has no external runtime dependencies.

## Commands

```text
blocklab --help
blocklab version
blocklab inspect [directory] [--json]
blocklab scenarios [--json]
blocklab test <scenario> --upstream <loopback-url> [options]
blocklab runs list [--json]
blocklab runs show <run-id> [--json]
blocklab report <run-id> [--json]
blocklab studio <run-id> [project-directory]
blocklab compare <run-id-a> <run-id-b> [--json]
blocklab replay <run-id> --upstream <loopback-url> [options]
blocklab config [--json]
blocklab agent start <project-directory> [--allowed-origin <origin>]...
```

The six supported scenarios are `rpc-blackout`, `rpc-latency`,
`rpc-intermittent-failure`, `rpc-rate-limit`, `rpc-connection-failure`, and
`rpc-malformed-response`. Each experiment uses a temporary loopback proxy owned
by that command; there is no persistent RPC proxy service. The proxy uses an
explicit read-only JSON-RPC method allowlist and rejects unknown methods,
signing, transaction submission, and local node-control methods before
forwarding them.

After a successful Quick Run, BlockLab starts the loopback-only Local Agent,
authorizes only the discovered project and its evidence directory, and opens
the hosted Studio directly to the new report. Studio exchanges a short-lived
launch ticket automatically; the normal report flow does not require copying
an Agent URL or entering a pairing code. `blocklab studio <run-id>` provides
the same handoff for a previous report.

## Local Agent

Start the inspect-only agent with an explicit project directory:

```powershell
blocklab agent start .
blocklab agent start . --allowed-origin https://studio.example.test
```

The agent binds to `127.0.0.1`, preserves pairing/session expiry and request
validation, and accepts repeatable exact-origin allowlist flags. Without flags,
the existing local Studio development origins are used. It exposes project
listing, inspection, and verified report reads only; it does not execute
experiments, shell commands, or arbitrary filesystem operations. Stop it with
Ctrl+C or SIGTERM. Pairing codes are one-time and should be treated as secrets;
session tokens are never printed. Separate browser tabs may pair with separate
one-time codes; sessions are independent and are not shared through browser
storage.

The CLI-created Studio launch uses a random five-minute capability scoped to
one explicitly authorized project. It is carried only in the URL fragment,
which is not sent in HTTP requests or referrers, and the Studio exchanges it
for an in-memory ten-minute read-only session. The capability is bounded to
eight exchanges and becomes unusable when it expires or the Agent stops.
Sessions are independently revocable; the Local Agent still enforces the
exact hosted Studio Origin and Host, loopback binding, and report integrity
checks. Browser implementations may still require a local-network/private
network permission for a hosted HTTPS page to access loopback; BLOCKLAB cannot
bypass that browser security prompt.

Use the Projects page's manual pairing form only for standalone agents or as
an advanced recovery path. It accepts a one-time code and literal
`http://127.0.0.1` endpoint. Do not copy launch tickets or bearer tokens into
support logs.

## Evidence and security

Exit codes are stable: `0` for success, `2` for usage errors, `3` for operation
errors, and `4` when evidence is inconclusive.

Evidence is stored outside inspected projects by default in the platform data
directory (`%APPDATA%\blocklab\evidence` on Windows,
`~/Library/Application Support/blocklab/evidence` on macOS, or
`$XDG_DATA_HOME/blocklab/evidence` / `~/.local/share/blocklab/evidence` on
Linux). Override it with `--evidence-dir <path>` or
`BLOCKLAB_EVIDENCE_DIR`. Existing evidence is never overwritten by a new run.

BLOCKLAB is not a wallet and never handles private keys, seed phrases,
transaction signing, transaction submission, or `eth_sendTransaction`. It does
not upload evidence, execute arbitrary commands, or claim anonymization for
passthrough RPC. External Ethereum RPC infrastructure remains the user's
responsibility.

## Uninstall

```powershell
npm uninstall -g blocklab
```

The repository's distribution documentation contains additional clean-install
verification details and architecture boundaries.
