import { normalizeRuntimeTimestamp, type RuntimeMessage } from '@banzae/agent-runtime-core';

export function normalizeOpenClawHistory(payload: unknown): RuntimeMessage[] {
  const messages = Array.isArray((payload as { messages?: unknown })?.messages)
    ? ((payload as { messages: unknown[] }).messages)
    : Array.isArray(payload)
      ? payload
      : [];

  return messages.flatMap((message): RuntimeMessage[] => {
    if (!message || typeof message !== 'object') return [];
    const value = message as Record<string, unknown>;
    const role = normalizeRole(value.role);
    const content = normalizeContent(value.content ?? value.text ?? value.message);
    if (!role || !content) return [];
    return [
      {
        id: typeof value.id === 'string' ? value.id : undefined,
        role,
        content,
        createdAt: normalizeRuntimeTimestamp(value.createdAt ?? value.created_at ?? value.timestamp),
        metadata: { provider: 'openclaw', runId: value.runId, sequence: value.sequence },
      },
    ];
  });
}

function normalizeRole(value: unknown): RuntimeMessage['role'] | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value;
  return undefined;
}

function normalizeContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => (typeof part === 'string' ? part : (part as { text?: unknown })?.text))
      .filter((part): part is string => typeof part === 'string')
      .join('');
    return text || undefined;
  }
  return undefined;
}
