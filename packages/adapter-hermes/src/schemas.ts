import {
  RuntimeError,
  normalizeRuntimeTimestamp,
  type RuntimeMessage,
  type RuntimeRunStatus,
} from '@banzae/agent-runtime-core';

export type HermesRunCreate = {
  runId: string;
  status: 'started';
};

export type HermesRunStatus = {
  value: Record<string, unknown>;
  runId: string;
  status: RuntimeRunStatus;
  output?: string;
  usage?: Readonly<Record<string, number>>;
  sessionId?: string;
  error?: { code: string };
};

export type HermesApprovalChoice = 'once' | 'session' | 'always' | 'deny';

export function validateHealth(value: unknown): { status: 'ok'; platform: 'hermes-agent'; version: string } {
  const record = requiredRecord(value, 'Hermes liveness response');
  if (record.status !== 'ok' || record.platform !== 'hermes-agent') {
    throw invalidResponse('Hermes liveness response was malformed', 'health');
  }
  const version = requiredString(record.version, 'Hermes liveness version');
  return { status: 'ok', platform: 'hermes-agent', version };
}

export function validateDetailedHealth(value: unknown): { status: string; platform: 'hermes-agent'; version: string } {
  const record = requiredRecord(value, 'Hermes readiness response');
  const status = requiredString(record.status, 'Hermes readiness status');
  if (!['ok', 'healthy', 'degraded', 'starting', 'unavailable', 'error'].includes(status)) {
    throw invalidResponse('Hermes readiness status was unknown', 'health.detailed');
  }
  if (record.platform !== 'hermes-agent') throw invalidResponse('Hermes readiness platform was malformed', 'health.detailed');
  const version = requiredString(record.version, 'Hermes readiness version');
  return { status, platform: 'hermes-agent', version };
}

export function validateRunCreateResponse(value: unknown): HermesRunCreate {
  const record = requiredRecord(value, 'Hermes run creation response');
  const runId = requiredIdentifier(record.run_id, 'Hermes run creation run_id');
  if (record.status !== 'started') throw invalidResponse('Hermes run creation status was malformed', 'run.create');
  return { runId, status: 'started' };
}

export function validateRunStatusResponse(value: unknown): HermesRunStatus {
  const record = requiredRecord(value, 'Hermes run status response');
  if (record.object !== 'hermes.run') throw invalidResponse('Hermes run status object was malformed', 'run.status');
  const runId = requiredIdentifier(record.run_id, 'Hermes run status run_id');
  const providerStatus = requiredString(record.status, 'Hermes run status');
  const status = normalizeStatus(providerStatus);
  optionalString(record.session_id, 'Hermes run session_id', true);
  optionalText(record.output, 'Hermes run output');
  const normalizedUsage = record.usage === undefined ? undefined : validateUsage(record.usage);
  let error: { code: string } | undefined;
  if (status === 'failed') {
    error = validateRunFailure(record.error);
  } else if (record.error !== undefined && record.error !== null) {
    throw invalidResponse('Hermes non-failed run contained an error', 'run.status');
  }
  if (status === 'completed' && typeof record.output !== 'string') {
    throw invalidResponse('Hermes completed run omitted output', 'run.status');
  }
  if (status !== 'completed' && record.output !== undefined && record.output !== null) {
    throw invalidResponse('Hermes non-completed run contained output', 'run.status');
  }
  if (status !== 'completed' && normalizedUsage !== undefined) {
    throw invalidResponse('Hermes non-completed run contained usage', 'run.status');
  }
  if (status === 'unknown' && (record.output !== undefined || record.usage !== undefined || record.error !== undefined)) {
    throw invalidResponse('Hermes unknown run status contained terminal data', 'run.status');
  }
  return {
    value: record,
    runId,
    status,
    output: stringValue(record.output),
    usage: normalizedUsage,
    sessionId: stringValue(record.session_id),
    error,
  };
}

export function validateUsage(value: unknown): Readonly<Record<string, number>> {
  const record = requiredRecord(value, 'Hermes run usage');
  const output: Record<string, number> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    const nested = record[key];
    if (typeof nested !== 'number' || !Number.isInteger(nested) || nested < 0) {
      throw invalidResponse(`Hermes usage ${key} was malformed`, 'run.usage');
    }
    output[key] = nested;
  }
  return output;
}

export function validateRunFailure(value: unknown): { code: string } {
  if (typeof value === 'string' && value) return { code: 'provider_error' };
  const record = requiredRecord(value, 'Hermes run failure');
  const code = requiredString(record.code, 'Hermes run failure code');
  optionalString(record.message, 'Hermes run failure message');
  return { code };
}

export function validateStopResponse(value: unknown, externalRunId: string): void {
  const record = requiredRecord(value, 'Hermes stop response');
  if (requiredIdentifier(record.run_id, 'Hermes stop run_id') !== externalRunId || record.status !== 'stopping') {
    throw invalidResponse('Hermes stop response did not match the requested run', 'run.stop');
  }
}

export function validateApprovalRequest(value: unknown): {
  runId: string;
  choices: HermesApprovalChoice[];
  description: string;
} {
  const record = requiredRecord(value, 'Hermes approval request event');
  if (record.event !== 'approval.request') throw invalidResponse('Hermes approval event name was malformed', 'run.approval.event');
  const runId = requiredIdentifier(record.run_id, 'Hermes approval event run_id');
  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw invalidResponse('Hermes approval event choices were malformed', 'run.approval.event');
  }
  const choices = record.choices.map((choice) => {
    if (choice !== 'once' && choice !== 'session' && choice !== 'always' && choice !== 'deny') {
      throw invalidResponse('Hermes approval event contained an unknown choice', 'run.approval.event');
    }
    return choice;
  });
  optionalString(record.description, 'Hermes approval description');
  optionalString(record.command, 'Hermes approval command');
  return { runId, choices, description: stringValue(record.description) ?? 'Hermes approval required' };
}

