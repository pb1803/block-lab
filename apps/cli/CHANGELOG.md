# Changelog

## 0.2.0 — prepared, not published

- Add safe Quick Run defaults, loopback RPC discovery, and optional managed
  Anvil startup.
- Align the CLI and Local Agent on canonical `root-<hash>` project IDs.
- Start the inspect-only Local Agent after local experiment completion and
  generate a Studio report handoff using a short-lived, project-scoped bootstrap
  capability so Studio can connect without manual pairing.
- Stabilize Studio report access with independently revocable, short-lived
  Local Agent sessions; bearer tokens remain in memory and are never shared
  through browser storage or URLs.
- Verify persisted report integrity and display experiment metrics, evaluation,
  observations, and evidence status in Studio.
- Preserve one-time pairing codes, explicit project authorization, exact
  Origin checks, Host validation, and loopback-only binding.
- Keep experiment execution CLI-only; the Local Agent exposes read-only
  project, inspection, and verified report APIs.

The 0.2.0 package has not been published to npm.
