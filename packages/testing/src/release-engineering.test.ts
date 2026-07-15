import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url).pathname;
const readJson = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, any>;

describe('release engineering policy', () => {
  it('defines a synchronized six-package alpha target', async () => {
    const config = await readJson('release.config.json');
    expect(config.sdkVersion).toBe('0.1.0-alpha.1');
    expect(config.publicPackages).toHaveLength(6);
    expect(new Set(config.publicPackages).size).toBe(6);
  });

  it('keeps private packages outside release configuration', async () => {
    const config = await readJson('release.config.json');
    for (const name of config.privatePackages) expect(config.publicPackages).not.toContain(name);
  });

  it('normalizes public package metadata', async () => {
    const config = await readJson('release.config.json');
    for (const name of config.publicPackages) {
      const suffix = name.replace('@banzae/agent-runtime-', '');
      const directory = suffix === 'openclaw' || suffix === 'hermes' ? `adapter-${suffix}` : suffix;
      const manifest = await readJson(`packages/${directory}/package.json`);
      expect(manifest.license).toBe('Apache-2.0');
      expect(manifest.engines.node).toBe('>=22.13');
      expect(manifest.publishConfig).toEqual({ access: 'public', provenance: true });
      expect(manifest.sideEffects).toBe(false);
    }
  });

  it('keeps placeholders and template private', async () => {
    for (const directory of ['adapter-codex-placeholder', 'adapter-pi-placeholder', 'adapter-template']) {
      const manifest = await readJson(`packages/${directory}/package.json`);
      expect(manifest.private).toBe(true);
      expect(manifest.publishConfig).toBeUndefined();
      expect(manifest.exports).toBeUndefined();
    }
  });

  it('uses a fixed Changesets group', async () => {
    const config = await readJson('release.config.json');
    const changesets = await readJson('.changeset/config.json');
    expect(changesets.fixed).toEqual([config.publicPackages]);
  });

  it('keeps dry-run code publication-free', async () => {
    const source = await readFile(join(root, 'scripts/release-dry-run.mjs'), 'utf8');
    expect(source).not.toMatch(/npm\s+publish|pnpm\s+publish|gh\s+release\s+create/);
  });

  it('requires manual protected OIDC publication', async () => {
    const workflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('confirm_publish:');
    expect(workflow).toContain('environment: npm-release');
    expect(workflow.match(/id-token:\s*write/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
  });

  it('runs current CodeQL on pull requests and main pushes', async () => {
    const workflow = await readFile(join(root, '.github/workflows/codeql.yml'), 'utf8');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*- main/);
    expect(workflow).toContain('github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9');
  });
});
