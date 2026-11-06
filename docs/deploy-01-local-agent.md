# DEPLOY-01 Local Agent MVP

The Local Agent is a standalone Node process at `apps/local-agent`. This MVP
is intentionally inspect-only. It does not execute package scripts, spawn
processes, install dependencies, manage Anvil, run experiments, or expose
filesystem APIs to the browser.

## Starting the agent

Start it with an explicit project directory:

```bash
pnpm --filter @blocklab/local-agent build
node apps/local-agent/dist/index.js E:\path\to\dapp
```

The agent binds to `127.0.0.1` on an ephemeral port and prints its URL and a
short-lived pairing code. The code is held in memory and expires after five
minutes. The agent authorizes only the directory supplied at startup; there is
no browser-controlled path selection in this phase.

## Protocol

- `GET /health` reports agent identity and the count of explicitly authorized
  projects.
- `POST /pair` accepts the printed one-time code and returns an in-memory,
  32-byte bearer session token valid for 30 minutes.
- `GET /projects` lists authorized project identifiers without returning
  filesystem contents.
- `POST /projects/:projectId/inspect` invokes `@blocklab/inspector`.
- `POST /revoke` revokes the current session.

Browser requests must carry an allowed `Origin` (`127.0.0.1:5178` or
`localhost:5178` by default). The server binds to loopback only, rejects
unknown origins, limits request bodies, rejects missing/expired/revoked
tokens, and never logs tokens or pairing codes.

Inspection uses the existing safe inspector. Sensitive environment files are
skipped, credential-shaped values are redacted, symlink entries are not
traversed, and project code is never executed. The response replaces the
absolute root path with a stable root identifier.

## Current limitations

- Pairing is local and interactive; hosted Studio pairing is not implemented.
- Authorization is configured when the process starts, not through an OS
  picker.
- Sessions are in memory and are invalidated by restart.
- The project list is not persisted.
- Public/private GitHub import is intentionally deferred. Cloning and
  credential handling require a separately reviewed capability.
- The agent has no process or experiment permissions.

The browser Studio displays the agent as unavailable until pairing succeeds and
does not infer connectivity from a localhost URL.
