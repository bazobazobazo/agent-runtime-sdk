import { describe, expect, it } from 'vitest';
import { adapterAuthoringExample } from './adapter-authoring/index.js';
import { approvalsExample } from './approvals/index.js';
import { cancellationExample } from './cancellation/index.js';
import { credentialProviderExample } from './credential-provider/index.js';
import { detectRuntimeExample } from './detect-runtime/index.js';
import { diagnosticsExample } from './diagnostics/index.js';
import { explicitHermesExample } from './hermes-chat/index.js';
import { historyExample } from './history/index.js';
import { lifecycleExample } from './lifecycle/index.js';
import { networkPolicyExample } from './network-policy/index.js';
import { explicitOpenClawExample } from './openclaw-chat/index.js';
import { streamingExample } from './streaming/index.js';

describe('public examples', () => {
  it('runs without external network access', async () => {
    await expect(explicitOpenClawExample()).resolves.toBe('openclaw:created');
    await expect(explicitHermesExample()).resolves.toBe('hermes:created');
    await expect(detectRuntimeExample()).resolves.toBe('fake');
    await expect(lifecycleExample()).resolves.toBe('fake:example-run');
    await expect(streamingExample()).resolves.toEqual(['assistant.completed', 'run.completed']);
    await expect(cancellationExample()).resolves.toBeUndefined();
    await expect(historyExample()).resolves.toEqual(['ok']);
    await expect(approvalsExample()).resolves.toBe('allow');
    await expect(credentialProviderExample()).resolves.toBe('bearer');
    await expect(networkPolicyExample()).resolves.toBe('runtime.example.com');
    await expect(diagnosticsExample()).resolves.toEqual({ endpoint: '[redacted-url]', status: 'example' });
    await expect(adapterAuthoringExample()).resolves.toBeGreaterThan(0);
  });
});
