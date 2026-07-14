import type { RuntimeError } from '@banzae/agent-runtime-core';

export type OpenClawNegotiationDecision = 'try-next-protocol' | 'fail-closed';

export function classifyNegotiationFailure(error: RuntimeError): OpenClawNegotiationDecision {
  return error.code === 'PROTOCOL_MISMATCH' ? 'try-next-protocol' : 'fail-closed';
}
