# BanzaeForge integration handoff

Status: design handoff only. This SDK repository does not modify BanzaeForge
application repositories or grant rollout approval.

## Ownership boundary

The SDK owns:

- runtime communication and protocol negotiation;
- normalized runtime capabilities, health, events, and errors;
- use of resolved runtime authentication;
- cancellation transport and bounded stream recovery;
- provider payload validation and sanitization.

BanzaeForge owns:

- users, organizations, seats, authorization, and rollout flags;
- encrypted credential references and credential access policy;
- durable sessions, runs, events, retries, and idempotency persistence;
- scheduling, files, billing, audit logs, and customer-facing status;
- leases, workers, recovery, reconciliation, and rollback.

The SDK must not become the system of record for application state.

## Proposed Forge services

| Service | Responsibility |
|---|---|
| `RuntimeRegistryService` | Approved adapter configuration per environment/organization |
| `RuntimeDetectionService` | Safe discovery and evidence caching |
| `RuntimeCredentialService` | Resolve encrypted references under authorization |
| `RuntimeSessionService` | Durable application/external session mapping |
| `RuntimeRunService` | Run creation, idempotency, state machine, and API views |
| `RuntimeRunWorker` | Leased dispatch, streaming, cancellation, and reconciliation |
| `RuntimeEventStore` | Ordered normalized event persistence and replay |
| `RuntimeHealthService` | Runtime health/evidence observation without customer prompts |

## Persistence concepts

- runtime target: organization, adapter, encrypted credential reference, policy;
- runtime session: application/external IDs, provider state, version, timestamps;
- runtime run: application/external IDs, idempotency key, status, lease, attempts;
- runtime event: run ID, normalized event ID, sequence, type, payload, occurred time;
- run command: start/cancel/approval intent with actor and audit metadata;
- reconciliation record: reason, evidence, attempt, outcome, next action.

Use uniqueness constraints for `(organization, applicationRunId)`, the logical
idempotency scope, normalized event IDs per run, and the final assistant message.
Never persist plaintext runtime credentials or unsanitized provider payloads.

## Durable worker flow

1. Validate user/organization/seat authorization in the API layer.
2. Persist a queued run and caller-owned idempotency key in one transaction.
3. Claim the run with an owner, lease expiry, and fencing/version token.
4. Resolve the encrypted credential reference only inside the worker boundary.
5. Construct/connect the approved adapter and persist its sanitized descriptor.
6. Ensure the session; persist verified external ID/provider state.
7. Start the run; persist verified external run ID before streaming.
8. Persist normalized events in order and renew the lease while making progress.
9. Persist exactly one terminal run outcome and at most one final message.
10. Close the adapter in `finally`, release the lease, and publish durable updates.

## Lease and recovery behavior

Lease renewal must be fenced: a stale worker cannot write after another worker
acquires the run. On process loss, the replacement worker loads durable IDs,
provider state, cursor, last sequence, and idempotency key before reconnecting.
It reconciles status/history before replaying any side-effecting request.

`OUTCOME_UNKNOWN` means the provider may have accepted a mutation. Mark the run
for reconciliation, retain the original idempotency key, inspect provider
status/history, and retry only when evidence and provider semantics make replay
safe. Never create a new key merely to escape uncertainty.

## Event replay and final-message uniqueness

Clients resume from the durable event cursor, not directly from a provider
stream. Inserts should be idempotent by normalized event ID and preserve known
provider sequence. Terminal reconciliation may synthesize only SDK-defined,
evidence-backed normalized events. A database uniqueness rule should prevent
multiple final assistant messages for one application run.

## Rollout and rollback

Roll out behind environment, organization, runtime, and agent allowlists:

1. construction/config validation;
2. read-only health and safe detection;
3. internal canary runs;
4. low-volume organization allowlist;
5. wider rollout with error/latency/outcome-unknown monitoring.

Rollback stops new SDK dispatch, lets already accepted runs reconcile, and
retains SDK-created external IDs/idempotency keys. Legacy fallback may handle a
new run only when it cannot duplicate an accepted SDK mutation. Shadow mode is
limited to non-side-effecting health, detection, and metadata comparisons; do
not send the same prompt through both implementations.
