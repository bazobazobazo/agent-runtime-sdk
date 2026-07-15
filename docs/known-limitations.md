# v0.1.0-alpha.1 known limitations

Status: release-candidate limitations; publication has not occurred.

- The API is pre-alpha. There is no stable or 1.0 compatibility promise.
- Runtime compatibility is evidence-based and limited to the exact evidence
  classifications, runtime versions, protocols, and dates in the compatibility matrix.
- Hermes is implemented and fake-server validated, but complete live
  run/stream/approval/cancellation validation remains pending.
- Codex and Pi are unsupported private placeholders. ACP is not implemented.
- The core SDK has no common scheduling API.
- Image and file input support is capability-dependent and may be rejected
  before provider activity.
- Forge integration, durable orchestration, persistence, billing, authorization,
  and scheduling remain outside this SDK release.
- Runtime-specific behavior may change in upstream OpenClaw or Hermes products.
- npm trusted-publishing and GitHub protection settings require operator
  verification before publication can be approved.
