#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const packageDigest = createHash('sha256').update(JSON.stringify(rootPackage)).update('\n').update(lock).digest('hex').slice(0, 16);
const createdAt = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 0) * 1000).toISOString();
const packages = [];

for (const match of lock.matchAll(/^ {2}([^:\n][^:\n]*):\n(?: {4}version: ([^\n]+)\n)?/gm)) {
  const name = match[1].replace(/^\/?/, '').split('@').slice(0, -1).join('@') || match[1];
  const version = match[2]?.trim() ?? match[1].split('@').at(-1);
  if (!name || !version || name.startsWith('.')) continue;
  packages.push({
    SPDXID: `SPDXRef-Package-${sanitizeId(name)}-${sanitizeId(version)}`,
    name,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  });
}

const doc = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${rootPackage.name}-${rootPackage.version}-sbom`,
  documentNamespace: `https://banzae.dev/sbom/${rootPackage.name}/${rootPackage.version}/${packageDigest}`,
  creationInfo: {
    created: createdAt,
    creators: ['Tool: scripts/generate-sbom.mjs'],
  },
  packages,
};

await mkdir(new URL('../sbom/', import.meta.url), { recursive: true });
await writeFile(new URL('../sbom/package-sbom.spdx.json', import.meta.url), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`Wrote sbom/package-sbom.spdx.json with ${packages.length} packages.`);

function sanitizeId(value) {
  return value.replace(/[^A-Za-z0-9.-]/g, '-');
}
