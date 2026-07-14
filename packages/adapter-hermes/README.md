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

The adapter supports `X-Hermes-Session-Key` for long-term-memory scope and
`X-Hermes-Session-Id` for transcript/run continuity. Header values are limited
to 256 characters and reject control characters.

## Continuity And Events

Run creation preserves caller-provided `Idempotency-Key` values. The adapter
uses `previous_response_id` when available, otherwise falls back to supplied
conversation history; it does not send both. Run handles and snapshots may
return a session-state patch containing `previousResponseId`, `externalSessionId`,
and sanitized provider state for the host application to persist.

SSE parsing supports CRLF/LF, UTF-8 chunk boundaries, BOM, multiline data,
comments, final events without trailing newline, size limits, abort cleanup, and
malformed UTF-8 errors. Event mapping uses explicit Hermes event names and
correlates by run/session ID. If an SSE stream ends before a terminal event, the
adapter reconciles with `GET /v1/runs/{run_id}` and emits only the missing
terminal event.

## Capabilities And Limits

Images and files remain unsupported for the Runs API and are rejected before a
provider request. History is advertised only when REST session messages are
available. Approvals are exposed only when Hermes advertises approval support.
Raw provider payloads are disabled by default; when enabled, values are
recursively sanitized and credentials are redacted.
