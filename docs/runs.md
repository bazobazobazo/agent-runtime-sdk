# Runs

`startRun()` requires a caller-owned `applicationRunId`, caller-owned
`idempotencyKey`, a `RuntimeSession`, and text input. Optional instructions,
history, metadata, attachments, and timeout remain provider-neutral.

## Identity and idempotency

- Persist application and external IDs in separate columns/fields.
- Never invent an `externalRunId`; missing provider identity is `INVALID_RESPONSE`.
- Reuse the same idempotency key only for the same logical run.
- On `OUTCOME_UNKNOWN`, reconcile with the same key before any replay.
- Never send the same side-effecting prompt to two implementations in shadow mode.

## Status

Normalized statuses are `queued`, `running`, `waiting_for_approval`, `stopping`,
`completed`, `failed`, `cancelled`, and `unknown`. Only completed, failed, and
cancelled are terminal. Use `isTerminalRuntimeRunStatus()` and
`isActiveRuntimeRunStatus()`.

## Input limits

Capability checks happen before provider activity. Images/files are rejected
when unsupported; current Hermes Runs input is text-only. Host applications
must bound input before persistence and should never log prompts or attachments.

## Cancellation and status

`cancelRun()` is transport cancellation, not proof of terminal cancellation.
Persist a stopping state, continue reconciliation, and accept a verified
completed/failed/cancelled terminal outcome. See the deterministic
[`cancellation` example](../examples/cancellation/index.ts).
