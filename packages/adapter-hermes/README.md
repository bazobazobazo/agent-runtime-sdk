# @banzae/agent-runtime-hermes

Hermes Agent HTTP/SSE adapter for the Banzae Agent Runtime SDK.

The adapter maps Hermes capabilities, run lifecycle APIs, SSE events, and
health responses into the provider-neutral SDK contract.

## Transport

The primary transport is the Hermes Runs HTTP API plus the Runs SSE event
stream:

- `GET /v1/capabilities`
- `GET /health`
- `GET /health/detailed`
- `POST /v1/runs`
- `GET /v1/runs/{run_id}`
- `GET /v1/runs/{run_id}/events`
- `POST /v1/runs/{run_id}/stop`
- `POST /v1/runs/{run_id}/approval`

REST session endpoints are used only when capabilities advertise session
creation and message history. Chat Completions, Hermes Jobs, scheduling, Codex,
Pi, and BanzaeForge-specific integration are out of scope.

## Sessions

`sessionMode` can be `auto`, `client-scoped`, or `rest-session`.

- `client-scoped` uses the SDK application session ID as Hermes `session_id`.
- `rest-session` creates a Hermes REST session and stores the returned session
  ID in provider state.
- `auto` uses REST sessions only when session creation and message history are
  advertised; otherwise it uses client-scoped continuity.

The adapter sends `X-Hermes-Session-Key` for long-term-memory scope and
`X-Hermes-Session-Id` for transcript/run continuity only when the capability
response advertises the corresponding header. Header values are limited to
256 characters and reject control characters.

## Continuity And Events

Run creation preserves caller-provided `Idempotency-Key` values. The adapter
accepts a caller-provided `previous_response_id`, otherwise falls back to
supplied conversation history; it does not send both. Current Hermes Runs
create, status, and terminal payloads do not return a successor response ID, so
the adapter does not advance `previousResponseId`. Run handles and snapshots
may return verified `externalSessionId` and sanitized provider state.

SSE parsing supports CRLF/LF, UTF-8 chunk boundaries, BOM, multiline data,
comments, final events without trailing newline, size limits, abort cleanup, and
malformed UTF-8 errors. Event mapping uses explicit Hermes event names and
correlates by run/session ID. If an SSE stream ends before a terminal event, the
adapter reconciles with `GET /v1/runs/{run_id}` and emits only the missing
terminal event. `maxReconnectAttempts`, `reconnectDelayMs`,
`pollingIntervalMs`, and `maxReconciliationMs` bound recovery; authentication,
permission, and malformed-payload failures are never retried. Event
deduplication defaults to 1,024 entries per run and is configurable with
`maxDeduplicationEntries`.

## Capabilities And Limits

Images and files remain unsupported for the Runs API and are rejected before a
provider request. History is advertised only when REST session messages are
available. Approvals are exposed only when Hermes explicitly advertises
approval resolution. Decisions use `{ action: 'allow', scope: 'once' |
'session' | 'always' }` or `{ action: 'deny' }`, and must be among the choices
offered by that request.
Raw provider payloads are disabled by default; when enabled, values are
recursively sanitized and credentials are redacted.

Compatibility status is provisional: the implementation is validated against
current upstream source, synthetic fixtures, and the fake server, while a full
live Hermes run/stream/approval/cancellation suite remains pending.

The pinned contract review used `NousResearch/hermes-agent` commit
`226e8de827a669e8ffa7035b27d70c19e44b1208`, primarily
`gateway/platforms/api_server.py` and its Runs API tests. Reinspect and refresh
the upstream-reference fixtures when that pin changes.

## Pre-alpha migration note

Approval inputs changed from `decision: 'approve' | 'deny'` to a structured
decision. Replace `'approve'` with `{ action: 'allow', scope: 'once' }`,
`{ action: 'allow', scope: 'session' }`, or
`{ action: 'allow', scope: 'always' }` as appropriate; replace `'deny'` with
`{ action: 'deny' }`. Approval-request events now include
`availableDecisions`. Terminal run events may include reconciled output, usage,
and session-state patches. `INVALID_RESPONSE` is now a public normalized error
code, and Hermes options add `maxDeduplicationEntries`.
