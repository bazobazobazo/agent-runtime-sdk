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

Hints are evidence, not authority. Explicit adapter configuration overrides
automatic detection.

## Fingerprints And Cache

Detection fingerprints include the normalized endpoint, adapter hint,
credential reference identifier, transport hint, and detector schema version.
They never include credential values, tokens, passwords, cookies, signatures, or
device tokens.

Persisted detection is valid only when the fingerprint matches, it has not
expired, the adapter remains registered, and the protocol remains supported.

## Credentials

Credentials must be supplied through `RuntimeAuthInput` or an injected
credential provider. URLs with embedded usernames or passwords are rejected.
Credentials are never included in fingerprints, evidence, errors, logs, cache
values, or runtime descriptors.

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
