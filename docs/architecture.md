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

## Runtime Detection

Runtime detection is provider-neutral and independent from application concerns
such as users, organizations, databases, seats, schedules, files, or audit
records. The detection package receives probes through registration and
currently registers only OpenClaw and Hermes probes. Codex and Pi remain private
placeholders and are not registered for detection.

Detection priority is:

1. explicit adapter configuration;
2. valid persisted detection with matching fingerprint;
3. connection-scheme hint;
4. optional `/.well-known/agent-runtime.json` manifest;
5. safe protocol probes;
6. confidence-based selection;
7. ambiguous or failed result.

The detector never sends a user prompt, starts a run, creates a schedule, writes
files, or creates OpenClaw device-pairing requests during ordinary detection.
Applications can inject stricter network policy, credential resolution, and
detection storage without changing the SDK boundary.
