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

The pre-alpha public API is frozen for `v0.1.0-alpha.1`; it is not a stable 1.0
or production-final contract. OpenClaw and Hermes adapters include
protocol foundations, detection, capability mapping, idempotency enforcement,
SSE parsing and recovery, cancellation, approvals, session history, and
injectable transport boundaries. Compatibility
claims are fixture-backed for the pinned targets documented in
`docs/compatibility.md`, but this SDK should still be treated as an initial
pre-alpha implementation until the live OpenClaw and Hermes integration suites are confirmed in
the target release environment.

Public entrypoints, lifecycle rules, identifiers, errors, and API review are
documented in `docs/public-api.md`. This alpha is ESM-only; the Node package and
repository tooling require Node.js `>=22.13`.

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

Hermes compatibility is currently implemented and synthetic/fake-server
validated; a full live validation run is still required before it is labeled
supported.

All implemented adapters run through the exported provider-neutral conformance
suite in `@banzae/agent-runtime-testing`. Controlled fake OpenClaw v3,
OpenClaw v4, and Hermes servers prove shared lifecycle, session, run, stream,
status, cancellation, security, concurrency, and cleanup behavior. This
fake-server evidence remains distinct from live compatibility evidence. See
`docs/adapter-conformance.md`.

The opt-in live compatibility harness is read-only by default, accepts
credentials only through environment-backed references, writes sanitized
versioned reports, and keeps all mutation behind explicit gates. It is excluded
from normal pull-request CI; normal CI tests it only with fake runtimes. See
`docs/live-compatibility.md`.

## Security and resilience

All runtime traffic is untrusted. Central secure defaults bound JSON bodies,
WebSocket frames, SSE parsing, raw diagnostics, subscriber queues,
deduplication, reconnect/reconciliation, fixture candidates, and compatibility
reports. Node transports reject credential-bearing URLs and do not follow
redirects. Runtime errors and optional raw diagnostics are recursively bounded
and sanitized.

Normal CI runs deterministic fuzz/property tests and resource guardrails without
runtime credentials or external endpoints:

```bash
pnpm test:fuzz
pnpm test:resilience
pnpm security:check
```

Use `pnpm test:fuzz:extended` for the reproducible 5,000-case manual corpus.
See `docs/security.md`, `docs/security-threat-model.md`, `docs/error-model.md`,
and `SECURITY.md`.
