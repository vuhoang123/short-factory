import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const fileSchema = z.object({ file: z.string().regex(/^[a-z0-9-]+\.(mp4|wav|png)$/), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const curatedMediaEntrySchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,80}$/), kind: z.enum(['BACKGROUND', 'MUSIC']), name: z.string().min(1).max(120),
  category: z.string().max(80), artist: z.string().max(120), description: z.string().max(500),
  sourceUrl: z.string().url().startsWith('https://opengameart.org/content/'), license: z.literal('CC0-1.0'),
  licenseUrl: z.literal('https://creativecommons.org/publicdomain/zero/1.0/'), verifiedAt: z.string().date(),
  mimeType: z.enum(['video/mp4', 'audio/wav']), durationMs: z.number().positive().max(600000),
  file: fileSchema, thumbnail: fileSchema.optional(),
}).strict();
const manifestSchema = z.object({ version: z.literal(1), items: z.array(curatedMediaEntrySchema).max(40) }).strict();
const root = () => path.resolve(process.env.STUDIO_MEDIA_ROOT ?? '.data/studio-media');

export async function readCuratedCatalog() {
  let bytes: Buffer;
  try { bytes = await readFile(path.join(root(), 'catalog.json')); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error; }
  if (bytes.length > 128 * 1024) throw new Error('CURATED_CATALOG_TOO_LARGE');
  const result = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (new Set(result.items.map(item => item.key)).size !== result.items.length) throw new Error('CURATED_KEY_CONFLICT');
  return result.items;
}

export async function readCuratedFile(key: string, thumbnail = false) {
  z.string().regex(/^[a-z0-9-]{1,80}$/).parse(key);
  const entry = (await readCuratedCatalog()).find(item => item.key === key);
  const target = thumbnail ? entry?.thumbnail : entry?.file;
  if (!entry || !target) throw new Error('CURATED_ASSET_NOT_FOUND');
  const filePath = path.join(root(), target.file);
  if ((await stat(filePath)).size > 20 * 1024 * 1024) throw new Error('CURATED_ASSET_TOO_LARGE');
  const bytes = await readFile(filePath);
  if (createHash('sha256').update(bytes).digest('hex') !== target.checksum) throw new Error('CURATED_ASSET_CHANGED');
  return { entry, filePath, bytes };
}
