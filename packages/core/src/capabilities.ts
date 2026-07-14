import { RuntimeError, unsupportedCapability } from './errors.js';
import type {
  RuntimeCapabilities,
  RuntimeCapabilityName,
  RuntimeUserInput,
} from './types.js';

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
  extensions: {},
};

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
    extensions: { ...base.extensions, ...patch.extensions },
  };
}
