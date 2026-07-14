# Runtime Detection

Detection is safe probing, not execution. It may check manifests,
capabilities, or handshake behavior. It must never submit a user prompt, create
a session, start a run, create schedules, write files, or trigger OpenClaw
device-pairing requests during ordinary detection.

Selection order:

1. explicit adapter configuration;
2. cached detection with matching fingerprint;
3. adapter-prefixed URL scheme;
4. well-known runtime manifest;
5. bounded parallel safe probes;
6. confidence-based selection;
7. typed ambiguous/failed result.

Default minimum confidence is `0.90`. Default ambiguity delta is `0.05`; two
high-confidence candidates inside that delta produce `DETECTION_AMBIGUOUS`.

Confidence model:

| Evidence | Confidence |
|---|---:|
| Explicit adapter configuration | `1.00` |
| Valid persisted detection with matching fingerprint | `0.99` |
| Valid provider-specific manifest | `0.95` |
| Valid OpenClaw challenge plus valid hello | `0.99` |
| Valid OpenClaw challenge only | `0.95` |
| Valid Hermes capabilities response | `0.99` |
| Connection-scheme hint only | `0.80` |
| Generic WebSocket or HTTP success | `0.00` |

Supported hints:

- `openclaw+wss://`
- `openclaw+ws://`
- `hermes+https://`
- `hermes+http://`

Hints are evidence, not authority. Explicit adapter configuration is an
authoritative configuration override: it selects the configured adapter without
probing and does not prove that the endpoint is reachable. The adapter's normal
`connect()` path performs connection validation later, so explicit selection
must not be described as runtime discovery.

## Cancellation

Each detection call owns one operation-wide abort controller linked to any
caller `AbortSignal`. The overall timeout aborts that controller. Each probe
also gets a child abort controller and a per-probe timeout that aborts the
underlying HTTP request, response body iterator, WebSocket connection, and
WebSocket event iterator. Detection closes sockets, streams, listeners, timers,
and iterators when a probe succeeds, fails, times out, the overall detection
times out, the caller aborts, or `detect()` returns.

Redirects remain unsupported during detection. HTTP transports must not follow
redirects automatically, and the previous public `allowedRedirects` option has
been removed until redirect handling is implemented.

## Fingerprints And Cache

Detection fingerprints include the normalized endpoint, adapter hint,
transport hint, and detector schema version.
They never include credential values, tokens, passwords, cookies, signatures, or
device tokens.

Persisted detection is valid only when the schema version is exactly current,
the fingerprint matches, it has not expired, the adapter remains registered,
and the cached protocol name and version are still supported by that adapter.
OpenClaw cache entries are accepted only for registered protocol v3 or v4.
Hermes cache entries are accepted only for `hermes-runs-http` protocol version
`1`. Stale or unsupported entries are deleted when they come from the configured
store, and a sanitized `detection.cache_invalid` diagnostic is emitted.

## OpenClaw Negotiation

OpenClaw authenticated detection uses the registered protocol codec registry.
It tries v4 first, then v3 only after a confirmed v4 `PROTOCOL_MISMATCH`, and
opens a fresh WebSocket for each protocol attempt. It validates the
`connect.challenge` and hello response through the selected codec schema.
Authentication failure, permission failure, pairing required, malformed
challenge, malformed hello, and transport failure fail closed and do not
downgrade. Challenge-only detection without credentials may return confidence
`0.95`; authenticated hello detection returns confidence `0.99` and records the
selected protocol version.

## Hermes Identity

Hermes detection requires Hermes-specific identity evidence. Generic HTTP 200
responses, `capabilities` arrays, and arbitrary `features` objects are not
enough. A response must either identify itself as Hermes through
`runtime`, `product`, or `runtimeProduct`, or match the documented Hermes capabilities schema
(`object: "hermes.api_server.capabilities"` and `platform: "hermes-agent"`)
with multiple recognized Hermes feature fields.

## Credentials

Credentials must be supplied through `RuntimeAuthInput` or an injected
credential provider. When `credentialRef` is supplied without inline auth, a
`RuntimeCredentialProvider` is required; missing or unresolved references fail
with `INVALID_CONFIGURATION` instead of silently falling back to unauthenticated
detection. If inline auth and `credentialRef` are both supplied, inline auth
takes precedence and the provider is not called.

URLs with embedded usernames or passwords are rejected. URLs with credential-like
query parameters such as `token`, `access_token`, `api_key`, `password`,
`secret`, `authorization`, or `device_token` are also rejected.
Credentials are never included in fingerprints, evidence, errors, logs, cache
values, or runtime descriptors.

Hermes HTTP 401 is classified as `AUTHENTICATION_REQUIRED` when no credentials
were supplied and `AUTHENTICATION_FAILED` when credentials were supplied. HTTP
403 is classified as `PERMISSION_DENIED`. Raw response bodies and
provider-supplied messages are not exposed in public detection errors.

## Example

```ts
const detector = createRuntimeDetector({
  dependencies,
  probes: [createOpenClawProbe(), createHermesProbe()],
});

const result = await detector.detect({
  target: {
    endpoint: 'https://agent.example.com',
  },
  adapterId: 'auto',
});
```
