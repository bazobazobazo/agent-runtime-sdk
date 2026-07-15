# `@banzae/agent-runtime-hermes`

Hermes Runs HTTP/SSE adapter for normalized sessions, text runs, events, status,
cancellation, approvals, history, and health.

## Install and entrypoints

After publication, install matching `@banzae/agent-runtime-hermes@0.1.0-alpha.1` and core versions.
Applications use the root adapter/factory/options exports. `/experimental`
contains unstable schemas and SSE utilities for adapter authors.

## Minimal example

```ts
import { createHermesAdapterFactory } from '@banzae/agent-runtime-hermes';

const factory = createHermesAdapterFactory();
console.log(factory.adapterId);
```

## Lifecycle, capabilities, and cleanup

The adapter follows the shared lifecycle and supports `auto`, `client-scoped`,
or `rest-session` continuity. Capabilities fail closed against exact feature and
endpoint evidence. Current Runs input is text-only; images/files and Hermes Jobs
remain unsupported. Always cancel iterators and close in `finally`.

## Errors, recovery, and security

HTTP/SSE payloads are schema-validated and failures normalize to `RuntimeError`.
SSE line/event size, UTF-8 handling, deduplication, reconnects, polling, and
reconciliation are bounded. Raw payloads are disabled by default and sanitized
when explicitly enabled.

Compatibility is implemented and fixture/fake-server validated; full live
run/stream/approval/cancellation validation remains pending. See
[Compatibility](../../docs/compatibility.md), [Streaming](../../docs/streaming.md),
[Approvals](../../docs/approvals.md), and the [construction example](../../examples/hermes-chat/index.ts).
