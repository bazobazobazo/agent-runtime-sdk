# `@banzae/agent-runtime-testing`

Testing-only conformance definitions, deterministic fakes, resource assertions,
and sanitized live-compatibility report utilities.

## Install and entrypoint

After publication, install as a development dependency with
`pnpm add -D @banzae/agent-runtime-testing@0.1.0-alpha.1`. The package root is the only
supported entrypoint. It is not production runtime infrastructure.

## Minimal example

```ts
import { FakeRuntimeAdapter } from '@banzae/agent-runtime-testing';

const adapter = new FakeRuntimeAdapter();
try {
  console.log(adapter.lifecycleState);
} finally {
  await adapter.close();
}
```

## Lifecycle, capabilities, and cleanup

`createRuntimeAdapterConformanceSuite()` tests shared connection, capability,
session, run, stream, status, cancellation, history, security, concurrency, and
cleanup behavior. Fake OpenClaw v3/v4 and Hermes controllers expose only
controlled test evidence. Suite lifecycle hooks must release all resources.

## Errors and security

Fake values and secret markers verify redaction; live report utilities sanitize
and bound output but do not contact a runtime by themselves. Fake/conformance
passes never prove live compatibility.

See [Adapter conformance](../../docs/adapter-conformance.md),
[Live compatibility](../../docs/live-compatibility.md), and the
[adapter-authoring example](../../examples/adapter-authoring/index.ts).
