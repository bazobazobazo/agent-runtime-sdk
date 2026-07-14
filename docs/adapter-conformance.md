# Adapter Conformance

## Purpose

The shared conformance suite applies the same provider-neutral behavioral
contract to OpenClaw protocol v3, OpenClaw protocol v4, and Hermes Runs
HTTP/SSE. It tests through `AgentRuntimeAdapter` only. Provider wire formats,
fake-server controls, and protocol-specific recovery tests remain outside the
shared assertions.

Passing conformance means an adapter behaved consistently against a controlled
fake runtime. It does not mean a live runtime version was validated. Live
compatibility requires a separate sanitized report tied to the SDK commit,
adapter version, runtime version, and protocol version.

## Public testing API

`@banzae/agent-runtime-testing` exports:

- `createRuntimeAdapterConformanceSuite` and its factory/scenario types;
- normalized event collection and `RuntimeError` assertions;
- resource snapshot and leak assertions;
- deterministic clock and ID generator;
- synthetic secret marker helpers;
- testing-only fake OpenClaw v3, OpenClaw v4, and Hermes controllers.

The suite is test-runner independent. It returns named cases with a category and
an async `run()` operation. Repositories may register those cases with Vitest,
Jest, Node test, or another runner.

## Shared categories

- shared lifecycle state, repeated connect/close, and descriptor separation;
- fail-closed capability reporting;
- session ID idempotency and isolation;
- text run creation and exact caller idempotency keys;
- unsupported attachment preflight;
- stream correlation, deduplication, terminal uniqueness, and raw-payload
  defaults;
- normalized status and cancellation state;
- capability-conditional approvals and history;
- concurrent session/run isolation;
- iterator and adapter resource cleanup;
- safe negative connection outcomes.

Capability-conditional cases skip operations that are not advertised. An
advertised operation must be callable and return real normalized data; it may
not be represented by a silent no-op or empty placeholder.

## Provider-specific contracts

The common contract is not weakened for wire differences. Separate suites keep
coverage for:

- OpenClaw codec selection, fresh-socket downgrade, pairing/device state,
  reverse-order RPC responses, sequence gaps, and bounded subscriber queues;
- Hermes session modes, Retry-After, approval wire choices, bounded SSE
  reconnect/polling reconciliation, event-buffer expiry, and the absence of a
  generated successor `previousResponseId`.

## Fake runtime resource measurements

Controllers expose safe counters for open connections, pending requests,
active response iterators, listener/subscription registrations, active runs,
received idempotency keys, negotiated protocol versions, and shutdown state.
The shared suite compares counters around iterator return and requires zero
transport resources after completion and close.

Stress coverage remains deterministic: the OpenClaw dispatcher suite exercises
10,000 sequential RPC responses, 1,000 reverse-order concurrent responses, and
1,000 aborts without iterator growth; Hermes processes 10,000 provider events
through a bounded deduplication window. The detection guardrail performs 1,000
operations while diagnostic callbacks deliberately fail. These are generous
quadratic-regression guardrails rather than microbenchmarks.

## Adding a future adapter

1. Build a controller that implements the injected HTTP, WebSocket, or process
   transport boundary.
2. Expose resource counters and scenario controls without exposing credentials.
3. Create the adapter only through its public constructor/factory.
4. Supply expected capabilities and provider-neutral session/run inputs.
5. Register every returned shared case in the repository test runner.
6. Keep protocol-only assertions in a provider-specific suite.
7. Run the complete release gate and document fake versus live evidence
   separately.
