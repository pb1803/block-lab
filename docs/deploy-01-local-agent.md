# Local Agent

The Local Agent is an inspect-only Node process in `apps/local-agent`. The
standalone entrypoint supports manual pairing; the npm CLI can also start or
reuse it after Quick Run to provide an automatic, project-scoped Studio report
handoff. It does not execute package scripts, run experiments, or expose
arbitrary filesystem APIs to the browser.

## Starting the agent

Start a standalone agent with an explicit project directory:

```bash
pnpm --filter @blocklab/local-agent build
node apps/local-agent/dist/index.js E:\path\to\dapp
```

The agent binds to `127.0.0.1` on an ephemeral port and prints its URL and a
short-lived one-time pairing code. The code is held in memory and expires
after five minutes. The agent authorizes only the directory supplied at
startup; there is no browser-controlled path selection.

After a CLI experiment, the CLI starts or reuses the Agent and configures the
canonical project and local evidence directory. It opens Studio on the
selected report with a random, project-scoped launch capability in the URL
fragment. The hosted Studio exchanges the capability automatically; ordinary
Quick Run does not require the user to enter a pairing code. See the [Local
Runtime protocol](architecture/local-runtime-protocol.md) for capability and
session lifetimes and browser limitations.

## Protocol

- `GET /v1/health` reports agent identity and authorized project count.
- `POST /v1/pair` redeems a printed one-time code for a short-lived,
  in-memory session.
- `POST /v1/bootstrap` exchanges the CLI handoff capability for a
  project-scoped session.
- `GET /v1/projects` lists authorized project identifiers without returning
  filesystem contents.
- `POST /v1/projects/:projectId/inspect` invokes `@blocklab/inspector`.
- `GET /v1/projects/:projectId/reports` and
  `GET /v1/projects/:projectId/reports/:executionId` return verified,
  read-only reports from the configured evidence directory.
- `DELETE /v1/session` revokes the current session.

Browser requests must carry an exact allowed `Origin` and expected `Host`.
The server binds to loopback only, rejects unknown origins, limits request
bodies, rejects missing/expired/revoked tokens, and never logs tokens or
pairing codes. CLI report handoffs allow the exact deployed Studio Origin.
Standalone use should configure its exact Studio origin with
`--allowed-origin`. HTTPS-hosted Studio access to HTTP loopback may require a
browser local-network permission; BlockLab cannot bypass that browser policy.

Inspection uses the existing safe inspector. Sensitive environment files are
skipped, credential-shaped values are redacted, symlink entries are not
traversed, and project code is never executed. The response replaces the
absolute root path with a stable root identifier.

## Current limitations

- Authorization is configured when the process starts, not through an OS
  picker.
- Sessions are in memory and are invalidated by restart.
- The project list is not persisted.
- Public/private GitHub import is intentionally deferred. Cloning and
  credential handling require a separately reviewed capability.
- The Agent has no experiment execution endpoint; experiments remain
  CLI-only.

Studio reports connection errors explicitly and does not infer connectivity
from a localhost URL. Manual pairing remains available for standalone Agents
and advanced diagnostics; the CLI report handoff uses automatic bootstrap.
