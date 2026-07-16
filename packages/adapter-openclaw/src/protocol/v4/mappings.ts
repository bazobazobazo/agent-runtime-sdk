import type { OpenClawProtocolMappings } from '../shared.js';

export const openClawV4Mappings: OpenClawProtocolMappings = {
  connectEvent: 'connect.challenge',
  connectMethod: 'connect',
  sessionCreateMethod: 'sessions.create',
  runStartMethod: 'chat.send',
  runWaitMethod: 'agent.wait',
  historyMethod: 'chat.history',
  cancelMethod: 'chat.abort',
  statefulEvents: ['chat'],
  deltaEvents: ['chat.delta', 'assistant.delta', 'run.delta', 'session.delta'],
  completedEvents: ['chat.completed', 'assistant.completed', 'run.completed', 'session.completed'],
  failedEvents: ['chat.failed', 'run.failed', 'agent.failed', 'session.failed'],
  cancelledEvents: ['chat.cancelled', 'chat.canceled', 'run.cancelled', 'session.cancelled'],
  timeoutEvents: ['chat.timeout', 'run.timeout', 'session.timeout'],
  diagnosticEvents: ['chat.warning', 'run.warning', 'transport.warning', 'session.warning'],
};
