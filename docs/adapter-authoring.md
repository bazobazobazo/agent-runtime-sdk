# Adapter Authoring

An adapter must implement `AgentRuntimeAdapter` from
`@banzae/agent-runtime-core`.

Rules:

- keep provider wire DTOs inside the adapter package;
- expose provider-specific features only as optional extensions;
- require caller-owned idempotency keys for run creation;
- never replay mutating requests automatically after reconnect;
- sanitize all errors and logs;
- reject unsupported attachments before runtime execution;
- pass the shared conformance suite before publication.
