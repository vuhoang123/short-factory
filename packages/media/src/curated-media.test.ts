import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCuratedCatalog, readCuratedFile } from './curated-media.js';

describe('local CC0 media catalog', () => {
  let directory = '';
  afterEach(async () => { vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function fixture(changes = {}) {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sf-curated-')); vi.stubEnv('STUDIO_MEDIA_ROOT', directory);
    const bytes = Buffer.from('owned synthetic fixture');
    const entry = { key: 'test', kind: 'MUSIC', name: 'Synthetic test', category: 'Piano', artist: 'Test', description: 'Synthetic', sourceUrl: 'https://opengameart.org/content/synthetic-test', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', verifiedAt: '2026-11-03', mimeType: 'audio/wav', durationMs: 1000, file: { file: 'test.wav', checksum: createHash('sha256').update(bytes).digest('hex') }, ...changes };
    await writeFile(path.join(directory, 'test.wav'), bytes); await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ version: 1, items: [entry] }));
    return bytes;
  }
  it('loads only pinned files and rejects mutation and unknown keys', async () => {
    const bytes = await fixture(); expect((await readCuratedFile('test')).bytes).toEqual(bytes);
    await expect(readCuratedFile('../test')).rejects.toThrow(); await expect(readCuratedFile('missing')).rejects.toThrow('CURATED_ASSET_NOT_FOUND');
    await writeFile(path.join(directory, 'test.wav'), 'changed'); await expect(readCuratedFile('test')).rejects.toThrow('CURATED_ASSET_CHANGED');
  });
  it('refuses path traversal and unreviewed licenses in the manifest', async () => {
    await fixture({ license: 'UNKNOWN', file: { file: '../private.wav', checksum: 'a'.repeat(64) } });
    await expect(readCuratedCatalog()).rejects.toThrow();
  });
  it('returns an empty catalog when setup has not been run', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'sf-curated-')); vi.stubEnv('STUDIO_MEDIA_ROOT', directory);
    expect(await readCuratedCatalog()).toEqual([]);
  });
});
