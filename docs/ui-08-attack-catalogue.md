# UI-08 attack catalogue audit

The Studio must show implementation truth, not a generic vulnerability score.
Each scenario card has status, target scope, prerequisites, safety boundary,
evidence produced, and limitations.

| Scenario | Repository status | Studio treatment |
|---|---|---|
| RPC blackout | Implemented and verified locally | Available in Attack Lab. Show loopback target, blackout interval, baseline/fault/recovery evidence, cleanup, replay, and compare. |
| RPC latency injection | Not implemented | Planned. Do not expose a launch control. |
| Intermittent RPC failure | Not implemented | Planned. Do not expose a launch control. |
| Malformed JSON-RPC response | Not implemented | Planned. Requires a separate bounded response-fixture policy. |
| HTTP 429/rate limiting | Not implemented | Planned. Must distinguish proxy-generated HTTP errors from upstream behavior. |
| Chain ID mismatch | Not implemented as a runner scenario | Planned. Keep wallet/network safety separate from fault injection. |
| Stale RPC data | Not implemented | Planned. Requires explicit data freshness semantics and evidence. |
| Secondary RPC failover | Not implemented | Planned. Must measure application failover, not merely proxy restoration. |

## Verified RPC blackout contract

The current runner owns a loopback-only proxy and a bounded blackout window.
The CLI sends read-only `eth_chainId` observations and persists redacted
evidence. The evaluator requires a healthy baseline, an injected blackout
observation, and successful post-window recovery. A restored proxy is not
reported as application failover.

The Studio redesign should consume the existing runner/evidence contracts
through a local-agent adapter. It must not reimplement the proxy or invent
application observations.

## Scenario-card requirements

Every card should show:

- status: verified, partial, planned, blocked, or unsupported;
- exact methods and targets affected;
- local/staging authorization mode;
- preflight checks;
- expected evidence;
- cancellation and cleanup behavior;
- known false positives/negatives;
- whether the result says anything about application resilience.

Unavailable scenarios must remain visible as planned catalogue entries but
must not have an executable button.

## Safety rules

Attack Lab defaults to loopback targets. Staging requires a future explicit
authorization interface and must remain disabled until that infrastructure
exists. No scenario card may request private keys, wallet seeds, signing
credentials, or arbitrary repository script execution.
