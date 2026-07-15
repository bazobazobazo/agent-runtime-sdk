#!/usr/bin/env node
import { join } from 'node:path';
import { publicPackages, releaseConfig, releaseManifestFor, root } from './lib/release-config.mjs';

const packages = await publicPackages();
const plan = {
  schemaVersion: 1,
  strategy: 'fixed',
  sourceVersion: releaseConfig.sourceVersion,
  targetVersion: releaseConfig.sdkVersion,
  prerelease: true,
  publicationStatus: 'not-published',
  packages: packages.map((pkg) => {
    const releaseManifest = releaseManifestFor(pkg.manifest);
    const dependencyUpdates = {};
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(releaseManifest[field] ?? {})) {
        if (releaseConfig.publicPackages.includes(name)) dependencyUpdates[name] = range;
      }
    }
    return {
      name: pkg.name,
      currentVersion: pkg.manifest.version,
      nextVersion: releaseConfig.sdkVersion,
      dependencyUpdates,
      changelog: 'Initial synchronized pre-alpha package set.',
    };
  }),
  excludedPackages: releaseConfig.privatePackages,
  notes: [
    'SDK package versions are synchronized for the initial alpha series.',
    'Runtime product and wire protocol versions remain independent.',
    'The final version is applied only by a reviewed release-candidate change.',
  ],
};

if (process.argv.includes('--json')) console.log(JSON.stringify(plan, null, 2));
else {
  console.log(`Fixed release plan: ${plan.sourceVersion} -> ${plan.targetVersion}`);
  for (const pkg of plan.packages) console.log(`- ${pkg.name}@${pkg.nextVersion}`);
  console.log(`Excluded: ${plan.excludedPackages.join(', ')}`);
}
