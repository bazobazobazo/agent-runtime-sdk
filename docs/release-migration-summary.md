# v0.1.0-alpha.1 migration summary

Replace `@telegraphic-dev/openclaw-gateway-client` with the explicit
`@banzae/agent-runtime-openclaw` adapter and matching
`@banzae/agent-runtime-core` version after approved publication.

Migration requires explicit adapter construction, credential references,
protocol negotiation, normalized session/run handles, stable application IDs and
idempotency keys, normalized event/error handling, capability checks, cancellation,
and history access only when advertised. Images and files remain unsupported when
the runtime capability is absent.

Use feature flags and a legacy fallback during rollout. Shadow mode may compare
read-only detection or normalized observations, but must never send the same
side-effecting prompt through both implementations. Full guidance is in
`migration-from-telegraphic.md`.
