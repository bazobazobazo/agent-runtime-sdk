import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url).pathname;
const readJson = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, any>;

describe('release engineering policy', () => {
  it('defines a synchronized six-package alpha target', async () => {
    const config = await readJson('release.config.json');
    expect(config.sdkVersion).toBe('0.1.0-alpha.2');
    expect(config.distTags).toEqual({ prerelease: 'next', stable: 'latest' });
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
      expect(manifest.version).toBe(config.sdkVersion);
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
    await expect(readFile(join(root, '.changeset/initial-alpha-packages.md'), 'utf8')).rejects.toThrow();
  });

  it('keeps dry-run code publication-free', async () => {
    const source = await readFile(join(root, 'scripts/release-dry-run.mjs'), 'utf8');
    expect(source).not.toMatch(/npm\s+publish|pnpm\s+publish|npm\s+dist-tag|git\s+tag|gh\s+release\s+create/);
    expect(source).toMatch(/with dist-tag \$\{manifest\.distTag\}/);
  });

  it('requires manual protected OIDC publication', async () => {
    const workflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('confirm_publish:');
    expect(workflow).toContain('environment: npm-release');
    expect(workflow.match(/id-token:\s*write/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
    const publishLines = workflow.split(/\r?\n/).filter((line) => /\bnpm\s+publish\b/.test(line));
    expect(publishLines.length).toBeGreaterThan(0);
    for (const line of publishLines) expect(line).toMatch(/--tag\s+next\b/);
    expect(workflow).toMatch(/node-version:\s*['"]22\.14\.0['"]/);
    expect(workflow).toContain('npm install --global npm@11.5.1');
    expect(workflow).toContain('const minimum = [22, 14, 0]');
    expect(workflow).toContain('const minimum = [11, 5, 1]');
    expect(workflow).toMatch(/package-manager-cache:\s*['"]false['"]/);
  });

  it('documents one-time bootstrap revocation and required OIDC transition', async () => {
    const docs = await readFile(join(root, 'docs/releasing.md'), 'utf8');
    expect(docs).toMatch(/immediately revoke/i);
    expect(docs).toMatch(/OIDC.*required|must use.*OIDC/is);
    expect(docs).toContain('bazobazobazo');
    expect(docs).toMatch(/workflow filename.*release\.yml/is);
  });

  it('runs current CodeQL on pull requests and main pushes', async () => {
    const workflow = await readFile(join(root, '.github/workflows/codeql.yml'), 'utf8');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*- main/);
    expect(workflow).toContain('github/codeql-action/init@99df26d4f13ea111d4ec1a7dddef6063f76b97e9');
  });
});
