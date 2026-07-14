import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  HARD_RUNTIME_LIMITS,
  RuntimeError,
  resolveSecureLimit,
} from '@banzae/agent-runtime-core';
import { sanitizeProviderPayload } from '@banzae/agent-runtime-core/diagnostics';
import { createTestDependencies } from '@banzae/agent-runtime-core/testing';
import { openClawV3Codec } from '../../adapter-openclaw/src/protocol/v3/codec.js';
import { openClawV4Codec } from '../../adapter-openclaw/src/protocol/v4/codec.js';
import { DefaultRuntimeNetworkPolicy, detectionFingerprint } from '../../detection/src/security.js';
import { createRuntimeDetector } from '../../detection/src/detector.js';
import { parseSseStream } from '../../adapter-hermes/src/sse/parser.js';
import {
  validateDetailedHealth,
  validateHealth,
  validateApprovalResponse,
  validateRunCreateResponse,
  validateRunStatusResponse,
  validateSessionCreateResponse,
  validateSessionMessagesResponse,
  validateStopResponse,
  validateTerminalEvent,
  validateUsage,
} from '../../adapter-hermes/src/schemas.js';
import { validateHermesCapabilities } from '../../adapter-hermes/src/mapping/capabilities.js';
import { sanitizeLiveValue } from './live-compatibility.js';

const runs = Number(process.env.FUZZ_RUNS ?? 100);
const seed = Number(process.env.FUZZ_SEED ?? 2_026_071_4);
const propertyOptions = { numRuns: runs, seed, verbose: 1 as const };

