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
