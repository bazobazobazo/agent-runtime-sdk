# `@banzae/agent-runtime-node`

Node.js facade providing the default runtime registry, fetch/WebSocket
transports, file/in-memory stores, crypto, and environment credential provider.

## Install and entrypoint

After publication, install with `pnpm add @banzae/agent-runtime-node@0.1.0-alpha.1`. The ESM-only package root is
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
must choose an appropriate protected directory. It writes a temporary file,
syncs its contents, then atomically replaces the committed JSON file. Mutations
for the same file are serialized within one Node.js process. Directory sync is
best-effort on platforms that do not support it.

Existing namespace/key identifiers containing only ASCII letters, digits,
underscores, dots, and hyphens (except `.` and `..`) keep their original file
paths. Other identifiers now use unambiguous encoded paths; identifiers must be
nonempty valid UTF-8 strings of at most 180 bytes. **Do not automatically read
the old sanitized path for an encoded identifier:** older identifiers such as
`a/b` and `a_b` could have shared a file, so its owner cannot be inferred.
Consumers with noncanonical legacy identifiers must back up their state and
explicitly map each old file to its original identifier before migrating or
re-pairing. Existing OpenClaw connection fingerprints use canonical identifiers
and need no path migration.

## Errors and security

Transports reject userinfo, credential query fields, unsafe schemes, and
redirect following. `EnvironmentRuntimeCredentialProvider` accepts only
`env:VARIABLE_NAME` references. Never pass secret values through CLI arguments
or persist them in descriptors/state.

See [Getting started](../../docs/getting-started.md), [Security](../../docs/security.md),
and the [credential-provider example](../../examples/credential-provider/index.ts).
