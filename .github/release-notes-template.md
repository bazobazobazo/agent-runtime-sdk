# Agent Runtime SDK {{VERSION}} (pre-alpha)

This is a release-candidate preview. Publication has not occurred until the protected
release workflow completes and the resulting npm/GitHub records are verified.
The reviewed prerelease channel is `next`; this alpha must not update `latest`.

## Highlights

- Provider-neutral adapter API for capabilities, sessions, runs, normalized
  streaming events, approvals, cancellation, history, health, normalized
  errors, and explicit `OUTCOME_UNKNOWN` reconciliation.
- OpenClaw wire protocol v3/v4 implementation.
- Bounded OpenClaw immediate-event replay and conservative terminal/history
  reconciliation for stateful v3/v4 chat completion.
- Hermes Runs HTTP/SSE implementation.
- Safe runtime detection and six explicit package boundaries.
- Shared conformance, deterministic testing utilities, 5,000-run fuzzing,
  resilience/stress hardening, and a gated live compatibility harness.
- ESM-only Node.js support, strict package/export boundaries, safe credential
  and network-policy ports, and deterministic release artifacts.
- Generic adapter-adoption guidance; durable host integration remains a
  separate application-owned layer.

## Evidence and limitations

- Compatibility is evidence-based; fake-server evidence is not live evidence.
- Hermes full live run/stream/approval/cancellation validation remains pending.
- The API is pre-alpha and has no stable guarantee before 1.0.
- Codex and Pi are not supported.
- ACP is not implemented.
- Image/file input and scheduling are capability-dependent.
- Host integration remains separate from SDK runtime communication.
- Runtime-specific behavior may change in upstream products.

Attach the release manifest, SHA-256 checksums, SPDX SBOM, compatibility report,
and adoption notes to a future draft GitHub release before final publication.
After approved publication, all six packages will use `{{VERSION}}` under the
`next` dist-tag.
