# `@banzae/agent-runtime-core`

Provider-neutral adapter, lifecycle, capability, session, run, event, error,
registry, security-limit, and dependency-port contracts. It has no Node-only
runtime dependency.

## Install and entrypoints

Install with `pnpm add @banzae/agent-runtime-core`. Supported entrypoints are
the stable-for-alpha root, advanced `/diagnostics`, unstable `/experimental`,
and testing-only `/testing`. Never import `src` or `dist` paths.

## Minimal example

```ts
import { NO_CAPABILITIES, supportsCapability } from '@banzae/agent-runtime-core';

const canStream = supportsCapability(NO_CAPABILITIES, 'runs.stream');
console.log(canStream);
```

## Lifecycle, limits, and cleanup

Adapters follow `created -> connecting -> connected -> closing -> closed`.
Capabilities fail closed; optional methods throw `UNSUPPORTED_CAPABILITY`.
Caller signals cancel individual operations, while idempotent `close()` releases
all adapter resources. Hosts must persist application/provider IDs separately.

## Errors and security

All operational failures normalize to bounded, sanitized `RuntimeError` values.
Use `isRuntimeError()` or `hasRuntimeErrorCode()`. Treat `OUTCOME_UNKNOWN` as a
reconciliation state. Keep credentials, complete endpoints, raw payloads,
prompts, and attachments out of logs and durable provider state.

See [Public API](../../docs/public-api.md), [Lifecycle](../../docs/lifecycle.md),
[Capabilities](../../docs/capabilities.md), [Errors](../../docs/error-model.md),
and [Security](../../docs/security.md).
