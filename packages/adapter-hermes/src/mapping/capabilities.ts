import { NO_CAPABILITIES, RuntimeError, type RuntimeCapabilities } from '@banzae/agent-runtime-core';

const BOOLEAN_FEATURES = [
  'run_submission',
  'run_status',
  'run_events_sse',
  'run_stop',
  'run_approval',
  'run_approval_response',
  'tool_progress_events',
  'approval_events',
  'reasoning',
  'responses_api',
] as const;

const HEADER_FEATURES = ['session_key_header', 'session_continuity_header'] as const;

export type ValidatedHermesCapabilities = {
  value: Record<string, unknown>;
  features: Record<string, unknown>;
  endpoints: Record<string, unknown>;
};

export function validateHermesCapabilities(payload: unknown): ValidatedHermesCapabilities {
  const value = requiredRecord(payload, 'Hermes capabilities response');
  if (value.object !== 'hermes.api_server.capabilities' || value.platform !== 'hermes-agent') {
    throw invalidResponse('Hermes capabilities identity was invalid', 'capabilities.identity');
  }
  const features = requiredRecord(value.features, 'Hermes capabilities features');
  const endpoints = optionalRecord(value.endpoints, 'Hermes capabilities endpoints');
  for (const key of BOOLEAN_FEATURES) {
    if (features[key] !== undefined && typeof features[key] !== 'boolean') {
      throw invalidResponse(`Hermes capability ${key} was malformed`, 'capabilities.features');
    }
  }
  for (const key of HEADER_FEATURES) {
    if (features[key] !== undefined && typeof features[key] !== 'string') {
      throw invalidResponse(`Hermes capability ${key} was malformed`, 'capabilities.features');
    }
  }
  const recognized = [...BOOLEAN_FEATURES, ...HEADER_FEATURES].filter((key) => features[key] !== undefined);
  if (recognized.length < 2) throw invalidResponse('Hermes capabilities lacked sufficient feature evidence', 'capabilities.features');
  validateEndpoint(endpoints, 'runs', 'POST', '/v1/runs');
  validateEndpoint(endpoints, 'run_status', 'GET', '/v1/runs/{run_id}');
  validateEndpoint(endpoints, 'run_events', 'GET', '/v1/runs/{run_id}/events');
  validateEndpoint(endpoints, 'run_stop', 'POST', '/v1/runs/{run_id}/stop');
  validateEndpoint(endpoints, 'run_approval', 'POST', '/v1/runs/{run_id}/approval');
  validateEndpoint(endpoints, 'session_create', 'POST', '/api/sessions');
  validateEndpoint(endpoints, 'session_messages', 'GET', '/api/sessions/{session_id}/messages');
  return { value, features, endpoints };
}

export function mapHermesCapabilities(payload: unknown): RuntimeCapabilities {
  const { features, endpoints } = validateHermesCapabilities(payload);
  const runStart = features.run_submission === true && endpointIs(endpoints, 'runs', 'POST', '/v1/runs');
  const runStatus = features.run_status === true && endpointIs(endpoints, 'run_status', 'GET', '/v1/runs/{run_id}');
  const runStream = features.run_events_sse === true && endpointIs(endpoints, 'run_events', 'GET', '/v1/runs/{run_id}/events');
  const runCancel = features.run_stop === true && endpointIs(endpoints, 'run_stop', 'POST', '/v1/runs/{run_id}/stop');
  const runApprovals = features.approval_events === true
    && features.run_approval_response === true
    && endpointIs(endpoints, 'run_approval', 'POST', '/v1/runs/{run_id}/approval');
  const sessionCreate = endpointIs(endpoints, 'session_create', 'POST', '/api/sessions');
  const sessionHistory = endpointIs(endpoints, 'session_messages', 'GET', '/api/sessions/{session_id}/messages');
  const streamTools = runStream && features.tool_progress_events === true;
  return {
    ...NO_CAPABILITIES,
    sessions: { create: sessionCreate, resume: runStart, history: sessionHistory, fork: false },
    runs: {
      start: runStart,
      status: runStatus,
      stream: runStream,
      cancel: runCancel,
      approvals: runApprovals,
    },
    input: { text: runStart, images: false, files: false },
    output: {
      text: runStatus || runStream,
      reasoning: runStream && features.reasoning === true,
      tools: streamTools,
      // Pinned Hermes capabilities do not advertise usage independently.
      usage: false,
    },
    health: {
      liveness: endpointIs(endpoints, 'health', 'GET', '/health'),
      readiness: endpointIs(endpoints, 'health_detailed', 'GET', '/health/detailed'),
    },
    extensions: {
      'hermes.responses_api': features.responses_api === true,
      'hermes.sessions_rest': sessionCreate && sessionHistory,
      'hermes.jobs': false,
      'hermes.long_term_session_key': features.session_key_header === 'X-Hermes-Session-Key',
      'hermes.session_id_header': features.session_continuity_header === 'X-Hermes-Session-Id',
    },
  };
}

export function isHermesCapabilities(payload: unknown): boolean {
  try {
    validateHermesCapabilities(payload);
    return true;
  } catch {
    return false;
  }
}

function validateEndpoint(
  endpoints: Record<string, unknown>,
  name: string,
  method: string,
  path: string,
): void {
  const value = endpoints[name];
  if (value === undefined) return;
  const endpoint = requiredRecord(value, `Hermes endpoint ${name}`);
  if (endpoint.method !== method || endpoint.path !== path) {
    throw invalidResponse(`Hermes endpoint ${name} was malformed`, 'capabilities.endpoints');
  }
}

function endpointIs(
  endpoints: Record<string, unknown>,
  name: string,
  method: string,
  path: string,
): boolean {
  const value = endpoints[name];
  return isRecord(value) && value.method === method && value.path === path;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse(`${label} was malformed`, 'capabilities.schema');
  return value;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  return requiredRecord(value, label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(message: string, stage: string): RuntimeError {
  return new RuntimeError({ code: 'INVALID_RESPONSE', message, retryable: false, adapterId: 'hermes', details: { stage } });
}
