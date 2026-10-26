import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { LocalObjectStore } from './index';

it('scopes immutable objects by workspace and rejects traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sf-store-'));
  try {
    const store = new LocalObjectStore(root);
    const workspaceId = randomUUID();
    const bytes = Buffer.from('owned fixture');
    const object = await store.put(workspaceId, bytes);
    expect(await store.put(workspaceId, bytes)).toEqual(object);
    expect(await store.get(workspaceId, object.checksum)).toEqual(bytes);
    await expect(store.get(randomUUID(), object.checksum)).rejects.toThrow();
    await expect(store.put('../escape', bytes)).rejects.toThrow();
    await expect(store.get(workspaceId, '../../secret')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
