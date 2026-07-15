#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { publicPackages } from './lib/release-config.mjs';

for (const pkg of await publicPackages()) {
  if (pkg.manifest.publishConfig?.access !== 'public' || pkg.manifest.publishConfig?.provenance !== true) {
    throw new Error(`${pkg.name} is not configured for public provenance-enabled publication.`);
  }
}
const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
for (const required of ['workflow_dispatch:', 'confirm_publish:', 'environment: npm-release', 'id-token: write', '--provenance']) {
  if (!workflow.includes(required)) throw new Error(`Release workflow is missing ${required}`);
}
if (/NODE_AUTH_TOKEN|NPM_TOKEN/.test(workflow)) throw new Error('Release workflow must not use a long-lived npm token.');
console.log('Trusted-publishing preparation is valid; no provenance publication is claimed.');
