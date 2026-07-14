#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { compareLiveCompatibilityReports } from '../packages/testing/dist/index.js';
import { readReport } from './lib/live-compatibility-cli.mjs';

const [previousPath, currentPath] = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const json = process.argv.includes('--json');
const outputArg = process.argv.find((value) => value.startsWith('--output='));
if (!previousPath || !currentPath) {
  process.stderr.write('usage: pnpm live:compare <old-report> <new-report> [--json] [--output=path]\n');
  process.exitCode = 2;
} else {
  try {
    const diff = compareLiveCompatibilityReports(await readReport(previousPath), await readReport(currentPath));
    const output = json
      ? `${JSON.stringify(diff, null, 2)}\n`
      : [
          `runtime version changed: ${diff.runtimeVersionChanged}`,
          `protocol version changed: ${diff.protocolVersionChanged}`,
          `capability additions: ${diff.capabilityAdditions.join(', ') || 'none'}`,
          `capability removals: ${diff.capabilityRemovals.join(', ') || 'none'}`,
          `newly failing checks: ${diff.newlyFailingChecks.join(', ') || 'none'}`,
          `required checks now skipped: ${diff.requiredChecksNowSkipped.join(', ') || 'none'}`,
          `breaking regression: ${diff.breakingRegression}`,
        ].join('\n') + '\n';
    if (outputArg) await writeFile(outputArg.slice('--output='.length), output, { encoding: 'utf8', mode: 0o600 });
    else process.stdout.write(output);
    if (diff.breakingRegression) process.exitCode = 1;
  } catch {
    process.stderr.write('LIVE_REPORT_COMPARISON_FAILED: report comparison failed safely\n');
    process.exitCode = 1;
  }
}
