# Streaming and recovery

`streamRun()` returns an `AsyncIterable<RuntimeEvent>` discriminated by `type`.
Events cover run lifecycle, assistant/reasoning deltas, tools, approvals, usage,
transport warnings/gaps, and terminal outcomes.

## Consumer rules

- Correlate every event by application/external run and external session IDs.
- Deduplicate by normalized `eventId`; provider IDs are optional and never invented.
- Persist sequence/cursor state before acknowledging durable delivery.
- Treat `duplicate` as evidence, not permission to discard an unpersisted event.
- Require exactly one durable terminal outcome and one final assistant message.
- Stop iteration and close the adapter when the consumer is cancelled.

## Recovery

When a stream ends before a terminal event, an adapter may poll status, emit a
missing verified terminal event, reconnect within configured bounds, or report
failure. Authentication, permission, malformed payload, and schema failures are
not blindly retried. Recovery is bounded by reconnect, deduplication, queue, and
reconciliation limits.

Malformed or unrelated provider events can never become successful completion.
Optional raw payload diagnostics are sanitized, bounded, opt-in, and unstable.

See the deterministic [`streaming` example](../examples/streaming/index.ts).
