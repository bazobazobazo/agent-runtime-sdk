# Adapter lifecycle

Every `AgentRuntimeAdapter` follows:

`created -> connecting -> connected -> closing -> closed`

## Rules

- `capabilities()` is fail-closed and `health()` is unavailable before connect.
- Operational methods reject with `INVALID_CONFIGURATION` before connection.
- Repeating `connect()` for the active target is idempotent.
- `close()` is idempotent, aborts adapter-owned work, and waits for cleanup.
- A closed adapter may reconnect.
- A caller `AbortSignal` cancels only that operation; `close()` cancels all work.
- Every adapter created by an application must be closed in `finally`.

## Host flow

1. Select or detect an adapter.
2. Construct the adapter from a registry.
3. Connect and persist only the sanitized descriptor.
4. Read capabilities before optional operations.
5. Ensure a session and persist its provider state.
6. Start a run with caller-owned IDs and idempotency key.
7. stream/poll, persist events, and reconcile terminal state.
8. Close the adapter in `finally`.

See the deterministic [`lifecycle` example](../examples/lifecycle/index.ts).

## Failure handling

Treat `OUTCOME_UNKNOWN` differently from a known rejection: preserve the same
idempotency key and reconcile before retry. Never translate a cancelled caller
operation into successful completion. See [Errors](error-model.md) and
[BanzaeForge integration](banzaeforge-integration.md).
