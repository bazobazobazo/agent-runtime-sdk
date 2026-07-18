# Changelog

All notable SDK changes are recorded here. The repository uses a synchronized
fixed version for the six public packages during the initial alpha series.

## 0.1.0-alpha.1 — release candidate, 2026-07-15

### Added

- Provider-neutral runtime contracts for sessions, runs, events, approvals,
  cancellation, health, capabilities, `OUTCOME_UNKNOWN`, and normalized errors.
- OpenClaw wire protocol v3 and v4 implementation.
- Capability-negotiated OpenClaw images/files and full schedule lifecycle with
  uncertain-acceptance reconciliation.
- Hermes Runs HTTP/SSE implementation.
- Safe runtime detection, adapter conformance, fuzz/resilience hardening, and an
  opt-in live compatibility harness.
- Six ESM-only Node.js packages, testing utilities, strict package boundaries,
  deterministic release artifacts, and protected trusted-publishing preparation.
- Generic runtime-adapter adoption and host application integration guidance.

### Fixed

- OpenClaw v3/v4 completion now recognizes stateful `chat` events and
  `agent.wait` status values used by real gateways, replays bounded events that
  arrive before stream subscription, and reconciles terminal runs against an
  unambiguous pre-run history baseline without weakening `OUTCOME_UNKNOWN`.

### Known limitations

- Pre-alpha API with no stable compatibility guarantee before 1.0.
- Hermes full live run/stream/approval/cancellation validation remains pending.
- Codex and Pi are unsupported private placeholders.
- ACP is not implemented. Image/file input and scheduling are capability-dependent.
- Durable host application integration remains a separate ownership layer.
- Runtime-specific behavior may change in upstream products.

No package, tag, or GitHub release has been published by this candidate.
