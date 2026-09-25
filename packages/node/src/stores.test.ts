import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileStateStore } from './stores.js';

describe('NodeFileStateStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'runtime-state-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps existing safe-key state readable at its original path', async () => {
    const store = new NodeFileStateStore(root);
    const key = 'a'.repeat(64);
    const directory = join(root, 'openclaw.device');
    const path = join(directory, `${key}.json`);
    await mkdir(directory);
    await writeFile(path, '{"deviceId":"existing"}\n');

    await expect(store.get('openclaw.device', key)).resolves.toEqual({ deviceId: 'existing' });
    await store.set('openclaw.device', key, { deviceId: 'updated' });

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ deviceId: 'updated' });
    expect(await readdir(directory)).toEqual([`${key}.json`]);
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('does not confuse previously colliding namespace or key values', async () => {
    const store = new NodeFileStateStore(root);
    await mkdir(join(root, 'name_space'));
    await writeFile(join(root, 'name_space', 'a_b.json'), '{"owner":"legacy-safe"}\n');

    await expect(store.get('name/space', 'a/b')).resolves.toBeNull();
    await expect(store.get('name_space', 'a_b')).resolves.toEqual({ owner: 'legacy-safe' });
    await store.set('name/space', 'a/b', { owner: 'encoded' });
    await expect(store.get('name/space', 'a/b')).resolves.toEqual({ owner: 'encoded' });
    await expect(store.get('name_space', 'a_b')).resolves.toEqual({ owner: 'legacy-safe' });

    await store.delete('name/space', 'a/b');
    await expect(store.get('name/space', 'a/b')).resolves.toBeNull();
    await expect(store.get('name_space', 'a_b')).resolves.toEqual({ owner: 'legacy-safe' });
  });

  it('contains special path segments and rejects invalid identifiers', async () => {
    const store = new NodeFileStateStore(root);
    await store.set('..', '.', { safe: true });
    await expect(store.get('..', '.')).resolves.toEqual({ safe: true });
    expect(await readdir(root)).toEqual(['~Li4']);

    await expect(store.set('', 'key', {})).rejects.toThrow(RangeError);
    await expect(store.get('space', 'x'.repeat(181))).rejects.toThrow(RangeError);
    await expect(store.set('space', '\ud800', {})).rejects.toThrow(RangeError);
  });

  it('serializes mutations across store instances without leaving temporary files', async () => {
    const first = new NodeFileStateStore(root);
    const second = new NodeFileStateStore(root);
    const key = 'same-key';
    const payload = 'x'.repeat(32_000);
    await Promise.all(Array.from({ length: 20 }, (_, sequence) =>
      (sequence % 2 ? first : second).set('openclaw.device', key, { sequence, payload })));

    await expect(first.get('openclaw.device', key)).resolves.toEqual({ sequence: 19, payload });
    expect(await readdir(join(root, 'openclaw.device'))).toEqual([`${key}.json`]);
    await Promise.all([first.delete('openclaw.device', key), second.set('openclaw.device', key, { sequence: 20 })]);
    await expect(first.get('openclaw.device', key)).resolves.toEqual({ sequence: 20 });
  });

  it('keeps the committed value after a failed update and allows the next update', async () => {
    const store = new NodeFileStateStore(root);
    await store.set('openclaw.device', 'key', { value: 'before' });
    await expect(store.set('openclaw.device', 'key', undefined)).rejects.toThrow(TypeError);
    await expect(store.get('openclaw.device', 'key')).resolves.toEqual({ value: 'before' });
    await store.set('openclaw.device', 'key', { value: 'after' });
    await expect(store.get('openclaw.device', 'key')).resolves.toEqual({ value: 'after' });
    expect(await readdir(join(root, 'openclaw.device'))).toEqual(['key.json']);
  });
});
