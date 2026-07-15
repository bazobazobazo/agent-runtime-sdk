# `@banzae/agent-runtime-openclaw`

OpenClaw Gateway adapter implementing wire protocols v3 and v4 behind the
provider-neutral runtime contract.

## Install and entrypoints

Install with `pnpm add @banzae/agent-runtime-openclaw @banzae/agent-runtime-core`.
Applications use the root adapter/factory exports. `/experimental` contains
unstable version-codec and wire authoring utilities; do not use it in application code.

## Minimal example

```ts
import { createOpenClawAdapterFactory } from '@banzae/agent-runtime-openclaw';

const factory = createOpenClawAdapterFactory();
console.log(factory.adapterId);
```

## Lifecycle, capabilities, and cleanup

The adapter follows the shared lifecycle, negotiates only implemented v3/v4
protocols, and fails closed on unknown versions/capabilities. Text runs,
sessions, streaming, status, cancellation, approvals, and history depend on
validated runtime evidence. Images are not advertised without real payload support.
Always propagate an `AbortSignal` and close the adapter in `finally`.

## Errors and security

Gateway failures normalize to `RuntimeError`; raw frames are never normal API.
Frame sizes, event queues, deduplication, correlation, and diagnostics are
bounded. Credentials and device proof material must remain in authorized stores.

See [Compatibility](../../docs/compatibility.md), [Lifecycle](../../docs/lifecycle.md),
[Security](../../docs/security.md), and the [construction example](../../examples/openclaw-chat/index.ts).
