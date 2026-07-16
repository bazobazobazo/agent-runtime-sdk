# Host application integration

Status: product-neutral integration guidance. These patterns are illustrative
host architecture, not SDK entities or required infrastructure.

The Agent Runtime SDK is a runtime communication library. It can be embedded in
a control plane, SaaS platform, CLI, IDE, orchestration service, custom backend,
or another compatible host application. It is not the system of record for
application-domain state.

## Ownership boundary

The SDK owns:

- runtime protocol communication and connection negotiation;
- authentication transport use after a host resolves credentials;
- runtime capability discovery and safe automatic runtime detection;
- session communication and run creation;
- normalized streaming events and status retrieval;
- cancellation, approval, and history transport;
- health and provider error normalization.

The host application owns:

- users, tenants, organizations, authorization, and billing;
- durable application data and encrypted credential references;
- durable sessions, runs, events, and idempotency-key persistence;
- job queues, worker leases, retries, and uncertain-outcome reconciliation;
- schedules, files, product notifications, and audit logs;
- rollout flags, monitoring, and alerting.

## Optional host components

A larger host may organize its integration around components such as:

| Component | Illustrative responsibility |
|---|---|
| `RuntimeRegistry` | Resolve approved adapter and runtime configuration for a tenant or workload. |
| `RuntimeDetector` | Perform safe discovery and cache evidence under host policy. |
| `RuntimeConnectionManager` | Construct adapters and manage bounded connection lifecycles. |
| `CredentialResolver` | Resolve encrypted credential references after authorization. |
| `RuntimeSessionStore` | Persist application/external session mappings and provider state. |
| `RuntimeRunWorker` | Dispatch leased runs, stream events, cancel, and reconcile. |
| `RuntimeEventStore` | Persist and replay ordered normalized events. |
| `RuntimeHealthMonitor` | Observe runtime health without customer prompts. |
| `RunReconciliationWorker` | Resolve abandoned leases and uncertain outcomes. |

These names are examples, not exported SDK services. A CLI or IDE may need only
an adapter and in-memory lifecycle management.

## Optional persistence concepts

A durable control plane may use records resembling:

- `runtime_configuration`: adapter selection, target reference, policy, and tenant assignment;
- `runtime_detection`: sanitized detection evidence, fingerprint, and expiry;
- `runtime_session`: application/external IDs, provider state, version, and timestamps;
- `runtime_run`: application/external IDs, idempotency key, status, and attempts;
- `runtime_run_event`: normalized event ID, run ID, sequence, type, and payload;
- `execution_lease`: owner, expiry, and fencing/version token;
- `idempotency_record`: stable logical-operation key and known provider outcome;
- `reconciliation_attempt`: reason, evidence, attempt, outcome, and next action.

These are illustrative host-owned records. They are not SDK entities or npm
package schemas. The SDK does not depend on a database or PostgreSQL and does
not prescribe an ORM, framework, queue, or storage engine. Never persist
plaintext runtime credentials or unsanitized provider payloads.

## Durable run flow

1. The host accepts an application request.
2. The host validates user and tenant authorization.
3. The host transactionally stores application input and a queued runtime run.
4. The host persists a stable idempotency key.
5. A durable worker claims the run with a fenced lease.
6. The worker resolves the encrypted credential reference.
7. The worker creates the configured runtime adapter.
8. The worker connects and ensures the runtime session.
9. The worker starts the run.
10. The worker stores the verified external run ID.
11. The worker stores normalized events in order.
12. The worker stores verified session-state patches.
13. The worker records exactly one terminal outcome and final output.
14. The host notifies its client through its own product channel.
15. Recovery reconciles abandoned leases and `OUTCOME_UNKNOWN` results.

Close the adapter in `finally`. Renew leases only while making progress, and
prevent a stale worker from writing after a replacement acquires the run.

## Recovery and uncertain outcomes

On process loss, a replacement worker should load durable application and
external IDs, provider state, event cursor, last sequence, lease version, and
the original idempotency key before reconnecting. Reconcile provider status or
history before replaying a side-effecting request.

`OUTCOME_UNKNOWN` means a provider may have accepted the mutation. Retain the
original idempotency key, gather evidence, and retry only when provider
semantics make replay safe. Do not create a new key merely to escape uncertainty.

Clients should resume from the host's durable event cursor rather than directly
from a provider stream. Event inserts should be idempotent, and host persistence
should enforce one final application message or equivalent terminal result per
logical run.

## Rollout and rollback

Example host-owned flags include:

- `AGENT_RUNTIME_SDK_ENABLED`
- `AGENT_RUNTIME_ADAPTER_ALLOWLIST`
- `AGENT_RUNTIME_LEGACY_FALLBACK`
- `AGENT_RUNTIME_READ_ONLY_SHADOW`
- `AGENT_RUNTIME_ROLLOUT_PERCENTAGE`

These example variables are not read or interpreted by the SDK. A host can use
any configuration mechanism.

A conservative rollout starts with construction validation, read-only health
and detection, internal canaries, a small tenant or workload allowlist, and then
a monitored percentage rollout. Rollback stops new SDK dispatch while allowing
accepted runs to reconcile and preserving external IDs and idempotency keys.

Read-only comparison may evaluate connection health, protocol discovery,
capabilities, authorized history, normalized metadata, and errors from
non-mutating probes. Never send the same side-effecting prompt through two
runtime implementations.
