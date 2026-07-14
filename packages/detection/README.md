# @banzae/agent-runtime-detection

Safe runtime detection helpers for Banzae agent runtimes.

Detection uses bounded probes and must not submit user prompts to multiple
runtimes. Explicit adapter selection bypasses probing and does not prove
reachability; adapter `connect()` validates the endpoint later.

OpenClaw authenticated detection tries codec-validated v4 first and v3 only
after a confirmed protocol mismatch. Hermes detection requires Hermes-specific
identity evidence. Cached detections are reused only when schema, fingerprint,
expiration, adapter, protocol name, and protocol version are still valid.

Detection aborts HTTP requests, response iterators, WebSocket connections, and
event iterators on caller cancellation, overall timeout, or per-probe timeout.
Redirects are not supported.

The package root is the only supported entrypoint. Probe registry internals,
provider frames, parser helpers, and raw payloads are not public API. Inline
authentication takes precedence over a credential reference; credentials never
enter fingerprints or descriptors.
