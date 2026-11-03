import { createHash } from 'node:crypto';
import { buildRenderManifest, type CreateManifestInput, type CreatedManifest } from './manifest-data.js';
export type { CreateManifestInput, CreatedManifest, ManifestAudioAsset } from './manifest-data.js';

export function createRenderManifest(input: CreateManifestInput): CreatedManifest {
  const { manifest, subtitle } = buildRenderManifest(input);
  const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, checksum, subtitle };
}
