# Scheduling

Scheduling is an optional adapter capability. The provider-neutral contract
supports one-time, interval, and cron timing with time zones; create, get, list,
update, delete, enable/disable, pause/resume, immediate trigger, next/previous
execution, and execution history are advertised independently.

Every create request requires a caller-owned idempotency key. The OpenClaw
adapter checks for an existing schedule before creation and reconciles uncertain
acceptance by that key. If acceptance cannot be proven, it returns
`OUTCOME_UNKNOWN` and does not create a replacement schedule automatically.

Schedule payloads are bounded, abortable, normalized, and never expose raw
provider responses. Consumers own schedule authorization, persistence,
ownership, job queues, retries, audit, monitoring, and orphan reconciliation.
