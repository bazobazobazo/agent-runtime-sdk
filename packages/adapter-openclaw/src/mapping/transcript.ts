import { normalizeRuntimeTimestamp, type RuntimeMessage } from '@banzae/agent-runtime-core';

export function normalizeOpenClawHistory(payload: unknown): RuntimeMessage[] {
  const messages = Array.isArray((payload as { messages?: unknown })?.messages)
    ? ((payload as { messages: unknown[] }).messages)
    : Array.isArray(payload)
      ? payload
      : [];
  const applicationRunIds = correlateFinalAssistantApplicationRuns(messages);

  return messages.flatMap((message, index): RuntimeMessage[] => {
    if (!message || typeof message !== 'object') return [];
    const value = message as Record<string, unknown>;
    const role = normalizeRole(value.role);
    const content = normalizeContent(value.content ?? value.text ?? value.message);
    const attachments = normalizeAttachments(value);
    const openClaw = openClawMetadata(value);
    const runId = normalizeHistoryRunId(value, openClaw);
    const applicationRunId = role === 'assistant' ? applicationRunIds.get(index) : undefined;
    if (!role || (!content && attachments.length === 0)) return [];
    return [
      {
        id: uniqueHistoryIdentifier(value.id, openClaw?.id),
        role,
        content: content ?? '',
        createdAt: normalizeHistoryTimestamp(
          value.createdAt,
          value.created_at,
          value.timestamp,
          openClaw?.recordTimestampMs,
        ),
        ...(attachments.length > 0 ? { attachments } : {}),
        metadata: {
          provider: 'openclaw',
          runId,
          applicationRunId,
          sequence: value.sequence,
          ...(attachments.length > 0 ? { attachmentCount: attachments.length } : {}),
        },
      },
    ];
  });
}

function correlateFinalAssistantApplicationRuns(messages: readonly unknown[]): Map<number, string> {
  const correlated = new Map<number, string>();
  let applicationRunId: string | undefined;
  let finalAssistantIndexes: number[] = [];

  const finishSegment = () => {
    const [finalAssistantIndex] = finalAssistantIndexes;
    if (
      applicationRunId &&
      finalAssistantIndexes.length === 1 &&
      finalAssistantIndex !== undefined
    ) {
      correlated.set(finalAssistantIndex, applicationRunId);
    }
    applicationRunId = undefined;
    finalAssistantIndexes = [];
  };

  messages.forEach((message, index) => {
    if (!message || typeof message !== 'object') return;
    const value = message as Record<string, unknown>;
    const role = normalizeRole(value.role);
    const openClaw = openClawMetadata(value);
    if (role === 'user') {
      if (applicationRunId && isRestartRecoveryPrompt(value, openClaw)) return;
      finishSegment();
      applicationRunId = normalizeUserApplicationRunId(value, openClaw);
      return;
    }
    if (
      role === 'assistant' &&
      applicationRunId &&
      hasUniqueFinalAssistantMarker(value, openClaw)
    ) {
      finalAssistantIndexes.push(index);
    }
  });
  finishSegment();
  return correlated;
}

function isRestartRecoveryPrompt(
  value: Record<string, unknown>,
  openClaw: Record<string, unknown> | undefined,
): boolean {
  const marker = uniqueHistoryIdentifier(
    value.idempotencyKey,
    openClaw?.idempotencyKey,
  );
  return marker !== undefined &&
    /^codex-app-server:[^:\u0000-\u001f\u007f]{1,256}:[A-Za-z0-9][A-Za-z0-9._-]{0,255}:prompt$/.test(marker);
}

function normalizeUserApplicationRunId(
  value: Record<string, unknown>,
  openClaw: Record<string, unknown> | undefined,
): string | undefined {
  const marker = uniqueHistoryIdentifier(
    value.idempotencyKey,
    openClaw?.idempotencyKey,
  );
  if (!marker?.endsWith(':user')) return undefined;
  const applicationRunId = marker.slice(0, -':user'.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(applicationRunId)
    ? applicationRunId
    : undefined;
}

function hasUniqueFinalAssistantMarker(
  value: Record<string, unknown>,
  openClaw: Record<string, unknown> | undefined,
): boolean {
  const marker = uniqueHistoryIdentifier(
    value.idempotencyKey,
    openClaw?.idempotencyKey,
  );
  return marker !== undefined &&
    /^codex-app-server:[^:\u0000-\u001f\u007f]{1,256}:[A-Za-z0-9][A-Za-z0-9._-]{0,255}:assistant$/.test(marker);
}

function openClawMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return value.__openclaw && typeof value.__openclaw === 'object' && !Array.isArray(value.__openclaw)
    ? value.__openclaw as Record<string, unknown>
    : undefined;
}

function normalizeHistoryRunId(
  value: Record<string, unknown>,
  openClaw: Record<string, unknown> | undefined,
): string | undefined {
  const candidates = [value.runId, value.idempotencyKey, openClaw?.runId, openClaw?.idempotencyKey]
    .map(safeHistoryIdentifier)
    .filter((candidate): candidate is string => candidate !== undefined);
  const unique = [...new Set(candidates)];

  // Current OpenClaw chat.history retains the chat.send idempotency key on
  // normal assistant messages and projects it into __openclaw metadata. Some
  // synthesized messages use __openclaw.runId instead. These are provider run
  // identities; conflicts are ambiguous and must never be completion evidence.
  return unique.length === 1 ? unique[0] : undefined;
}

function uniqueHistoryIdentifier(...values: unknown[]): string | undefined {
  const candidates = values
    .map(safeHistoryIdentifier)
    .filter((candidate): candidate is string => candidate !== undefined);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function normalizeHistoryTimestamp(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeRuntimeTimestamp(value);
    if (normalized) return normalized;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function safeHistoryIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
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
