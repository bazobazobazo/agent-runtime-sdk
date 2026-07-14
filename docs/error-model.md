# Error Model

Every public failure is a `RuntimeError` with an explicit retryability flag.
Messages and details are bounded and sanitized. Raw response bodies, headers,
complete URLs, stack traces, and unsafe causes are excluded by default.

| Code | Retryable | Side-effect uncertainty | Host interpretation / action |
|---|---|---|---|
| `INVALID_CONFIGURATION` | no | none | fix target, credential provider, or unsafe limits |
| `INVALID_REQUEST` | no | none/known rejection | fix caller input; do not replay unchanged |
| `INVALID_RESPONSE` | no | none unless separately documented | provider violated schema; investigate compatibility |
| `AUTHENTICATION_REQUIRED` | no | none | supply configured credentials |
| `AUTHENTICATION_FAILED` | no | none | replace/re-authorize credentials |
| `PERMISSION_DENIED` | no | none | change provider authorization, not protocol version |
| `PAIRING_REQUIRED` | no | none | complete approved pairing outside ordinary detection |
| `PROTOCOL_MISMATCH` | no | none | choose a registered protocol; downgrade only on confirmed mismatch |
| `UNSUPPORTED_CAPABILITY` | no | none | gate operation on advertised capability |
| `NOT_FOUND` | no | none | verify external ID and lifecycle |
| `CONFLICT` | no | known provider state conflict | reconcile state before another action |
| `RATE_LIMITED` | yes | normally none | honor bounded `retryAfterMs` |
| `RUNTIME_UNAVAILABLE` / `PROVIDER_UNAVAILABLE` | yes | operation-specific | reconnect/retry within host policy |
| `TIMEOUT` | yes | operation-specific | retry read-only work; inspect mutation semantics |
| `CANCELLED` | no | operation-specific | caller stopped waiting; reconcile mutations if needed |
| `OUTCOME_UNKNOWN` | yes with same key | yes | reconcile status; never invent a new idempotency key |
| `PROVIDER_ERROR` | generally no | documented by operation | generic safe provider failure; inspect safe metadata |

Authentication, permission, pairing, malformed data, and transport failures are
never relabeled as protocol mismatch to trigger downgrade. Malformed provider
payloads use `INVALID_RESPONSE`; confirmed availability failures use
`PROVIDER_UNAVAILABLE`; bounded wait expiry uses `TIMEOUT`.
