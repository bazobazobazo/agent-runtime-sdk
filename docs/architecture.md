# Architecture

The SDK boundary is runtime communication:

- detection and connection;
- health and capabilities;
- session creation/resume;
- run start, stream, status, history, cancellation;
- typed errors;
- adapter conformance tests.

Applications remain responsible for durable state, user authorization, files,
schedules, billing, tenancy, product-specific audit records, and retries across
worker crashes.

## Packages

- `core`: provider-neutral contracts and helpers.
- `detection`: safe runtime selection across registered adapters.
- `adapter-openclaw`: OpenClaw Gateway WebSocket adapter with explicit protocol
  codec registry.
- `adapter-hermes`: Hermes HTTP/SSE adapter.
- `testing`: fake adapters and shared adapter contract tests.
- `node`: Node.js convenience implementations and default registry.

Codex and Pi directories are private placeholders only.

All adapters follow the shared lifecycle `created`, `connecting`, `connected`,
`closing`, and `closed`. Explicit export maps separate normal application APIs
from `/experimental`, `/diagnostics`, and `/testing` surfaces. See
`public-api.md`.

## Shared Adapter Conformance

The testing package exports runner-independent conformance cases that use only
`AgentRuntimeAdapter` and provider-neutral SDK contracts. The same definitions
run against separate fake OpenClaw v3, OpenClaw v4, and Hermes targets.
Controller hooks inject provider events and expose cleanup counters; shared
tests do not inspect adapter private fields or provider-specific application
types.

Capability-dependent cases run only when an adapter advertises the operation.
Advertised history, streaming, cancellation, and approvals must perform a real
public operation. Provider-specific suites remain responsible for codec
negotiation, device state, sequence gaps, Hermes recovery timing, and other
wire-only contracts. See `adapter-conformance.md`.

## Live Compatibility Harness

The testing package also exports a provider-neutral live check runner, report
schema, recursive sanitizer, fixture-candidate model, and report comparison
API. Node CLI composition resolves environment-backed credential references,
constructs the registered adapter, and executes ordered checks under linked
per-check and overall abort controllers. The adapter is closed in `finally`,
including when a required check fails or times out.

Read-only connection, capability, and health checks are the default. Controlled
session, run, cancellation, and approval operations require independent
mutation gates. Reports contain endpoint fingerprints instead of URLs and pass
a final secret scan before atomic write. The manual GitHub workflow is the only
CI path allowed to contact a live runtime; ordinary CI uses fake transports.
See `live-compatibility.md`.

## Security Boundaries and Bounded Resources

Core exports one provider-neutral table of secure defaults and hard ceilings.
The HTTP, WebSocket, SSE, detection, diagnostic, fixture, and report paths
resolve their production limits through that contract. Adapter close and caller
abort propagate through active requests, response iterators, subscriptions,
reconnect sleeps, and polling loops. OpenClaw uses one bounded dispatcher per
connection; Hermes uses independent bounded stream/dedupe state per run.

The generic SDK validates URL syntax and credential safety but permits private
networks. Deployment-aware DNS, metadata-service, proxy, egress, and TLS policy
belong to the host and infrastructure. See `security-threat-model.md`.

## Runtime Detection

Runtime detection is provider-neutral and independent from application concerns
such as users, organizations, databases, seats, schedules, files, or audit
records. The detection package receives probes through registration and
currently registers only OpenClaw and Hermes probes. Codex and Pi remain private
placeholders and are not registered for detection.

Detection priority is:

1. explicit adapter configuration;
2. valid persisted detection with matching fingerprint;
3. connection-scheme hint;
4. optional `/.well-known/agent-runtime.json` manifest;
5. safe protocol probes;
6. confidence-based selection;
7. ambiguous or failed result.

Explicit adapter configuration selects the configured adapter without probing
and does not prove endpoint reachability. It is a configuration override, not
runtime discovery; the adapter's normal `connect()` call validates reachability
later.

The detector never sends a user prompt, starts a run, creates a schedule, writes
files, or creates OpenClaw device-pairing requests during ordinary detection.
Applications can inject stricter network policy, credential resolution, and
detection storage without changing the SDK boundary.

## Hermes Runtime Adapter

The Hermes adapter uses the Runs HTTP API and Runs SSE stream as its primary
runtime path. It does not use Chat Completions and does not expose Hermes Jobs
as SDK scheduling. Connection validates `/v1/capabilities`, maps only features
implemented by this adapter, and keeps image/file input disabled until the Runs
API has fixture-backed support. Mapping begins from a fully disabled capability
set. Each run operation requires its exact boolean feature and endpoint;
approval support additionally requires approval events and
`run_approval_response`. Session endpoints and headers are enabled only by exact
endpoint/header evidence. The pinned contract has no independent usage feature,
so `output.usage` remains false.

Hermes sessions operate in `auto`, `client-scoped`, or `rest-session` mode.
Client-scoped sessions use the SDK application session ID as Hermes
`session_id`; REST sessions are created only when capabilities advertise
session creation and message history. The Runs API accepts a caller-provided
`previous_response_id`, but inspected Hermes source does not return a successor
response ID from run create, status, or terminal events. The adapter therefore
never invents or advances `previousResponseId`; it returns only verified Hermes
`session_id` state for the host application to persist.

SSE event mapping is explicit by Hermes event name and is correlated by run ID
and session ID. Each stream has an independently bounded deduplication window.
After a non-terminal disconnect, the adapter polls status, reconnects only for
retryable failures within `maxReconnectAttempts`, and then performs bounded
polling governed by `pollingIntervalMs` and `maxReconciliationMs`. Unknown
events are warnings, never successful completion.

Approval requests expose their exact available decisions. The neutral model is
`allow` with `once`, `session`, or `always` scope, or `deny`. Hermes receives
the exact upstream `choice` field and the adapter rejects scopes not offered by
the specific request.

Detection cancellation is explicit. Each call has an operation-wide abort
controller linked to caller cancellation and overall timeout, and each probe has
a child controller linked to per-probe timeout. HTTP requests, response body
iterators, WebSocket connections, WebSocket event iterators, listeners, and
timers are closed before detection returns.

OpenClaw authenticated detection uses the codec registry in v4 then v3 order,
with a fresh socket per protocol attempt. It downgrades only after a confirmed
v4 protocol mismatch. Hermes detection requires Hermes identity evidence and
does not treat generic capabilities arrays, feature objects, or HTTP success as
runtime identity. Cached detections are accepted only when schema, fingerprint,
expiration, adapter registration, protocol name, and protocol version all still
match supported values.
