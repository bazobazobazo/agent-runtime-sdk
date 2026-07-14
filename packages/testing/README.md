# @banzae/agent-runtime-testing

Shared conformance helpers and fake adapter utilities for Banzae agent runtime
adapter tests.

Use this package to keep adapter behavior aligned with the provider-neutral SDK
contract.

The package also includes a controllable fake Hermes HTTP/SSE server for tests
covering capabilities, health, run creation, polling, SSE streaming,
disconnects, duplicate events, malformed events, approvals, stop, sessions,
history, authentication failures, rate limits, and server failures.
