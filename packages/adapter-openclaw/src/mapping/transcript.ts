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
    const attachments = normalizeAttachments(value);
    if (!role || (!content && attachments.length === 0)) return [];
    return [
      {
        id: typeof value.id === 'string' ? value.id : undefined,
        role,
        content: content ?? '',
        createdAt: normalizeRuntimeTimestamp(value.createdAt ?? value.created_at ?? value.timestamp),
        ...(attachments.length > 0 ? { attachments } : {}),
        metadata: {
          provider: 'openclaw',
          runId: value.runId,
          sequence: value.sequence,
          ...(attachments.length > 0 ? { attachmentCount: attachments.length } : {}),
        },
      },
    ];
  });
}

function normalizeRole(value: unknown): RuntimeMessage['role'] | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value;
  if (typeof value === 'string' && value.toLowerCase() === 'toolresult') return 'tool';
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

function normalizeAttachments(value: Record<string, unknown>): NonNullable<RuntimeMessage['attachments']> {
  const candidates: NonNullable<RuntimeMessage['attachments']> = [];
  if (Array.isArray(value.content)) {
    for (const part of value.content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      const kind = attachmentKind(record.type, record.mimeType ?? record.mime_type);
      if (!kind) continue;
      candidates.push(compactAttachment({
        kind,
        mimeType: safeMimeType(record.mimeType ?? record.mime_type),
        name: safeFileName(record.fileName ?? record.filename ?? record.name),
        uri: safeOpaqueUri(record.uri ?? record.url),
      }));
    }
  }

  if (Array.isArray(value.attachments)) {
    for (const part of value.attachments) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      const mimeType = safeMimeType(record.mimeType ?? record.mime_type);
      const kind = attachmentKind(record.type ?? record.kind, mimeType);
      if (!kind) continue;
      candidates.push(compactAttachment({
        kind,
        mimeType,
        name: safeFileName(record.fileName ?? record.filename ?? record.name),
        uri: safeOpaqueUri(record.uri ?? record.url ?? record.reference),
      }));
    }
  }

  const paths = Array.isArray(value.MediaPaths)
    ? value.MediaPaths
    : typeof value.MediaPath === 'string'
      ? [value.MediaPath]
      : [];
  const types = Array.isArray(value.MediaTypes)
    ? value.MediaTypes
    : value.MediaType !== undefined
      ? [value.MediaType]
      : [];
  for (let index = 0; index < Math.max(paths.length, types.length); index += 1) {
    const mimeType = safeMimeType(types[index]);
    const kind = attachmentKind(undefined, mimeType);
    if (!kind) continue;
    candidates.push(compactAttachment({ kind, mimeType, uri: safeOpaqueUri(paths[index]) }));
  }

  const seen = new Set<string>();
  return candidates.filter((attachment) => {
    const key = JSON.stringify(attachment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachmentKind(type: unknown, mimeType: unknown): 'image' | 'file' | undefined {
  if (type === 'image') return 'image';
  if (type === 'file' || type === 'attachment') return 'file';
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/') ? 'image' :
    typeof mimeType === 'string' ? 'file' : undefined;
}

function safeMimeType(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 127 &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function safeFileName(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 &&
    !/[\\/\u0000-\u001f\u007f]/.test(value) && value !== '.' && value !== '..'
    ? value
    : undefined;
}

function safeOpaqueUri(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 512 && /^(?:media|attachment):\/\/[a-z0-9._~!$&'()*+,;=:@%/-]+$/i.test(value)
    ? value
    : undefined;
}

function compactAttachment(
  value: NonNullable<RuntimeMessage['attachments']>[number],
): NonNullable<RuntimeMessage['attachments']>[number] {
  return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)) as
    NonNullable<RuntimeMessage['attachments']>[number];
}
