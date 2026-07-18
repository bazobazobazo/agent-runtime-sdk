import { RuntimeError, unsupportedCapability } from './errors.js';
import type {
  RuntimeAttachment,
  RuntimeCapabilities,
  RuntimeCapabilityName,
  RuntimeUserInput,
} from './types.js';

/** Fail-closed capability set used before runtime evidence is available. */
export const NO_CAPABILITIES: RuntimeCapabilities = {
  schemaVersion: 1,
  sessions: { create: false, resume: false, history: false, fork: false },
  runs: {
    start: false,
    status: false,
    stream: false,
    cancel: false,
    approvals: false,
  },
  input: { text: false, images: false, files: false },
  output: { text: false, reasoning: false, tools: false, usage: false },
  health: { liveness: false, readiness: false },
  schedules: { create: false, get: false, list: false, update: false, delete: false, enable: false, pause: false, trigger: false, history: false },
  extensions: {},
};

export const TEXT_RUN_CAPABILITIES: RuntimeCapabilities = {
  schemaVersion: 1,
  sessions: { create: true, resume: true, history: true, fork: false },
  runs: {
    start: true,
    status: true,
    stream: true,
    cancel: true,
    approvals: false,
  },
  input: { text: true, images: false, files: false },
  output: { text: true, reasoning: false, tools: false, usage: false },
  health: { liveness: true, readiness: false },
  schedules: { create: false, get: false, list: false, update: false, delete: false, enable: false, pause: false, trigger: false, history: false },
  extensions: {},
};

/** Public alpha contract for supports capability. */
export function supportsCapability(
  capabilities: RuntimeCapabilities,
  capability: RuntimeCapabilityName,
): boolean {
  const [group, name] = capability.split('.') as [
    keyof Omit<RuntimeCapabilities, 'schemaVersion' | 'extensions'>,
    string,
  ];
  const groupValue = capabilities[group] as Record<string, boolean> | undefined;
  return groupValue?.[name] === true;
}

/** Public alpha contract for require capability. */
export function requireCapability(
  capabilities: RuntimeCapabilities,
  capability: RuntimeCapabilityName,
): void {
  if (!supportsCapability(capabilities, capability)) {
    throw unsupportedCapability(`Runtime does not support ${capability}`, { capability });
  }
}

export function validateInputCapabilities(
  capabilities: RuntimeCapabilities,
  input: RuntimeUserInput,
): void {
  if (input.text.trim() && !capabilities.input.text) {
    throw unsupportedCapability('Runtime does not support text input', { capability: 'input.text' });
  }

  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === 'image' && !capabilities.input.images) {
      throw unsupportedCapability('Runtime does not support image input', {
        capability: 'input.images',
        attachmentName: attachment.name,
        mimeType: attachment.mimeType,
      });
    }
    if (attachment.kind === 'file' && !capabilities.input.files) {
      throw unsupportedCapability('Runtime does not support file input', {
        capability: 'input.files',
        attachmentName: attachment.name,
        mimeType: attachment.mimeType,
      });
    }
  }
}

/** Validate attachment metadata and bounded inline content before provider activity. */
export function validateRuntimeAttachments(
  attachments: readonly RuntimeAttachment[] | undefined,
  limits: { maxCount: number; maxBytes: number },
): void {
  if (!attachments) return;
  if (attachments.length > limits.maxCount) invalidAttachment('Attachment count exceeds the configured limit');
  for (const attachment of attachments) {
    if (!(attachment.data instanceof Uint8Array)) invalidAttachment('Attachment data must be a bounded byte source');
    if (attachment.data.byteLength > limits.maxBytes) invalidAttachment('Attachment exceeds the configured size limit');
    if (attachment.byteSize !== undefined && attachment.byteSize !== attachment.data.byteLength) {
      invalidAttachment('Attachment declared size does not match its byte source');
    }
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(attachment.mimeType)) {
      invalidAttachment('Attachment MIME type is invalid');
    }
    const name = attachment.name;
    if (name !== undefined && (!name || name.length > 255 || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name))) {
      invalidAttachment('Attachment filename is invalid');
    }
    if (attachment.kind === 'file' && !name) invalidAttachment('File attachments require a filename');
    if (attachment.kind === 'image' && !attachment.mimeType.toLowerCase().startsWith('image/')) {
      invalidAttachment('Image attachment MIME type must be image/*');
    }
    if (attachment.contentHash !== undefined && !/^(?:sha256:)?[a-f0-9]{64}$/i.test(attachment.contentHash)) {
      invalidAttachment('Attachment content hash is invalid');
    }
  }
}

function invalidAttachment(message: string): never {
  throw new RuntimeError({ code: 'INVALID_REQUEST', retryable: false, message });
}

export function assertStartRunInput(input: { idempotencyKey: string; applicationRunId: string }): void {
  if (!input.applicationRunId.trim()) {
    throw new RuntimeError({
      code: 'INVALID_REQUEST',
      retryable: false,
      message: 'applicationRunId is required',
    });
  }
  if (!input.idempotencyKey.trim()) {
    throw new RuntimeError({
      code: 'INVALID_REQUEST',
      retryable: false,
      message: 'Caller-provided idempotencyKey is required',
    });
  }
}

export function mergeCapabilities(
  base: RuntimeCapabilities,
  patch: Partial<RuntimeCapabilities>,
): RuntimeCapabilities {
  return {
    schemaVersion: 1,
    sessions: { ...base.sessions, ...patch.sessions },
    runs: { ...base.runs, ...patch.runs },
    input: { ...base.input, ...patch.input },
    output: { ...base.output, ...patch.output },
    health: { ...base.health, ...patch.health },
    schedules: { ...base.schedules!, ...patch.schedules },
    extensions: { ...base.extensions, ...patch.extensions },
  };
}
