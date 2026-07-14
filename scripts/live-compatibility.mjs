#!/usr/bin/env node
import { executeLiveTarget, readLiveCliConfig, safeOutput } from './lib/live-compatibility-cli.mjs';

const provider = process.argv[2] ?? 'both';
if (!['openclaw', 'hermes', 'both'].includes(provider)) {
  process.stderr.write('usage: pnpm live:compatibility [openclaw|hermes|both] [--json]\n');
  process.exitCode = 2;
} else {
  try {
    const providers = provider === 'both' ? ['openclaw', 'hermes'] : [provider];
    const configured = providers.filter((value) => value === 'openclaw'
      ? process.env.OPENCLAW_ENDPOINT || process.env.OPENCLAW_GATEWAY_URL
      : process.env.HERMES_ENDPOINT || process.env.HERMES_BASE_URL);
    if (configured.length === 0) throw Object.assign(new Error('No configured live runtime targets were found'), { code: 'INVALID_CONFIGURATION' });
    if (provider === 'both' && configured.length !== 2) throw Object.assign(new Error('Both live runtime targets must be configured'), { code: 'INVALID_CONFIGURATION' });
    let failed = false;
    for (const value of configured) {
      const config = readLiveCliConfig(value, process.env, process.argv.slice(3));
      const result = await executeLiveTarget(config);
      process.stdout.write(safeOutput(result, config.outputFormat));
      failed ||= !result.report.summary.requiredChecksPassed;
    }
    if (failed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error?.code ?? 'LIVE_COMPATIBILITY_FAILED'}: live compatibility command failed safely\n`);
    process.exitCode = 1;
  }
}
