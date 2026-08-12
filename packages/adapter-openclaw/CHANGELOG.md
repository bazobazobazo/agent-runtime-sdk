# Changelog

## 0.1.0-alpha.6

- Add an opt-in compatibility switch for validated gateways that implement
  `chat.history` without advertising the method.

## 0.1.0-alpha.5

- Check bounded session history after queued or running provider wait
  responses and preserve sanitized idle-session evidence for host recovery.

## 0.1.0-alpha.4

- Preserve projected OpenClaw message IDs, idempotency keys, and numeric
  timestamps when normalizing session history.
- Return sanitized active-run evidence when terminal cache entries expire and
  expand the bounded history reconciliation window to 1,000 messages.

## 0.1.0-alpha.3

- Recover accepted runs safely after socket loss without resubmitting them.
- Serialize and bound reconnects, close suspect dispatchers after request
  failures, and require strict completion-history correlation.
- Preserve queued terminal events and report closed lifecycle/capabilities
  accurately.
- Preserve timeout and caller-cancellation errors through status/history
  reconciliation, and close a dispatcher after in-flight cancellation so a
  late response cannot satisfy a reused deterministic request ID.
- Correlate terminal-cache-expiry recovery with the exact run identity retained
  by current OpenClaw `chat.history` messages.

## 0.1.0-alpha.2

- Normalize OpenClaw `chat.abort` misses as cancellation failures instead of accepted cancellations.
- Expose explicit stored device-pairing evidence in runtime capability metadata.

## 0.1.0-alpha.1 — release candidate

- Initial synchronized pre-alpha release candidate.
- See the repository changelog and release notes for features, security posture, migration guidance, and known limitations.
