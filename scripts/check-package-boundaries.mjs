import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packagesDir = join(root, 'packages');
const packages = await readdir(packagesDir, { withFileTypes: true });
const publicPackages = [];
const expectedRepository = 'git+https://github.com/bazobazobazo/agent-runtime-sdk.git';

for (const entry of packages) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(packagesDir, entry.name, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.private) {
    publicPackages.push(manifest.name);
    if (!manifest.exports || typeof manifest.exports !== 'object') {
      throw new Error(`${manifest.name} must define an explicit export map`);
    }
    for (const key of Object.keys(manifest.exports)) {
      if (!['.', './experimental', './diagnostics', './testing'].includes(key) || key.includes('*')) {
        throw new Error(`${manifest.name} exposes unsupported package entrypoint ${key}`);
      }
    }
    if (manifest.engines?.node !== '>=22.13') {
      throw new Error(`${manifest.name} must declare the Node >=22.13 support floor`);
    }
    if (manifest.repository?.url !== expectedRepository || manifest.repository?.directory !== `packages/${entry.name}`) {
      throw new Error(`${manifest.name} repository metadata is incorrect`);
    }
    if (manifest.license !== 'Apache-2.0' || manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.provenance !== true) {
      throw new Error(`${manifest.name} publication metadata is incomplete`);
    }
    if (manifest.type !== 'module' || manifest.sideEffects !== false || manifest.main !== './dist/index.js' || manifest.types !== './dist/index.d.ts') {
      throw new Error(`${manifest.name} must declare the ESM entrypoint and types`);
    }
  }
  if (entry.name.includes('placeholder') && manifest.private !== true) {
    throw new Error(`${entry.name} must remain private`);
  }
  if (entry.name.includes('placeholder') && (manifest.exports || manifest.files || manifest.publishConfig)) {
    throw new Error(`${entry.name} must not define exports, published files, or publish configuration`);
  }
}

if (publicPackages.length !== 6) throw new Error(`Expected exactly six public packages, found ${publicPackages.length}`);

for (const disallowed of [
  '@banzae/agent-runtime-codex-placeholder',
  '@banzae/agent-runtime-pi-placeholder',
]) {
  if (publicPackages.includes(disallowed)) {
    throw new Error(`${disallowed} must not be public`);
  }
}

const registrationSources = [
  await readFile(join(root, 'packages/node/src/index.ts'), 'utf8'),
  await readFile(join(root, 'packages/detection/src/index.ts'), 'utf8'),
].join('\n');
if (/codex|agent-runtime-pi|createPi/i.test(registrationSources)) throw new Error('Private placeholders must not be registered or detected');

console.log(`Checked ${packages.length} package boundary definitions.`);
