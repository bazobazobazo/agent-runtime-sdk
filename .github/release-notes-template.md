# Agent Runtime SDK {{VERSION}} (pre-alpha)

This is a release-note preview. Publication has not occurred until the protected
release workflow completes and the resulting npm/GitHub records are verified.

## Highlights

- Provider-neutral runtime API for sessions, runs, normalized events,
  approvals, health, capabilities, cancellation, history, and errors.
- OpenClaw wire protocol v3/v4 implementation.
- Hermes Runs HTTP/SSE implementation.
- Safe runtime detection and six explicit package boundaries.
- Shared conformance, deterministic fakes, fuzz/resilience hardening, and a
  gated live compatibility harness.

## Evidence and limitations

- Compatibility is evidence-based; fake-server evidence is not live evidence.
- Hermes full live run/stream/approval/cancellation validation remains pending.
- The API is pre-alpha and has no stable guarantee before 1.0.
- Codex and Pi are not supported.
- Image/file input is capability-dependent.
- BanzaeForge integration is separate, and the core SDK has no scheduling API.

Attach the release manifest, SHA-256 checksums, SPDX SBOM, compatibility report,
and migration notes to a future draft GitHub release before final publication.
