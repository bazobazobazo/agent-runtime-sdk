# `@banzae/agent-runtime-node`

Node.js facade providing the default runtime registry, fetch/WebSocket
transports, file/in-memory stores, crypto, and environment credential provider.

## Install and entrypoint

Install with `pnpm add @banzae/agent-runtime-node`. The ESM-only package root is
the only supported entrypoint and requires Node.js `>=22.13`.

## Minimal example

```ts
import { createDefaultRuntimeRegistry, NodeMemorySecretStore } from '@banzae/agent-runtime-node';
import { MemoryStateStore } from '@banzae/agent-runtime-core/testing';

const registry = createDefaultRuntimeRegistry({
  stateStore: new MemoryStateStore(),
  secretStore: new NodeMemorySecretStore(),
});
const adapter = registry.create('openclaw');
try {
  console.log(adapter.lifecycleState);
} finally {
  await adapter.close();
}
```

## Lifecycle, capabilities, and cleanup

The registry constructs OpenClaw/Hermes adapters; construction does not connect.
Capabilities remain disabled until connection. Close every adapter in `finally`.
`NodeFileStateStore` writes durable state with restrictive modes; applications
must choose an appropriate protected directory.

## Errors and security

Transports reject userinfo, credential query fields, unsafe schemes, and
redirect following. `EnvironmentRuntimeCredentialProvider` accepts only
`env:VARIABLE_NAME` references. Never pass secret values through CLI arguments
or persist them in descriptors/state.

See [Getting started](../../docs/getting-started.md), [Security](../../docs/security.md),
and the [credential-provider example](../../examples/credential-provider/index.ts).
