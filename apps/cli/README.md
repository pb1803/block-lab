# blocklab

The BLOCKLAB CLI is a local-first Ethereum dApp inspection and RPC resilience
testing tool. Its source workspace package is private; the build creates a
standalone npm package containing the CLI and its internal runtime modules.
The package has not been published to npm.

From the repository root:

```powershell
pnpm build
node apps/cli/dist/index.js --help
```

For the npm-ready package, `pnpm build` stages it at
`apps/cli/dist/npm`. Preview it with
`npm pack --dry-run ./apps/cli/dist/npm`. The staged package requires Node.js
24 or newer and has no external runtime dependencies.

Commands include `blocklab scenarios`, `blocklab inspect`, `blocklab test`,
`blocklab runs`, `blocklab report`, `blocklab replay`, `blocklab compare`, and
`blocklab config`. Each experiment uses a temporary loopback proxy owned by
that command; there is no persistent `blocklab start` service. The proxy uses
an explicit read-only JSON-RPC method allowlist and rejects unknown methods,
signing, transaction submission, and local node-control methods before
forwarding them.

Exit codes are stable: `0` for success, `2` for usage errors, `3` for operation
errors, and `4` when evidence is inconclusive.

Evidence is stored outside inspected projects by default. Override the
directory with `--evidence-dir <path>` or `BLOCKLAB_EVIDENCE_DIR`.

See [distribution and deployment readiness](../../docs/distribution-and-deployment.md)
for clean-install verification, Vercel settings, architecture boundaries, and
known Studio/Local Agent limitations.
