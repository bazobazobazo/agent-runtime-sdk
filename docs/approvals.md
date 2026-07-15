# Approvals

Approvals are optional and capability-gated by `runs.approvals`. A runtime event
contains a safe description, `approvalId`, correlated run IDs, allowed
decisions, and optional sanitized argument preview.

Supported decisions are:

- `{ action: 'allow', scope: 'once' }`
- `{ action: 'allow', scope: 'session' }`
- `{ action: 'allow', scope: 'always' }`
- `{ action: 'deny' }`

The host, not the SDK, decides who may approve. Before calling
`resolveApproval()`, verify organization/user authorization, request freshness,
run/session correlation, and that the decision appears in `availableDecisions`.
Persist the human decision and audit metadata before or atomically with dispatch.

Never expose sensitive tool arguments by default. Repeated resolution of a
non-idempotent approval must fail safely rather than execute twice.

See the deterministic [`approvals` example](../examples/approvals/index.ts).
