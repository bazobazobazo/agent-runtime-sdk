# Banzae Agent Runtime SDK

Provider-neutral TypeScript SDK for connecting applications to supported agent
runtimes.

Initial package set:

- `@banzae/agent-runtime-core`
- `@banzae/agent-runtime-detection`
- `@banzae/agent-runtime-openclaw`
- `@banzae/agent-runtime-hermes`
- `@banzae/agent-runtime-testing`
- `@banzae/agent-runtime-node`

The SDK owns runtime communication. Applications own users, tenancy, durable
runs, schedules, files, authorization, and audit records.

## Status

Initial scaffold for pre-release review. OpenClaw and Hermes adapters include
protocol foundations, detection, capability mapping, idempotency enforcement,
SSE parsing, cancellation, and injectable transport boundaries. Compatibility
claims are fixture-backed for the pinned targets documented in
`docs/compatibility.md`, but this SDK should still be treated as an initial
scaffold until the live OpenClaw and Hermes integration suites are confirmed in
the target release environment.

## Quick Start

```ts
import { createDefaultRuntimeRegistry } from '@banzae/agent-runtime-node';

const registry = createDefaultRuntimeRegistry({
  stateStore,
  secretStore,
  logger,
});
```

See `docs/architecture.md`, `docs/adapter-authoring.md`, and
`docs/compatibility.md`.
