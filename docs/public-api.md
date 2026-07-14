# Public API Contract

Status: pre-alpha public API frozen for `v0.1.0-alpha.1`. This is not a stable
1.0 contract. Breaking changes during `0.x` require migration notes;
experimental entrypoints may change more frequently.

## Package boundaries

- `core`: provider-neutral adapter, lifecycle, capability, session, run, event,
  health, error, transport-port, security-limit, registry, and target contracts.
- `detection`: side-effect-free detector, probe results, cache/store, credential
  provider, and network policy.
- `openclaw`: OpenClaw adapter and factory. Version codecs and frames live under
  `/experimental` for adapter authors, not application code.
- `hermes`: Hermes adapter, factory, session mode, and documented extension
  types. Schemas and SSE utilities live under `/experimental`.
- `node`: Node fetch/WebSocket implementations, stores, crypto, environment
  credential provider, network policy, and default registry.
- `testing`: conformance suite, deterministic tools, fake controllers, live
  report utilities, and resource assertions. It is not production infrastructure.

Core diagnostics use `/diagnostics`; adapter-authoring helpers use
`/experimental`; core test ports use `/testing`. Deep imports are blocked. All
packages are ESM-only in this alpha.

## Adapter lifecycle

Every adapter exposes `lifecycleState`:
`created -> connecting -> connected -> closing -> closed`.

- Before connection, `capabilities()` is fully disabled and `health()` is
  `unavailable`; operational methods reject with `INVALID_CONFIGURATION`.
- A repeated `connect()` to the current target is idempotent.
- `close()` is idempotent, aborts active operations, and waits for cleanup.
- A closed adapter may reconnect through `connect()`.
- Concurrent operations have independent caller signals. Adapter close cancels
  all work; cancelling one operation does not cancel another.

## IDs and timestamps

Public names separate `applicationSessionId`, `externalSessionId`,
`applicationRunId`, `externalRunId`, normalized `eventId`, `providerEventId`,
`approvalId`, `idempotencyKey`, endpoint fingerprint, and credential reference.
Semantic string aliases improve intent without consumer casting. Adapters never
invent provider session, run, or event identifiers.

Serialized timestamps are validated ISO-8601 UTC strings. Provider timestamps
are normalized when accepted; synthesized events use the injected clock;
compatibility reports use report-generation time. Duration options are numeric
milliseconds and end in `Ms`. Serialized contracts contain no `Date` objects.

## Target, authentication, and descriptors

`RuntimeTarget.endpoint` is a string. Transports normalize it internally and
reject unsupported schemes, userinfo, credential-like query parameters,
malformed hosts, and unsafe redirects. Inline authentication takes precedence
over `credentialRef`; unresolved references fail closed. Network policy remains
injectable and provider options stay in adapter namespaces.

`RuntimeDescriptor` contains adapter/runtime/protocol identity, endpoint
fingerprint, observation time, and normalized capabilities. It never contains a
complete endpoint URL, credentials, session keys, or raw provider payloads.

## Capabilities and health

Capabilities start false and are enabled only when implemented and explicitly
advertised. Common groups cover sessions, runs, text/images/files, output, and
liveness/readiness. Provider extensions use namespaced keys. Unsupported
operations return `UNSUPPORTED_CAPABILITY`, never a silent no-op.

Health is `healthy`, `degraded`, or `unavailable`. Optional component checks use
`RuntimeHealthCheck`; raw provider health payloads are not exposed.

## Sessions, runs, and history

`ensureSession()` is idempotent for a valid persisted provider session. The host
owns provider-state persistence; patches must be serializable, bounded, and
sanitized. Hermes accepts a caller `previous_response_id` but never generates a
successor without verified provider evidence.

Run input separates application IDs, text, instructions, history, provider
state, idempotency key, attachments, timeout, and caller cancellation.
Unsupported attachments are rejected before network activity. History returns
`RuntimeHistoryPage` with an optional future pagination cursor.

Normalized states are `queued`, `running`,
`waiting_for_approval`, `stopping`, `completed`, `failed`, `cancelled`, and
`unknown`. Only completed, failed, and cancelled are terminal. Use
`isTerminalRuntimeRunStatus()` and `isActiveRuntimeRunStatus()`.

## Events and approvals

Events form a discriminated union keyed by `type`, including run start,
assistant/tool progress, `approval.required`, usage, transport warnings/gaps,
and terminal outcomes. Every event has a normalized ID, explicit run domains,
and ISO `occurredAt`; provider event IDs are optional and never invented.
Unknown input cannot become completion. Optional raw diagnostics use
`sanitizedRawPayload` and are unstable.

Approval decisions are allow once/session/always, or deny.
`RuntimeApprovalRequest` exposes safe summaries, available decisions, and
optional expiration. Resolution is capability-gated and returns a correlated
`RuntimeApprovalResolution`. Sensitive arguments are hidden by default.

## Errors and detection

All operational failures are `RuntimeError`. Narrow with `isRuntimeError()` or
`hasRuntimeErrorCode()`. Safe fields include code, retryability, operation/stage,
adapter/protocol identity, HTTP status, `retryAfterMs`, and bounded details.
Provider bodies/messages, credentials, complete URLs, and stacks are excluded.

`OUTCOME_UNKNOWN` means acceptance of a side-effecting request cannot be proven.
Reconcile using the same idempotency key; never replay with a different key.

Explicit adapter selection is configuration, not discovery. Auto-detection is
bounded, cancellable, side-effect-free, confidence-based, and cache-versioned.
It never sends prompts or starts runs; fingerprints exclude credentials.

## API review workflow

1. Run `pnpm build && pnpm api:extract`.
2. Review `etc/api/` and this documentation.
3. Add a migration note for a breaking `0.x` change.
4. Run `pnpm api:check && pnpm consumer:check`.

Wire protocol, adapter, runtime-product, and TypeScript API versions are separate
evidence domains. Stable 1.0 criteria have not been met.
