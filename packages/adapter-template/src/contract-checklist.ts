export const adapterContractChecklist = [
  'safe probe',
  'connect without user prompt execution',
  'health and capabilities',
  'ensureSession idempotency',
  'caller-owned idempotency key in startRun',
  'stream or poll completion',
  'history retrieval',
  'cancel idempotency',
  'sanitized errors',
  'unsupported attachment rejection',
] as const;
