# Getting started

The SDK is pre-alpha, ESM-only, and requires Node.js `>=22.13` for the Node
facade. The public API is frozen only for `v0.1.0-alpha.1`.

## Install

```bash
pnpm add @banzae/agent-runtime-core @banzae/agent-runtime-openclaw @banzae/agent-runtime-hermes @banzae/agent-runtime-node
```

Add detection only when automatic discovery is needed. Keep testing utilities
out of production dependencies.

## Select and construct

Use `createDefaultRuntimeRegistry()` for Node defaults and select `openclaw` or
`hermes` explicitly when configuration already knows the runtime. Construction
does not contact the endpoint. The runnable construction-only examples are:

- [Explicit OpenClaw](../examples/openclaw-chat/index.ts)
- [Explicit Hermes](../examples/hermes-chat/index.ts)

## Connect and run

The complete provider-neutral flow is:

1. create an `AbortController`;
2. construct an adapter;
3. `connect()` with a reserved/configured target and credential reference;
4. inspect the returned descriptor and `capabilities()`;
5. `ensureSession()` with a caller-owned application ID;
6. `startRun()` with a caller-owned run ID and idempotency key;
7. consume `streamRun()` and/or reconcile with `getRun()`;
8. close the adapter in `finally`.

See the compile-checked [lifecycle](../examples/lifecycle/index.ts),
[streaming](../examples/streaming/index.ts), [cancellation](../examples/cancellation/index.ts),
and [history](../examples/history/index.ts) examples. They use a deterministic
fake runtime and never contact an external service.

## Credentials

Prefer `credentialRef` and an authorized credential provider/store. Do not put
credential values in source, endpoint URLs, descriptors, logs, CLI arguments,
or durable session/provider state. The Node environment provider accepts only
`env:VARIABLE_NAME` references. See the compile-checked
[credential provider example](../examples/credential-provider/index.ts).

## Detection

Automatic detection is bounded, cancellable, confidence-based, and
side-effect-free: it may inspect approved manifests/capability endpoints but
never sends prompts or starts runs. A configured adapter hint is selection, not
proof of reachability. See [Detection](detection.md) and the deterministic
[detection example](../examples/detect-runtime/index.ts).

## Errors and cleanup

Catch unknown values, narrow with `isRuntimeError()`, and branch on normalized
codes such as `UNSUPPORTED_CAPABILITY`, `CANCELLED`, or `OUTCOME_UNKNOWN`.
Always call `close()` in `finally`. Preserve the same idempotency key while
reconciling an unknown outcome.

## Live validation

Normal examples and pull-request CI do not contact external runtimes. Use only
the gated, opt-in [live compatibility harness](live-compatibility.md) for real
targets and credentials.
