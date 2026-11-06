# UI-08 hybrid Studio / Local Agent architecture

## Boundary

The target deployment is a hosted browser Studio plus an installed Local Agent:

```text
Browser Studio
  -> authenticated, origin-validated local-agent protocol
  -> Local Agent
  -> inspector / runner / proxy / evidence
  -> local project and processes
```

The browser must never receive unrestricted filesystem or process access. The
Studio should consume typed snapshots and lifecycle events only.

The CLI remains first-class and may call the local packages directly. It does
not depend on the hosted Studio or agent.

## Agent responsibilities

The agent owns:

- project path selection after explicit user permission;
- safe plain-text inspection;
- process ownership and bounded startup/shutdown;
- runner preflight and loopback enforcement;
- proxy lifecycle and experiment execution;
- local evidence persistence;
- redacted event streaming.

The agent never executes imported repository scripts implicitly. Any future
script execution requires a separately reviewed capability, explicit approval,
resource limits, and an auditable policy.

## Browser responsibilities

The Studio owns:

- navigation and presentation;
- project and experiment selection;
- configuration review;
- confirmation UX;
- event/timeline rendering;
- report, replay, compare, and publish intent;
- Arkiv wallet interaction.

The browser Anon-RPC adapter remains a separate browser-only path. It must not
be proxied through the Node agent or imported into CLI/runner packages.

## Protocol shape

The initial protocol should be request/response plus server-sent events over a
single authenticated local session. Transport selection (loopback WebSocket,
WebTransport, or another reviewed mechanism) is an implementation decision,
not a reason to weaken the boundary.

Every request includes:

- protocol version;
- request ID;
- capability/action;
- project session ID;
- idempotency key for mutating commands.

Every event includes:

- protocol version;
- event ID and monotonic sequence;
- session ID;
- event timestamp;
- event type;
- redacted payload.

The agent rejects unknown versions, unknown capabilities, stale sessions,
duplicate mutating idempotency keys, and requests outside the granted project
scope.

## Pairing and authentication

Pairing must be explicit and short-lived:

1. The user starts the agent locally.
2. The agent displays a one-time pairing code or QR payload.
3. The hosted Studio displays the expected origin and asks the user to confirm.
4. Both sides establish an ephemeral session key.
5. The agent binds the session to the approved Studio origin and project
   capability set.
6. Disconnect, expiry, origin change, or agent restart invalidates the session.

Do not treat “localhost” as authentication. The agent must validate
`Origin`, use a narrow allowlist in production, reject cross-origin requests,
and keep pairing tokens out of URLs, logs, and persisted evidence.

## Permissions

Permissions are explicit and revocable:

- `project.read`: inspect selected files and metadata.
- `project.write`: not granted by default.
- `process.start`: disabled until a reviewed process policy exists.
- `experiment.run`: run only supported scenarios and approved targets.
- `evidence.read`: read local evidence summaries.
- `evidence.write`: persist redacted evidence.

A permission screen shows path scope, action, duration, and safety mode. The
agent enforces permissions server-side; UI controls are not security controls.

## Failure handling

- Lost connection does not imply success or failure; the UI shows unknown
  delivery and asks the agent for the authoritative run state.
- Mutating commands are idempotent and can be reconciled by request ID.
- Cancellation is cooperative and is followed by cleanup verification.
- Agent shutdown marks active runs as interrupted only after cleanup status is
  known.
- Protocol incompatibility blocks execution and explains the required agent
  version.
- No request is retried automatically if it could duplicate a signing or
  blockchain action.

## Deployment

Hosted Studio can be deployed as static assets or a web application. The agent
is distributed separately and updated independently with protocol compatibility
checks. No hosted service receives detailed traces by default. Optional Arkiv
publication contains only the validated compact metadata contract and requires
wallet authorization.

## Security review gates before implementation

Before any bridge is built, review origin validation, CSRF, DNS rebinding,
port discovery, pairing replay, session fixation, capability escalation,
path traversal, symlink handling, process injection, log redaction, and
version downgrade behavior. A convenient unauthenticated localhost endpoint is
not an acceptable intermediate implementation.