describe('bounded protocol property tests', () => {
  for (const [version, codec] of [[3, openClawV3Codec()], [4, openClawV4Codec()]] as const) {
    it(`OpenClaw v${version} rejects or safely classifies arbitrary JSON frames`, () => {
      fc.assert(fc.property(fc.jsonValue(), (value) => {
        try {
          const frame = codec.parseFrame(JSON.stringify(value));
          expect(['event', 'req', 'res', 'hello-ok']).toContain(frame.type);
        } catch (error) {
          expect(error).toBeInstanceOf(RuntimeError);
          expect((error as RuntimeError).code).toBe('INVALID_RESPONSE');
        }
      }), propertyOptions);
    });

    it(`OpenClaw v${version} never treats an unknown terminal-like event as completion`, () => {
      fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 64 }), (suffix) => {
        const events = codec.mapProviderEvent({
          type: 'event',
          event: `unknown.completed.${suffix}`,
          payload: { runId: 'provider-run', sessionKey: 'provider-session', status: 'completed', text: 'unsafe' },
        }, {
          applicationRunId: 'application-run',
          externalRunId: 'provider-run',
          externalSessionId: 'provider-session',
          clock: { now: () => new Date('2026-07-14T00:00:00.000Z'), sleep: async () => undefined },
          ids: { id: () => 'event-id' },
        });
        expect(events).toEqual([]);
      }), propertyOptions);
    });

    it(`OpenClaw v${version} rejects unsafe sequences and incomplete terminal status`, () => {
      for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => codec.parseFrame(JSON.stringify({ type: 'event', event: 'chat.delta', seq: sequence, payload: {} })))
          .toThrow(RuntimeError);
      }
      expect(() => codec.parseRunWaitResponse({ applicationRunId: 'application-run', externalRunId: 'provider-run' }, {
        runId: 'provider-run', status: 'completed',
      })).toThrow(RuntimeError);
    });
  }

  it('Hermes validators fail safely for arbitrary provider JSON', () => {
    const validators = [
      validateHealth,
      validateDetailedHealth,
      validateRunCreateResponse,
      validateRunStatusResponse,
      validateUsage,
      validateHermesCapabilities,
      validateSessionCreateResponse,
      (value: unknown) => validateSessionMessagesResponse(value, 'session-id'),
      (value: unknown) => validateStopResponse(value, 'run-id'),
      (value: unknown) => validateApprovalResponse(value, 'run-id', 'once'),
      (value: unknown) => validateTerminalEvent(value, 'run.completed'),
      (value: unknown) => validateTerminalEvent(value, 'run.failed'),
      (value: unknown) => validateTerminalEvent(value, 'run.cancelled'),
    ];
    fc.assert(fc.property(fc.jsonValue(), (value) => {
      for (const validate of validators) {
        try {
          validate(value);
        } catch (error) {
          expect(error).toBeInstanceOf(RuntimeError);
          expect((error as RuntimeError).code).toBe('INVALID_RESPONSE');
        }
      }
    }), propertyOptions);
  });

  it('Hermes usage rejects negative and non-finite values', () => {
    fc.assert(fc.property(fc.integer({ max: -1 }), (value) => {
      expect(() => validateUsage({ input_tokens: value, output_tokens: 0, total_tokens: 0 })).toThrow(RuntimeError);
    }), propertyOptions);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => validateUsage({ input_tokens: value, output_tokens: 0, total_tokens: 0 })).toThrow(RuntimeError);
    }
  });

  it('parses valid UTF-8 across arbitrary byte chunk boundaries', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ maxLength: 200 }),
      fc.array(fc.integer({ min: 1, max: 17 }), { minLength: 1, maxLength: 20 }),
      async (text, sizes) => {
        const source = new TextEncoder().encode(`event: compatibility\ndata: ${JSON.stringify({ text })}\n\n`);
        const chunks = splitBytes(source, sizes);
        const events = await collect(parseSseStream(iterable(chunks), { maxLineBytes: 1_024, maxEventBytes: 2_048, maxPendingBytes: 2_048 }));
        expect(events).toEqual([{ event: 'compatibility', data: JSON.stringify({ text }) }]);
      },
    ), propertyOptions);
  });

  it('rejects malformed UTF-8 and enforces every SSE byte boundary', async () => {
    await expect(collect(parseSseStream(iterable([Uint8Array.from([0xc3, 0x28])])))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(collect(parseSseStream(iterable([new TextEncoder().encode('data: 12345\n\n')]), { maxLineBytes: 10 }))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(collect(parseSseStream(iterable([new TextEncoder().encode('data: 1\ndata: 2\n\n')]), { maxEventBytes: 12 }))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(collect(parseSseStream(iterable([new TextEncoder().encode('data: unterminated')]), { maxPendingBytes: 8 }))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('bounds endless SSE keepalives as an unfinished event', async () => {
    const keepalives = new TextEncoder().encode(Array.from({ length: 100 }, () => ': keepalive\n').join(''));
    await expect(collect(parseSseStream(iterable([keepalives]), { maxLineBytes: 64, maxEventBytes: 64, maxPendingBytes: 2_048 })))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects credential-like URL parameters across case and encoding', async () => {
    const policy = new DefaultRuntimeNetworkPolicy();
    await fc.assert(fc.asyncProperty(
      fc.constantFrom('token', 'access_token', 'api_key', 'password', 'secret', 'authorization', 'device_token'),
      fc.string({ minLength: 1, maxLength: 40 }),
      async (key, value) => {
        await expect(policy.validateTarget(new URL(`https://runtime.example.test/?${key.toUpperCase()}=${encodeURIComponent(value)}`)))
          .rejects.toMatchObject({ code: 'NETWORK_POLICY_REJECTED' });
      },
    ), propertyOptions);
  });

  it('keeps credential references out of detection fingerprints', async () => {
    const dependencies = createTestDependencies();
    const target = { endpoint: 'https://runtime.example.test/path?safe=value' };
    expect(await detectionFingerprint(dependencies, { target, credentialRef: 'env:FIRST' }))
      .toBe(await detectionFingerprint(dependencies, { target, credentialRef: 'env:SECOND' }));
  });

  it('contains arbitrary malformed manifest text without identifying a runtime', async () => {
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 1_000 }), async (text) => {
      const detector = createRuntimeDetector({
        dependencies: createTestDependencies({
          http: {
            async request() {
              return {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: iterable([new TextEncoder().encode(text)]),
              };
            },
          },
        }),
        probes: [],
      });
      const result = await detector.detect({ target: { endpoint: 'https://runtime.example.test' }, options: { probeTimeoutMs: 500 } });
      expect(['failed', 'detected']).toContain(result.status);
      if (result.status === 'detected') expect(['openclaw', 'hermes']).toContain(result.selected?.adapterId);
    }), { ...propertyOptions, numRuns: Math.min(50, runs) });
  });

  it('removes a generated secret corpus from bounded serialized output', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9]{18,32}$/), (marker) => {
      const secrets = [
        `Authorization: Bearer ${marker}`,
        `Basic ${Buffer.from(`user:${marker}`).toString('base64')}`,
        `token=${marker}`,
        `access_token%3D${marker}`,
        `ghp_${marker}`,
        `eyJ${marker}.eyJ${marker}.eyJ${marker}`,
        `https://user:${marker}@runtime.example.test/path?api_key=${marker}`,
      ];
      const cyclic: Record<string, unknown> = { nested: { password: marker }, values: secrets };
      cyclic.self = cyclic;
      for (const sanitizer of [sanitizeProviderPayload, sanitizeLiveValue]) {
        const serialized = JSON.stringify(sanitizer(cyclic));
        expect(serialized).not.toContain(marker);
        expect(serialized.length).toBeLessThan(100_000);
      }
    }), propertyOptions);
  });

  it('bounds sanitizer depth, collections, strings, and cycles', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 100; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    root.cycle = root;
    root.values = Array.from({ length: 10_000 }, (_, index) => index);
    root.long = 'x'.repeat(100_000);
    const serialized = JSON.stringify(sanitizeProviderPayload(root));
    expect(serialized).toContain('[max-depth]');
    expect(serialized).toContain('[circular]');
    expect(serialized.length).toBeLessThan(20_000);
  });

  it('enforces central security-limit boundaries', () => {
    for (const [name, maximum] of Object.entries(HARD_RUNTIME_LIMITS)) {
      const allowZero = name === 'maxRedirects';
      expect(resolveSecureLimit(name as keyof typeof HARD_RUNTIME_LIMITS, maximum, { allowZero })).toBe(maximum);
      expect(() => resolveSecureLimit(name as keyof typeof HARD_RUNTIME_LIMITS, maximum + 1)).toThrow(RuntimeError);
      expect(() => resolveSecureLimit(name as keyof typeof HARD_RUNTIME_LIMITS, -1)).toThrow(RuntimeError);
      expect(() => resolveSecureLimit(name as keyof typeof HARD_RUNTIME_LIMITS, 1.5)).toThrow(RuntimeError);
    }
  });
});

function splitBytes(value: Uint8Array, sizes: readonly number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  while (offset < value.byteLength) {
    const size = sizes[index % sizes.length] ?? 1;
    chunks.push(value.slice(offset, offset + size));
    offset += size;
    index += 1;
  }
  return chunks;
}

async function* iterable(values: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}
