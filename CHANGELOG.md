# Changelog

All notable SDK changes are recorded here. The repository uses a synchronized
fixed version for the six public packages during the initial alpha series.

## Unreleased

### Release engineering

- Prepared Changesets, metadata, archive validation, clean consumers, SBOM,
  checksums, reproducibility checks, and protected trusted-publishing workflow.
- No package, tag, or GitHub release has been published.

## 0.1.0-alpha.1 — planned

### Added

- Provider-neutral runtime contracts for sessions, runs, events, approvals,
  health, capabilities, and normalized errors.
- OpenClaw wire protocol v3 and v4 implementation.
- Hermes Runs HTTP/SSE implementation.
- Safe runtime detection, adapter conformance, fuzz/resilience hardening, and an
  opt-in live compatibility harness.

### Known limitations

- Pre-alpha API with no stable compatibility guarantee before 1.0.
- Hermes full live run/stream/approval/cancellation validation remains pending.
- Codex and Pi are unsupported private placeholders.
- Image/file input is capability-dependent; scheduling is outside the core SDK.
- BanzaeForge application integration is a separate ownership layer.
