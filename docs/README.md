# Documentation Index

Pre-alpha public API is frozen for `v0.1.0-alpha.1`.

This documentation set is intended for SDK users who do not want to inspect source internals.

## Quick map

- [getting-started.md](./getting-started.md)
- [public-api.md](./public-api.md)
- [lifecycle.md](./lifecycle.md)
- [capabilities.md](./capabilities.md)
- [sessions.md](./sessions.md)
- [runs.md](./runs.md)
- [streaming.md](./streaming.md)
- [approvals.md](./approvals.md)
- [error-model.md](./error-model.md)
- [detection.md](./detection.md)
- [security.md](./security.md)
- [security-threat-model.md](./security-threat-model.md)

## Architecture and integration

- [architecture.md](./architecture.md)
- [adapter-authoring.md](./adapter-authoring.md)
- [banzaeforge-integration.md](./banzaeforge-integration.md)
- [live-compatibility.md](./live-compatibility.md)
- [compatibility.md](./compatibility.md)
- [versioning-and-compatibility.md](./versioning-and-compatibility.md)

## Migration and operations

- [migration-from-telegraphic.md](./migration-from-telegraphic.md)
- [migration-public-api-freeze.md](./migration-public-api-freeze.md)
- [migration-security-resilience.md](./migration-security-resilience.md)

## Conformance and references

- [adapter-conformance.md](./adapter-conformance.md)
- [api-snapshot.md](./api-snapshot.md)
- [Runnable examples](../examples/README.md)
- [Contributing](../CONTRIBUTING.md)

All examples and snippets are constrained to exported entrypoints and avoid
provider-internal deep imports.

## Runtime evidence and examples

- `docs/compatibility.md` shows evidence class (fixture/fake/live).
- `examples/README.md` lists runnable TypeScript examples for external adoption.

OpenClaw v3 and v4 and Hermes Runs HTTP/SSE remain the supported runtimes for this phase.
