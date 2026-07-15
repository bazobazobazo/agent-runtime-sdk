#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { releaseConfig, root, sha256File } from './lib/release-config.mjs';

const exec = promisify(execFile);
const temp = await mkdtemp(join(tmpdir(), 'agent-runtime-repro-'));
const ignored = new Set(['.git', 'node_modules', 'dist', 'artifacts', '.release-pack', '.runtime-state', 'coverage']);

try {
  const builds = [];
  for (const name of ['first', 'second']) {
    const directory = join(temp, name);
    await cp(root, directory, {
      recursive: true,
      filter(source) {
        const rel = relative(root, source);
        return !source.endsWith('.tsbuildinfo') && !rel.split(/[\\/]/).some((segment) => ignored.has(segment));
      },
    });
    for (const [command, args] of [
      ['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
      ['pnpm', ['build']],
      ['pnpm', ['api:extract']],
      [process.execPath, ['./scripts/prepare-release-packages.mjs']],
    ]) {
      await exec(command, args, { cwd: directory, maxBuffer: 50 * 1024 * 1024 });
    }
    const pack = JSON.parse(await readFile(join(directory, releaseConfig.artifactDirectory, 'pack-results.json'), 'utf8'));
    builds.push(Object.fromEntries(await Promise.all(pack.packages.map(async (pkg) => [
      pkg.name,
      {
        sha256: await sha256File(join(directory, releaseConfig.artifactDirectory, pkg.tarball)),
        files: pkg.files,
        sizeBytes: pkg.sizeBytes,
      },
    ]))));
  }
  if (JSON.stringify(builds[0]) !== JSON.stringify(builds[1])) {
    throw new Error('Two isolated builds produced different package manifests or checksums.');
  }
  console.log(`Reproducibility check passed for ${Object.keys(builds[0]).length} package archives across two isolated builds.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
