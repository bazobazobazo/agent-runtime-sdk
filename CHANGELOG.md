# Changelog

All notable SDK changes are recorded here. The repository uses a synchronized
fixed version for the six public packages during the initial alpha series.

## 0.1.0-alpha.5 — release candidate, 2026-08-12

### Fixed

- OpenClaw status reconciliation now checks session history after a completed
  provider wait cycle even when the legacy wait response remains queued.
- Idle-session evidence is preserved so hosts can recover one safely
  correlated legacy reply without resubmitting the original prompt.

No package, tag, or GitHub release has been published by this candidate.

## 0.1.0-alpha.4 — release candidate, 2026-08-12

### Fixed

- OpenClaw history normalization now preserves the projected message ID,
  idempotency key, and numeric timestamp used by current gateway transcripts.
- Expired run reconciliation reports sanitized session activity and searches a
  bounded 1,000-message history window, allowing hosts to recover legacy
  untagged completions only after they apply their own acceptance correlation.

No package, tag, or GitHub release has been published by this candidate.

## 0.1.0-alpha.3 — release candidate, 2026-08-12

### Fixed

- OpenClaw accepted runs can be recovered across socket loss without replaying
  `chat.send`; reconnect transitions are bounded and serialized, and history fallback
  requires a unique exact run-ID correlation, including the persistent run
  identity projected by current OpenClaw `chat.history` responses.
- WebSocket request timeouts and send failures close suspect dispatchers, while
  terminal events already queued before closure remain observable.
- Caller cancellation now preserves its `RuntimeError` reason and poisons the
  in-flight dispatcher, preventing late responses from colliding with a reused
  deterministic request ID. Detection and Node WebSocket cleanup are bounded
  and force-terminate half-open sockets when supported.

No package, tag, or GitHub release has been published by this candidate.

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
