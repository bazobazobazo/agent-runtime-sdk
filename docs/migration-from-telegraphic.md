# Migration from `@telegraphic-dev/openclaw-gateway-client`

Migrate behind feature flags while preserving application authorization,
durability, and rollback. The replacement package is
`@banzae/agent-runtime-openclaw`, normally composed through
`@banzae/agent-runtime-node` and provider-neutral core contracts.

## Dependency replacement

1. Pin the current Telegraphic client during migration.
2. Add `@banzae/agent-runtime-core`, `@banzae/agent-runtime-openclaw`, and the
   Node facade; add detection only when discovery is required.
3. Keep legacy imports in the legacy module and SDK imports at package roots.
4. Remove the old dependency only after rollback exercises pass.

Do not import adapter codecs, transports, parsers, dispatchers, provider DTOs,
`src`, or `dist` paths in application code.

## Mapping

| Legacy concern | Runtime SDK approach |
|---|---|
| Gateway client construction | `RuntimeRegistry.create('openclaw')` |
| Token/device credentials | Authorized `credentialRef` or `RuntimeAuthInput` |
| Protocol selection | Adapter negotiation for implemented v3/v4 codecs |
| Conversation/session | `ensureSession()` and durable `RuntimeSession` state |
| Prompt/run | `startRun()` with caller IDs and idempotency key |
| Gateway events | `streamRun()` normalized `RuntimeEvent` values |
| History | Capability-gated `getHistory()` |
| Abort | `cancelRun()` plus terminal reconciliation |
| Errors | `RuntimeError` and normalized codes |

## Migration sequence

1. Create the OpenClaw adapter and connect with a reserved/configured target.
2. Persist `applicationSessionId` separately from verified `externalSessionId`.
3. Start every logical run with a stable caller-owned `applicationRunId` and
   idempotency key.
4. Persist normalized events and cursor/sequence state before client replay.
5. Map cancellation to a stopping state until terminal evidence arrives.
6. Narrow errors with `isRuntimeError()`; handle `OUTCOME_UNKNOWN` through
   reconciliation, not blind replay.
7. Check capabilities before history, cancellation, approvals, images, or files.

Images/files must remain disabled unless the selected adapter reports the exact
capability. Current Hermes Runs input is text-only; do not infer parity from a
different runtime.

## Feature flags and fallback

Suggested flags:

- `RUNTIME_SDK_ENABLED`
- `RUNTIME_SDK_AGENT_ALLOWLIST`
- `RUNTIME_SDK_OPENCLAW_ENABLED`
- `RUNTIME_LEGACY_OPENCLAW_FALLBACK`
- `RUNTIME_SDK_SHADOW_MODE`

Fallback is safe only before a side-effecting SDK request is accepted or after
reconciliation proves it was not accepted. Preserve IDs and idempotency keys
across worker retries. Never send the same side-effecting prompt through both
implementations.

Safe shadow mode is limited to health, protocol/capability detection, and
read-only metadata/history comparisons authorized for the same account. Do not
compare secrets, raw provider payloads, or customer prompts in logs.

## Exit criteria

- fake-server and target live evidence are reviewed for the pinned runtime;
- cancellation, history, reconnect, and `OUTCOME_UNKNOWN` drills pass;
- rollback does not duplicate accepted runs;
- unsupported attachments fail before network activity;
- legacy fallback and flags are exercised before removing Telegraphic.
