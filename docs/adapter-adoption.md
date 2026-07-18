# Runtime adapter adoption

Adopt a runtime adapter behind application-owned controls while preserving
authorization, durability, reconciliation, and rollback boundaries.

## Integration sequence

1. Install packages only from reviewed artifacts or an approved registry.
2. Construct an adapter through the Node registry or package-root APIs.
3. Keep application IDs separate from external runtime IDs.
4. Supply a stable idempotency key for every side-effecting operation.
5. Check negotiated capabilities before optional operations.
6. Persist normalized events and completion evidence in application-owned storage.
7. Reconcile `OUTCOME_UNKNOWN`; never blindly replay an accepted operation.
8. Close adapters and release streams on success, failure, timeout, and abort.

Do not import codecs, transports, parsers, `src`, or `dist` paths. Rollout,
persistence, authorization, ownership, retention, billing, malware scanning,
metrics, alerting, and audit remain responsibilities of the SDK consumer.

## Attachments

Use bounded inline byte sources with a sanitized filename, MIME type, declared
size, and optional SHA-256 hash/reference. The SDK does not fetch URLs or read
local paths. Consumers remain responsible for authorization, malware scanning,
durable storage, ownership, privacy, and retention.

## Scheduling

Scheduling is capability-gated. Preserve the caller idempotency key until an
external schedule ID is confirmed. After a timeout or disconnect, reconcile by
idempotency key before retrying. Delete temporary schedules and verify that no
orphan remains.

## Safe rollout

Consumer-owned rollout controls may route operations to one selected adapter.
Never submit the same side-effecting operation through two implementations.
Fallback is safe only before acceptance or after reconciliation proves that the
operation was not accepted.
