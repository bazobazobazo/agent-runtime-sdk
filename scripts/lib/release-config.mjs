import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

export const root = new URL('../..', import.meta.url).pathname;
export const releaseConfig = await readJson(join(root, 'release.config.json'));
export const artifactRoot = join(root, releaseConfig.artifactDirectory);
export const publicPackageNames = new Set(releaseConfig.publicPackages);
export const privatePackageNames = new Set(releaseConfig.privatePackages);

export function distTagForVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const prerelease = version.includes('-');
  const tag = prerelease ? releaseConfig.distTags.prerelease : releaseConfig.distTags.stable;
  if (!tag || (prerelease && tag === 'latest')) {
    throw new Error(`Unsafe dist-tag policy for ${version}`);
  }
  return tag;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJsonAtomic(path, value) {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, value, 'utf8');
  await rename(temp, path);
}

export async function exists(path) {
  return access(path).then(() => true, () => false);
}

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export function packageSlug(name) {
  return name.replace(/^@/, '').replaceAll('/', '-');
}

export async function publicPackages() {
  const packages = [];
  for (const name of releaseConfig.publicPackages) {
    const directory = name.replace('@banzae/agent-runtime-', '');
    const packageDirectory = directory === 'openclaw'
      ? 'adapter-openclaw'
      : directory === 'hermes'
        ? 'adapter-hermes'
        : directory;
    const path = join(root, 'packages', packageDirectory);
    const manifest = await readJson(join(path, 'package.json'));
    if (manifest.name !== name) throw new Error(`Release configuration path mismatch for ${name}`);
    packages.push({ name, directory: packageDirectory, path, manifest });
  }
  return packages;
}

export function releaseManifestFor(sourceManifest) {
  const manifest = structuredClone(sourceManifest);
  manifest.version = releaseConfig.sdkVersion;
  delete manifest.scripts;
  delete manifest.devDependencies;
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!manifest[field]) continue;
    for (const [name, range] of Object.entries(manifest[field])) {
      if (publicPackageNames.has(name)) manifest[field][name] = releaseConfig.sdkVersion;
      else if (String(range).startsWith('workspace:')) {
        throw new Error(`${manifest.name} has unresolved non-release workspace dependency ${name}`);
      }
    }
  }
  return manifest;
}

export async function stagePublicPackage(pkg, stagingRoot) {
  const destination = join(stagingRoot, pkg.directory);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of ['dist', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const source = join(pkg.path, name);
    if (!await exists(source)) throw new Error(`${pkg.name} is missing ${name}`);
    await cp(source, join(destination, name), { recursive: true });
  }
  await writeJsonAtomic(join(destination, 'package.json'), releaseManifestFor(pkg.manifest));
  return destination;
}

export async function cleanArtifactRoot() {
  const expected = join(root, 'artifacts', 'release');
  if (artifactRoot !== expected) throw new Error(`Refusing to clear unexpected artifact directory: ${artifactRoot}`);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
}

export function relativeArtifact(path) {
  return relative(artifactRoot, path).replaceAll('\\', '/');
}

export function assertSafeRelativePath(value, label) {
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\\')) {
    throw new Error(`${label} must be an artifact-relative path`);
  }
}

export function tarballName(name) {
  return `${packageSlug(name)}-${releaseConfig.sdkVersion}.tgz`;
}

export function sourceDate() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 0);
  return new Date(epoch * 1000).toISOString();
}

export function artifactBasename(path) {
  return basename(path);
}
