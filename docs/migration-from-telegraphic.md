# Migration from Telegraphic OpenClaw Client

Immediate stabilization for existing applications:

1. Pin `@telegraphic-dev/openclaw-gateway-client` to the resolved version.
2. Keep it only in the legacy path.
3. Add runtime SDK dependencies behind feature flags.
4. Shadow-detect configured runtimes without submitting prompts.
5. Cut over one agent at a time after adapter tests pass.
6. Remove Telegraphic after rollback validation.

The SDK differs from Telegraphic by requiring caller-owned idempotency keys and
by keeping provider DTOs inside the adapter package.
