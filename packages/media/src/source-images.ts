import type { ProductionInput } from './contracts.js';

export function assertSourceImageBindings(input: Pick<ProductionInput, 'sourceImages' | 'commentIds' | 'anonymizeAuthors'>, postId: string) {
  if (!input.sourceImages) return;
  const expected = [`post:${postId}`, ...input.commentIds.map(id => `comment:${id}`)];
  if (input.sourceImages.length !== expected.length || new Set(input.sourceImages.map(image => image.sourceRef)).size !== expected.length || expected.some(ref => !input.sourceImages!.some(image => image.sourceRef === ref))) throw new Error('SOURCE_IMAGE_MISSING');
  if (input.anonymizeAuthors && input.sourceImages.some(image => !image.anonymized)) throw new Error('SOURCE_IMAGE_ANONYMIZATION_REQUIRED');
}

/** Group adjacent shots of the same source so sentence boundaries do not restart the pan. */
export function sourceImageShots(manifest: import('./contracts.js').RenderManifest) {
  const images = manifest.sourceImages;
  if (!images) return [];
  const post = images.find(image => image.sourceRef === `post:${manifest.sourcePostId}`);
  if (!post) throw new Error('SOURCE_POST_IMAGE_MISSING');
  const shots: Array<{ image: typeof post; startFrame: number; endFrame: number }> = [];
  for (const segment of manifest.visualSegments) {
    const ref = segment.sourceRefs.find(ref => ref.startsWith('comment:')) ?? `post:${manifest.sourcePostId}`;
    const image = images.find(image => image.sourceRef === ref);
    if (!image) throw new Error('SOURCE_IMAGE_MISSING');
    const last = shots.at(-1);
    if (last?.image.assetId === image.assetId) last.endFrame = segment.endFrame;
    else { if (last) last.endFrame = segment.startFrame; shots.push({ image, startFrame: segment.startFrame, endFrame: segment.endFrame }); }
  }
  if (shots.length) shots[shots.length - 1]!.endFrame = manifest.durationFrames;
  return shots;
}

export function sourceImagePan(width: number, height: number, frame: number, duration: number) {
  const displayedHeight = height * Math.min(900 / width, 1.5);
  const overflow = Math.max(0, displayedHeight - 1160);
  // Hold the top and bottom before moving, keeping the source text at a readable size.
  const progress = Math.max(0, Math.min(1, (frame / Math.max(1, duration - 1) - 0.15) / 0.7));
  return { width: Math.min(900, width * 1.5), height: displayedHeight, offsetY: -overflow * progress };
}
