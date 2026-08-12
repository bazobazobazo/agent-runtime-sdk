# Changelog

## 0.1.0-alpha.3

- Add an optional `RuntimeWebSocketConnection.terminate()` transport hook.
  Adapters use it to release half-open resources when graceful close cannot be
  confirmed; transports without the hook remain source-compatible and recovery
  fails closed instead of opening a potentially competing socket.

## 0.1.0-alpha.1 — release candidate

- Initial synchronized pre-alpha release candidate.
- See the repository changelog and release notes for features, security posture, migration guidance, and known limitations.
