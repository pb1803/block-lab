# blocklab

The BLOCKLAB CLI is a local-first Ethereum dApp inspection and RPC resilience
testing tool. It is buildable for future npm publication; it has not been
published to npm.

From the repository root:

```powershell
pnpm --filter blocklab build
node apps/cli/dist/index.js --help
```

Evidence is stored outside inspected projects by default. Override the
directory with `--evidence-dir <path>` or `BLOCKLAB_EVIDENCE_DIR`.

The package currently references BLOCKLAB workspace packages and is not
published to npm. Those workspace packages must be published or bundled before
an external npm installation can work.
