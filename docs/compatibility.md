# Compatibility

Protocol support is explicit and fixture-backed. Fixture coverage protects the
wire-format mapping, but it is not a substitute for confirming the live
integration suite in the target release environment.

The SDK supports OpenClaw wire protocol versions explicitly registered and
validated by the codec registry.

| SDK adapter | Protocol | Runtime version | Recorded SDK commit | Evidence type | Date | Checks completed | Status / limitations |
|---|---|---|---|---|---|---|---|
| OpenClaw | v3 | pinned fixture targets | `7ba46df` | synthetic fixture validated; fake-server conformance validated | 2026-07-14 | connection, sessions, runs, stream, status, history, cancellation, cleanup | supported; new harness report pending for each deployment |
| OpenClaw | v4 | pinned fixture targets | `7ba46df` | synthetic fixture validated; fake-server conformance validated | 2026-07-14 | connection, sessions, runs, stream, status, history, cancellation, cleanup | supported; new harness report pending for each deployment |
| Hermes | HTTP/SSE Runs v1 | documented target `0.18.2`; no live run report | `7ba46df` | synthetic fixture validated; fake-server conformance validated; live validation pending | 2026-07-14 | capabilities, health, sessions, runs, SSE recovery, approvals, cancellation, cleanup | implemented; live validation pending |

Runtime auto-detection currently supports only OpenClaw and Hermes. Codex and Pi
remain private placeholders and are not registered probes.

Unknown OpenClaw protocol versions fail closed with `PROTOCOL_MISMATCH`. Do not
advertise support for protocol versions that are not in the codec registry and
compatibility matrix.

OpenClaw runtime product version, OpenClaw wire protocol version, SDK adapter
version, and fixture capture version are separate values. A runtime product
upgrade may or may not change the gateway wire protocol.

## Fixture-backed validation

Fixture-backed validation means every claimed runtime/protocol combination has:

1. version-owned request, response, event, and error fixtures;
2. sanitization that removes tokens, authorization headers, cookies, private
   hostnames, signatures, and user data;
3. a replayable fixture committed under `fixtures/`;
4. SDK tests that parse that fixture and verify the adapter still maps it to the
   expected neutral SDK contract.

Live integration validation is a separate, stronger check. It runs the SDK
against a real target runtime and exercises state-changing behavior such as
session creation, run creation, streaming, history reads, and cancellation. Until
those live commands are confirmed for the target release environment, treat the
SDK as an initial scaffold even when fixture-backed replay tests pass.

Shared fake-server conformance adds provider-neutral lifecycle, capability,
session, run, stream, status, cancellation, concurrency, security, and resource
cleanup evidence. It remains synthetic evidence and does not change Hermes to
live-supported.

Live captures are intentionally separate from normal unit tests. The live
commands require explicit environment variables and should run only from a
trusted developer or CI environment with scoped credentials.

The new live harness does not upgrade any row merely by existing. A row may use
`sanitized live validated` only after a report from the protected workflow is
reviewed and recorded for the exact SDK commit and runtime version.

## OpenClaw Stream Reconciliation

OpenClaw provider events are correlated to the active SDK run by provider run ID
and, where a run ID is not present, by an explicit session key on recognized
run-scoped event types. Unrelated gateway events are ignored.

When OpenClaw supplies sequence numbers, the adapter tracks them per SDK run
stream. A missing sequence range emits a `transport.gap` event before continuing
with later events. Callers must treat that stream as requiring reconciliation and
fetch provider history, for example through `getHistory()`, before presenting or
persisting a complete transcript claim.

## OpenClaw Codec Registry

The OpenClaw adapter registers exact numeric protocol codecs. The default
preferred order is:

1. v4
2. v3

Automatic negotiation opens a fresh socket for each protocol attempt. The SDK
downgrades only after a confirmed protocol mismatch. It does not downgrade on
authentication failure, device-pairing requirements, authorization failure,
malformed frames, malformed hello responses, or transport failures.

## Live targets used during SDK bring-up

Known validation targets:

| Target | Runtime | Version |
|---|---|---|
| `bf1` | OpenClaw | `2026.4.22 (00bd2cf)` |
| `bfp1` | OpenClaw | `2026.5.6 (c97b9f7)`, protocol `3` fixture |
| `bfp1` | OpenClaw | `2026.6.11`, protocol `4` fixture |
| `bfp1` | Hermes Agent | capabilities and health observed at `v0.18.2`; full live adapter suite not run |

OpenClaw runtime version is not the same thing as gateway protocol version.
The same bfp1 host validated as protocol `3` on OpenClaw `2026.5.6` and
protocol `4` after upgrading to OpenClaw `2026.6.11`.

OpenClaw token auth is token-only by default. Device pairing is opt-in for
validation flows that deliberately need a device token; the SDK must not create
new pending pairing requests during ordinary token validation.

The bfp1 OpenClaw v4 live flow is validated with an approved SDK operator device
token scoped to `operator.read` and `operator.write`. The flow creates a
session, starts a chat run, observes the expected response, reads history, and
submits `chat.abort` against a real provider run handle.

The bfp1 Hermes capture proves only that authenticated capabilities and
detailed health were reachable at `v0.18.2`. It is not evidence that run
creation, streaming, recovery, approvals, cancellation, or REST session
history passed the live adapter suite. Hermes therefore remains provisional
until that state-changing suite records a tested runtime version.

Hermes detached SSE buffers expire after five minutes. The SDK does not use
`Last-Event-ID`, because current source does not establish replay support. On
stream disconnect it polls run status, performs bounded reconnects, then falls
back to bounded status polling. Caller-provided `Idempotency-Key` values are
preserved exactly and are not replaced by the adapter.

## Current commands

OpenClaw capture:

```bash
OPENCLAW_GATEWAY_URL=wss://example.invalid/ \
OPENCLAW_GATEWAY_TOKEN=... \
OPENCLAW_PROTOCOL=3 \
OPENCLAW_DEVICE_PAIRING=disabled \
pnpm fixtures:capture:openclaw
```

OpenClaw read-only live validation:

```bash
RUNTIME_LIVE_ENABLED=true \
OPENCLAW_ENDPOINT=wss://example.invalid/ \
OPENCLAW_CREDENTIAL_REF=env:OPENCLAW_GATEWAY_TOKEN \
OPENCLAW_GATEWAY_TOKEN='<environment secret>' \
OPENCLAW_PROTOCOL=auto \
pnpm live:openclaw
```

Hermes capture:

```bash
HERMES_BASE_URL=https://example.invalid \
HERMES_BEARER_TOKEN=... \
pnpm fixtures:capture:hermes
```

Hermes read-only live validation:

```bash
RUNTIME_LIVE_ENABLED=true \
HERMES_ENDPOINT=https://example.invalid \
HERMES_CREDENTIAL_REF=env:HERMES_API_TOKEN \
HERMES_API_TOKEN='<environment secret>' \
pnpm live:hermes
```

See `live-compatibility.md` for mutation gates, reports, fixture candidates,
comparison, and the protected manual workflow. Review every candidate before
committing; sanitization does not replace human review.