export function validateApprovalResponse(
  value: unknown,
  externalRunId: string,
  choice: HermesApprovalChoice,
): void {
  const record = requiredRecord(value, 'Hermes approval response');
  if (
    record.object !== 'hermes.run.approval_response' ||
    requiredIdentifier(record.run_id, 'Hermes approval response run_id') !== externalRunId ||
    record.choice !== choice ||
    typeof record.resolved !== 'number' ||
    !Number.isInteger(record.resolved) ||
    record.resolved < 1
  ) {
    throw invalidResponse('Hermes approval response was malformed', 'run.approval.resolve');
  }
}

export function validateSessionCreateResponse(value: unknown): { sessionId: string } {
  const record = requiredRecord(value, 'Hermes session creation response');
  if (record.object !== 'hermes.session') throw invalidResponse('Hermes session creation object was malformed', 'session.create');
  const session = requiredRecord(record.session, 'Hermes created session');
  requiredString(session.source, 'Hermes created session source');
  return { sessionId: requiredIdentifier(session.id, 'Hermes created session id') };
}

export function validateSessionMessagesResponse(value: unknown, externalSessionId: string): { messages: RuntimeMessage[] } {
  const record = requiredRecord(value, 'Hermes session message-history response');
  if (record.object !== 'list') throw invalidResponse('Hermes session history object was malformed', 'session.history');
  const sessionId = requiredIdentifier(record.session_id, 'Hermes session history session_id');
  if (sessionId !== externalSessionId) throw invalidResponse('Hermes session history returned another session', 'session.history');
  if (!Array.isArray(record.data)) throw invalidResponse('Hermes session history data was malformed', 'session.history');
  return { messages: record.data.map(normalizeMessage) };
}

export function validateTerminalEvent(value: unknown, expectedEvent: 'run.completed' | 'run.failed' | 'run.cancelled'): Record<string, unknown> {
  const record = requiredRecord(value, 'Hermes terminal event');
  if (record.event !== expectedEvent) throw invalidResponse('Hermes terminal event name was malformed', 'sse.terminal');
  requiredIdentifier(record.run_id, 'Hermes terminal event run_id');
  if (expectedEvent === 'run.completed') {
    if (typeof record.output !== 'string') throw invalidResponse('Hermes completed event omitted output', 'sse.terminal');
    if (record.usage !== undefined) validateUsage(record.usage);
  }
  if (expectedEvent === 'run.failed') validateRunFailure(record.error);
  return record;
}

export function normalizeStatus(status: string): RuntimeRunStatus {
  if (status === 'started') return 'running';
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'waiting_for_approval' ||
    status === 'stopping' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) return status;
  return 'unknown';
}

function normalizeMessage(value: unknown): RuntimeMessage {
  const message = requiredRecord(value, 'Hermes session message');
  const role = message.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') {
    throw invalidResponse('Hermes session message role was malformed', 'session.history');
  }
  let content: string;
  if (typeof message.content === 'string') content = message.content;
  else if (role === 'assistant' && Array.isArray(message.tool_calls)) content = '';
  else throw invalidResponse('Hermes session message content was malformed', 'session.history');
  optionalString(message.id, 'Hermes session message id', true);
  optionalString(message.timestamp, 'Hermes session message timestamp');
  optionalString(message.tool_call_id, 'Hermes session tool call id', true);
  optionalString(message.tool_name, 'Hermes session tool name');
  const toolCalls = message.tool_calls === undefined ? undefined : validateToolCalls(message.tool_calls);
  return {
    id: stringValue(message.id),
    role,
    content,
    createdAt: normalizeRuntimeTimestamp(message.timestamp ?? message.created_at),
    metadata: toolCalls || message.tool_call_id || message.tool_name
      ? { toolCalls, toolCallId: stringValue(message.tool_call_id), toolName: stringValue(message.tool_name) }
      : undefined,
  };
}

function validateToolCalls(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(value)) throw invalidResponse('Hermes session tool calls were malformed', 'session.history');
  return value.map((nested) => {
    const call = requiredRecord(nested, 'Hermes session tool call');
    const id = requiredIdentifier(call.id, 'Hermes session tool call id');
    const fn = requiredRecord(call.function, 'Hermes session tool call function');
    const name = requiredString(fn.name, 'Hermes session tool call name');
    return { id, name };
  });
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(`${label} was malformed`, 'schema');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw invalidResponse(`${label} was malformed`, 'schema');
  return value;
}

function requiredIdentifier(value: unknown, label: string): string {
  const found = requiredString(value, label);
  if (found.length > 256 || /[\u0000-\u001F\u007F]/.test(found)) throw invalidResponse(`${label} was unsafe`, 'schema');
  return found;
}

function optionalString(value: unknown, label: string, identifier = false): void {
  if (value === undefined || value === null) return;
  if (identifier) requiredIdentifier(value, label);
  else requiredString(value, label);
}

function optionalText(value: unknown, label: string): void {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalidResponse(`${label} was malformed`, 'schema');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function invalidResponse(message: string, stage: string): RuntimeError {
  return new RuntimeError({ code: 'INVALID_RESPONSE', message, retryable: false, adapterId: 'hermes', details: { stage } });
}
