# Runtime Detection

Detection is safe probing, not execution. It may check health, capabilities, or
handshake behavior. It must never submit a user prompt to multiple runtimes.

Selection order:

1. explicit adapter configuration;
2. cached detection with matching fingerprint;
3. adapter-prefixed URL scheme;
4. well-known runtime manifest;
5. bounded parallel safe probes;
6. typed ambiguous/failed result.

Auto-selection requires confidence `>= 0.90`, a margin of `>= 0.15` over the
next candidate, and no conflicting authenticated identity.
