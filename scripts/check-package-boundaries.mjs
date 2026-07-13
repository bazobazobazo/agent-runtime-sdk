import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');
const packages = await readdir(packagesDir, { withFileTypes: true });
const publicPackages = [];

for (const entry of packages) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(packagesDir, entry.name, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.private) publicPackages.push(manifest.name);
  if (entry.name.includes('placeholder') && manifest.private !== true) {
    throw new Error(`${entry.name} must remain private`);
  }
}

for (const disallowed of [
  '@banzae/agent-runtime-codex-placeholder',
  '@banzae/agent-runtime-pi-placeholder',
]) {
  if (publicPackages.includes(disallowed)) {
    throw new Error(`${disallowed} must not be public`);
  }
}

console.log(`Checked ${packages.length} package boundary definitions.`);
