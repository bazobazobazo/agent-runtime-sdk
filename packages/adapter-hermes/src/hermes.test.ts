import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { isHermesCapabilities, mapHermesCapabilities } from './mapping/capabilities.js';
import { mapHermesSseEvent } from './mapping/events.js';
import { parseSseStream } from './sse/parser.js';

async function* chunks(values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

describe('Hermes adapter foundations', () => {
  it('maps capabilities', () => {
    const capabilities = mapHermesCapabilities({
      object: 'hermes.api_server.capabilities',
      platform: 'hermes-agent',
      features: { run_submission: true, run_events_sse: true, run_stop: true, images: true },
    });
    expect(capabilities.runs.start).toBe(true);
    expect(capabilities.input.images).toBe(true);
    expect(capabilities.input.files).toBe(false);
  });

  it('replays the bfp1 live capabilities fixture', async () => {
    const fixture = JSON.parse(
      await readFile(new URL('../../../fixtures/hermes/bfp1-capabilities.json', import.meta.url), 'utf8'),
    ) as { capabilities: { body: unknown }; detailedHealth: { body: Record<string, unknown> } };

    expect(isHermesCapabilities(fixture.capabilities.body)).toBe(true);
    expect(fixture.detailedHealth.body.version).toBe('0.18.2');

    const capabilities = mapHermesCapabilities(fixture.capabilities.body);
    expect(capabilities.runs.start).toBe(true);
    expect(capabilities.runs.status).toBe(true);
    expect(capabilities.runs.streamText).toBe(true);
    expect(capabilities.runs.streamTools).toBe(true);
    expect(capabilities.runs.approvals).toBe(true);
    expect(capabilities.output.tools).toBe(true);
    expect(capabilities.extensions['hermes.sessions_rest']).toBe(true);
  });

  it('requires Hermes identity and feature evidence for capabilities', () => {
    expect(isHermesCapabilities({ capabilities: [], features: { run_submission: true, run_status: true } })).toBe(false);
    expect(isHermesCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: { run_submission: true } })).toBe(false);
    expect(isHermesCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', features: { run_submission: true, run_status: true } })).toBe(true);
  });

  it('parses split SSE events', async () => {
    const events = [];
    for await (const event of parseSseStream(chunks(['id: 1\nevent: run.delta\ndata: {"te', 'xt":"hi"}\n\n']))) {
      events.push(event);
    }
    expect(events).toEqual([{ id: '1', event: 'run.delta', data: '{"text":"hi"}' }]);
  });

  it('maps Hermes event names carried in JSON data', () => {
    const [event] = mapHermesSseEvent(undefined, { event: 'message.delta', delta: 'sdk-live-ok' }, {
      ids: { id: () => 'event-1' },
      applicationRunId: 'run-1',
      externalRunId: 'external-run-1',
      externalSessionId: 'session-1',
    });

    expect(event?.type).toBe('assistant.delta');
    if (event?.type === 'assistant.delta') expect(event.delta).toBe('sdk-live-ok');
  });
});
