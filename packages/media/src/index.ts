import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const workspaceSchema = z.string().uuid();
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Phase 0 immutable local store. Callers must authorize workspace access first. */
export class LocalObjectStore {
  constructor(private readonly root: string) {}
  private objectPath(workspaceId: string, checksum: string) {
    return path.resolve(this.root, workspaceSchema.parse(workspaceId), checksumSchema.parse(checksum));
  }
  async put(workspaceId: string, bytes: Uint8Array): Promise<{ storageKey: string; checksum: string; size: number }> {
    workspaceSchema.parse(workspaceId);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const file = this.objectPath(workspaceId, checksum);
    await mkdir(path.dirname(file), { recursive: true });
    try { await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      if (!Buffer.from(bytes).equals(await readFile(file))) throw new Error('Object checksum collision or corrupt store');
    }
    return { storageKey: `${workspaceId}/${checksum}`, checksum, size: bytes.length };
  }
  async get(workspaceId: string, checksum: string): Promise<Buffer> {
    const bytes = await readFile(this.objectPath(workspaceId, checksum));
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Corrupt object');
    return bytes;
  }
  async delete(workspaceId: string, checksum: string): Promise<void> {
    await rm(this.objectPath(workspaceId, checksum), { force: true });
  }
}

export * from './contracts.js';
export * from './script.js';
export * from './alignment.js';
export * from './tts.js';
export * from './subtitles.js';
export * from './manifest.js';
export * from './background.js';
export * from './render.js';
