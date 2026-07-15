# `@banzae/agent-runtime-detection`

Bounded runtime discovery with confidence selection, versioned cache, credential
provider, diagnostics, and network-policy contracts.

## Install and entrypoint

After publication, install with `pnpm add @banzae/agent-runtime-detection@0.1.0-alpha.1`. The package root is the
only supported entrypoint; probe registries, frames, parsers, and payloads are internal.

## Minimal example

```ts
import { DefaultRuntimeNetworkPolicy } from '@banzae/agent-runtime-detection';

const policy = new DefaultRuntimeNetworkPolicy();
await policy.validateTarget(new URL('https://runtime.example.com'));
```

## Lifecycle, limits, and cleanup

Detection is not an adapter lifecycle and never starts runs. Each detect call is
bounded by caller signal, overall timeout, and probe timeout. It aborts HTTP
bodies, iterators, and sockets when cancelled. Explicit adapter selection does
not prove endpoint reachability.

## Capabilities, errors, and security

Capabilities are returned only from validated evidence. Ambiguous/failed results
remain explicit; operational failures use `RuntimeError`. Credentials never
enter fingerprints/descriptors, redirects are rejected, and credential-bearing
URLs fail network policy.

See [Detection](../../docs/detection.md), [Capabilities](../../docs/capabilities.md),
[Errors](../../docs/error-model.md), and the [deterministic example](../../examples/detect-runtime/index.ts).
