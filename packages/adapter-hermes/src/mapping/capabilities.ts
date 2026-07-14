import { TEXT_RUN_CAPABILITIES, mergeCapabilities, type RuntimeCapabilities } from '@banzae/agent-runtime-core';

export function mapHermesCapabilities(payload: unknown): RuntimeCapabilities {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const features = value.features && typeof value.features === 'object' ? (value.features as Record<string, unknown>) : {};
  return mergeCapabilities(TEXT_RUN_CAPABILITIES, {
    runs: {
      start: features.run_submission !== false,
      status: features.run_status !== false,
      streamText: features.run_events_sse !== false,
      streamTools: Boolean(features.tool_events ?? features.tool_progress_events),
      cancel: features.run_stop !== false,
      approvals: Boolean(features.run_approval ?? features.run_approval_response ?? features.approval_events),
    },
    input: {
      text: true,
      images: false,
      files: false,
    },
    output: {
      text: true,
      reasoning: Boolean(features.reasoning),
      tools: Boolean(features.tool_events ?? features.tool_progress_events),
      usage: true,
    },
    extensions: {
      'hermes.responses_api': Boolean(features.responses_api),
      'hermes.sessions_rest': Boolean(features.sessions ?? features.session_resources),
      'hermes.jobs': false,
      'hermes.long_term_session_key': Boolean(features.session_key_header ?? true),
      'hermes.session_id_header': Boolean(features.session_id_header ?? true),
    },
  });
}

export function isHermesCapabilities(payload: unknown): boolean {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const features = value.features && typeof value.features === 'object' && !Array.isArray(value.features) ? (value.features as Record<string, unknown>) : {};
  return value.object === 'hermes.api_server.capabilities' && value.platform === 'hermes-agent' && hasHermesFeatureEvidence(features);
}

function hasHermesFeatureEvidence(features: Record<string, unknown>): boolean {
  const keys = ['run_submission', 'run_status', 'run_events_sse', 'session_resources', 'tool_progress_events', 'approval_events'];
  return keys.filter((key) => typeof features[key] === 'boolean').length >= 2;
}
