# Sessions

The SDK keeps caller and provider identity domains separate:

- `applicationSessionId`: stable ID owned by the host application.
- `externalSessionId`: verified ID returned or accepted by the runtime.
- `providerState`: bounded, serializable continuation state persisted by the host.

`ensureSession()` is idempotent for equivalent caller identity and persisted
state. Adapters never invent an external session ID.

## Continuity

- OpenClaw maps application and Gateway session identity without exposing wire DTOs.
- Hermes supports `client-scoped`, `rest-session`, or evidence-driven `auto` mode.
- `RuntimeSessionStatePatch` can advance only provider state verified in a run response.
- Hermes accepts caller-supplied `previous_response_id`, but does not invent a
  successor when the upstream response does not provide one.

Persist session state after successful session creation and after verified run
patches. Do not store credentials or raw provider frames in session state.

## History

Call `getHistory()` only when `sessions.history` is true. Results are normalized
as `RuntimeHistoryPage`; preserve `nextCursor` for future pagination. History is
provider evidence, not the durable application transcript.

See the deterministic [`history` example](../examples/history/index.ts).
