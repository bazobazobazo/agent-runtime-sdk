# Banzae Agent Runtime SDK

Provider-neutral TypeScript contracts and adapters for communicating with
supported agent runtimes.

> **Pre-alpha:** the public API is frozen only for `v0.1.0-alpha.1`. This is not
> a stable `1.0` or production-final contract. Compatibility is evidence-based
> and can differ by runtime product, release, and wire protocol.

The repository is prepared for a controlled `0.1.0-alpha.1` candidate, but no
package availability is implied. After publication, all six public packages
will use the same prerelease version. See [Release engineering](docs/releasing.md).

## Purpose

The SDK gives host applications one lifecycle for runtime discovery,
connection, sessions, runs, normalized events, approvals, cancellation,
history, health, capabilities, and errors. The SDK owns runtime communication;
the host continues to own application-domain authorization and durability.

The `@banzae` scope identifies the publisher. The SDK is independent of other
Banzae products and can be embedded in any compatible host application,
control plane, CLI, IDE, orchestration service, or custom backend.

## Supported runtimes

- **OpenClaw:** wire protocols v3 and v4 are implemented.
- **Hermes:** Runs HTTP/SSE is implemented and fixture/fake-server validated;
  full live run, stream, approval, and cancellation validation is still pending.

See [`docs/compatibility.md`](docs/compatibility.md) for the exact fixture,
fake-server, provider, and live evidence attached to each claim.

## Packages

| Package | Purpose |
|---|---|
| `@banzae/agent-runtime-core` | Provider-neutral contracts, capabilities, events, errors, ports, and registry |
| `@banzae/agent-runtime-detection` | Bounded, side-effect-free runtime detection |
| `@banzae/agent-runtime-openclaw` | OpenClaw v3/v4 Gateway adapter |
| `@banzae/agent-runtime-hermes` | Hermes Runs HTTP/SSE adapter |
| `@banzae/agent-runtime-testing` | Conformance suite, deterministic fakes, and live-report utilities |
| `@banzae/agent-runtime-node` | Node.js transports, stores, credential provider, and default registry |

All packages are ESM-only. Node-specific packages and repository tooling require
Node.js `>=22.13`.

## Install

```bash
pnpm add @banzae/agent-runtime-core @banzae/agent-runtime-openclaw @banzae/agent-runtime-hermes @banzae/agent-runtime-node
```

Add `@banzae/agent-runtime-detection` for discovery and
`@banzae/agent-runtime-testing` only for test/conformance code.

## Minimal lifecycle

```ts
import { isRuntimeError } from '@banzae/agent-runtime-core';
import {
  createDefaultRuntimeRegistry,
  NodeFileStateStore,
  NodeMemorySecretStore,
} from '@banzae/agent-runtime-node';

const controller = new AbortController();
const registry = createDefaultRuntimeRegistry({
  stateStore: new NodeFileStateStore('.runtime-state'),
  secretStore: new NodeMemorySecretStore(),
});
const adapter = registry.create('openclaw');

try {
  const connection = await adapter.connect({
    target: { endpoint: 'wss://runtime.example.com' },
    credentialRef: 'env:OPENCLAW_GATEWAY_TOKEN',
  }, { signal: controller.signal });
  const session = await adapter.ensureSession({
    applicationSessionId: 'application-session-1',
  }, { signal: controller.signal });
  const run = await adapter.startRun({
    applicationRunId: 'application-run-1',
    idempotencyKey: 'caller-owned-key-1',
    session,
    input: { text: 'Hello' },
  }, { signal: controller.signal });
  console.log(connection.descriptor.protocolVersion, run.externalRunId);
} catch (error) {
  if (isRuntimeError(error)) console.error(error.code, error.retryable);
  else throw error;
} finally {
  controller.abort();
  await adapter.close();
}
```

Credential values must be resolved by a configured provider/store; do not put
them in source, endpoint URLs, logs, or CLI arguments.

## Detection

```ts
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { createRuntimeDetector, type RuntimeProbe } from '@banzae/agent-runtime-detection';

const controller = new AbortController();
const deterministicProbe: RuntimeProbe = {
  adapterId: 'example',
  async probe() {
    return {
      adapterId: 'example',
      matched: true,
      confidence: 1,
      runtimeProduct: 'example-runtime',
      protocolName: 'example',
      evidence: [{ kind: 'example', message: 'deterministic evidence' }],
    };
  },
};
const detector = createRuntimeDetector({
  dependencies: createTestDependencies(),
  probes: [deterministicProbe],
});
const result = await detector.detect({
  target: { endpoint: 'https://runtime.example.com' },
  options: { allowManifest: false, signal: controller.signal },
});
controller.abort();
console.log(result.selected?.adapterId);
```

Detection is discovery only: it does not send a prompt or start a run.

## Compatibility evidence model

Claims distinguish implementation, sanitized fixtures, deterministic
fake-server conformance, inspected provider source, and opt-in live reports.
One evidence class never silently upgrades another. A fake-server pass does not
prove a live runtime release, and protocol support does not imply every runtime
version is supported.

## Security principles

- Treat all runtime traffic as untrusted and validate it before normalization.
- Keep credentials behind references; redact and bound errors and diagnostics.
- Reject credentials in URLs and unsafe redirects.
- Fail closed on unknown protocols, malformed capabilities, and unsupported input.
- Require caller-owned idempotency keys and reconcile `OUTCOME_UNKNOWN` before retry.
- Bound frames, bodies, streams, queues, retries, deduplication, and recovery time.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Public API](docs/public-api.md)
- [Lifecycle](docs/lifecycle.md)
- [Capabilities](docs/capabilities.md)
- [Sessions](docs/sessions.md)
- [Runs](docs/runs.md)
- [Attachments](docs/attachments.md)
- [Scheduling](docs/scheduling.md)
- [Streaming](docs/streaming.md)
- [Approvals](docs/approvals.md)
- [Errors](docs/error-model.md)
- [Detection](docs/detection.md)
- [Security](docs/security.md)
- [Live compatibility](docs/live-compatibility.md)
- [Adapter conformance](docs/adapter-conformance.md)
- [Adapter authoring](docs/adapter-authoring.md)
- [Host application integration](docs/host-application-integration.md)
- [Runtime adapter adoption](docs/adapter-adoption.md)
- [Versioning and compatibility](docs/versioning-and-compatibility.md)
- [Runnable examples](examples/README.md)
- [Release engineering](docs/releasing.md)
- [Changelog](CHANGELOG.md)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Do not add compatibility claims,
credentials, real endpoints, or public exports without their required evidence
and review.

## License

Apache-2.0
