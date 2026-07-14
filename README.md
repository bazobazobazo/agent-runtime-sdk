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
SSE parsing and recovery, cancellation, approvals, session history, and
injectable transport boundaries. Compatibility
claims are fixture-backed for the pinned targets documented in
`docs/compatibility.md`, but this SDK should still be treated as an initial
scaffold until the live OpenClaw and Hermes integration suites are confirmed in
the target release environment.

## Quick Start

```ts
import { createDefaultRuntimeRegistry } from '@banzae/agent-runtime-node';
import { createHermesProbe, createOpenClawProbe, createRuntimeDetector } from '@banzae/agent-runtime-detection';

const registry = createDefaultRuntimeRegistry({
  stateStore,
  secretStore,
  logger,
});

const detector = createRuntimeDetector({
  dependencies,
  probes: [createOpenClawProbe(), createHermesProbe()],
});

const result = await detector.detect({
  target: {
    endpoint: 'https://agent.example.com',
  },
  adapterId: 'auto',
});
```

Runtime detection never sends the first user prompt and never starts a run.
Explicit adapter selection is a configuration override, not discovery; actual
reachability is validated by the adapter connection path. Detection aborts
underlying HTTP requests, response iterators, WebSocket connections, and event
iterators on caller cancellation and timeouts. Redirects remain unsupported. See
`docs/architecture.md`, `docs/adapter-authoring.md`, `docs/detection.md`, and
`docs/compatibility.md`.

Hermes uses the Runs HTTP/SSE API as its primary transport. It supports
capability discovery, health checks, text run creation, status polling, bounded
SSE recovery, cancellation, approval resolution, and REST session history when
advertised. Images, files, Hermes Jobs, scheduling, Codex, Pi, and
BanzaeForge-specific integration are outside this adapter.
