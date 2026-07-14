# Security and Resilience Migration Note

This pre-alpha change adds provider-neutral `SECURE_RUNTIME_LIMITS`,
`HARD_RUNTIME_LIMITS`, `SecureRuntimeLimitName`, `resolveSecureLimit`, and
`sanitizeProviderPayload` exports from core. Existing adapter options keep their
names but now reject zero, negative, fractional, or excessive values.

Malformed OpenClaw frames, oversized provider frames, and malformed Hermes
payloads consistently use `INVALID_RESPONSE` instead of generic provider
errors. Public provider messages and unsafe causes are no longer preserved
verbatim. Endpoint fingerprints no longer include query strings, credential
references, or arbitrary connection options; cached keys derived from older
fingerprints should be treated as stale.

Node transports no longer follow redirects and reject URL userinfo and
credential-like query parameters before network activity. Hosts relying on
redirects must resolve and validate the final runtime endpoint explicitly.
