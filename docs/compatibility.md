# Compatibility

Protocol support is explicit and fixture-backed.

| Adapter | Protocol | Initial status |
|---|---:|---|
| OpenClaw | 3 | fixture-backed against bf1 and bfp1 handshakes |
| OpenClaw | 4 | fixture-backed against bfp1 handshake and live write flow |
| Hermes | HTTP/SSE Runs API | fixture-backed against bfp1 capabilities and health |

Unknown OpenClaw protocol versions fail closed with `PROTOCOL_MISMATCH`.

Do not advertise support for protocol versions that are not in the codec
registry and compatibility matrix.

## Fixture-backed live validation

Fixture-backed validation means every claimed runtime/protocol combination has:

1. a short live handshake or capabilities capture from a real runtime;
2. sanitization that removes tokens, authorization headers, cookies, private
   hostnames, signatures, and user data;
3. a replayable fixture committed under `fixtures/`;
4. SDK tests that parse that fixture and verify the adapter still maps it to the
   expected neutral SDK contract.

Live captures are intentionally separate from normal unit tests. The live
commands require explicit environment variables and should run only from a
trusted developer or CI environment with scoped credentials.

## Live targets used during SDK bring-up

Known validation targets:

| Target | Runtime | Version |
|---|---|---|
| `bf1` | OpenClaw | `2026.4.22 (00bd2cf)` |
| `bfp1` | OpenClaw | `2026.5.6 (c97b9f7)`, protocol `3` fixture |
| `bfp1` | OpenClaw | `2026.6.11`, protocol `4` fixture |
| `bfp1` | Hermes Agent | `v0.18.2 (2026.7.7.2)`, upstream `7550c594` |

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

The bfp1 Hermes runtime is validated at `v0.18.2` using authenticated
capabilities and detailed health endpoints. Its capabilities use concrete
feature keys such as `session_resources`, `tool_progress_events`, and
`approval_events`; the SDK maps those into the neutral runtime capability
contract.

## Commands

OpenClaw capture:

```bash
OPENCLAW_GATEWAY_URL=wss://example.invalid/ \
OPENCLAW_GATEWAY_TOKEN=... \
OPENCLAW_PROTOCOL=3 \
OPENCLAW_DEVICE_PAIRING=disabled \
pnpm fixtures:capture:openclaw
```

OpenClaw live adapter validation:

```bash
OPENCLAW_GATEWAY_URL=wss://example.invalid/ \
OPENCLAW_GATEWAY_TOKEN=... \
OPENCLAW_PROTOCOL=3 \
pnpm live:openclaw
```

OpenClaw write-flow validation with opt-in SDK device pairing:

```bash
OPENCLAW_GATEWAY_URL=wss://example.invalid/ \
OPENCLAW_GATEWAY_TOKEN=... \
OPENCLAW_PROTOCOL=4 \
OPENCLAW_DEVICE_PAIRING=request \
OPENCLAW_SDK_STATE_DIR=.runtime-state/live-openclaw-bfp1 \
pnpm live:openclaw-flow
```

Hermes capture:

```bash
HERMES_BASE_URL=https://example.invalid \
HERMES_BEARER_TOKEN=... \
pnpm fixtures:capture:hermes
```

Hermes live adapter validation:

```bash
HERMES_BASE_URL=https://example.invalid \
HERMES_BEARER_TOKEN=... \
pnpm live:hermes
```

Review captured fixtures before committing. The sanitizer is defensive, but it
does not replace human review.
