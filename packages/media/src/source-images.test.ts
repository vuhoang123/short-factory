import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assertSourceImageBindings, sourceImagePan, sourceImageShots } from './source-images.js';
import { prepareSourceImage } from './background.js';
import type { RenderManifest } from './contracts.js';

describe('original source screenshots', () => {
  it('preserves source dimensions and pixels instead of cropping to the video canvas', async () => {
    const png = await sharp({ create: { width: 600, height: 2400, channels: 3, background: '#1256ab' } }).png().toBuffer();
    const prepared = await prepareSourceImage(png);
    expect(prepared).toMatchObject({ width: 600, height: 2400, mimeType: 'image/png' });
    const pixel = await sharp(prepared.bytes).extract({ left: 10, top: 2300, width: 1, height: 1 }).raw().toBuffer();
    expect([...pixel]).toEqual([18, 86, 171]);
    const first = await prepareSourceImage(png, 'first-source');
    const second = await prepareSourceImage(png, 'second-source');
    expect(first.bytes.equals(second.bytes)).toBe(false);
    expect((await sharp(first.bytes).raw().toBuffer()).equals(await sharp(second.bytes).raw().toBuffer())).toBe(true);
    await expect(prepareSourceImage(await sharp(png).jpeg().toBuffer())).rejects.toThrow('SOURCE_IMAGE_FORMAT_INVALID');
  });
  it('rejects missing, duplicate, foreign source and unmasked bindings without text-card fallback', () => {
    const postId = randomUUID(), commentId = randomUUID();
    const post = { assetId: randomUUID(), checksum: 'a'.repeat(64), width: 600, height: 900, anonymized: true, sourceRef: `post:${postId}` };
    const comment = { ...post, assetId: randomUUID(), sourceRef: `comment:${commentId}` };
    const input = { commentIds: [commentId], anonymizeAuthors: true, sourceImages: [post, comment] };
    expect(() => assertSourceImageBindings(input, postId)).not.toThrow();
    expect(() => assertSourceImageBindings({ ...input, sourceImages: [post] }, postId)).toThrow('SOURCE_IMAGE_MISSING');
    expect(() => assertSourceImageBindings({ ...input, sourceImages: [post, post] }, postId)).toThrow('SOURCE_IMAGE_MISSING');
    expect(() => assertSourceImageBindings(input, randomUUID())).toThrow('SOURCE_IMAGE_MISSING');
    expect(() => assertSourceImageBindings({ ...input, sourceImages: [post, { ...comment, anonymized: false }] }, postId)).toThrow('SOURCE_IMAGE_ANONYMIZATION_REQUIRED');
  });
  it('keeps one continuous shot across post sentences and fills narration gaps', () => {
    const postId = randomUUID();
    const image = { assetId: randomUUID(), checksum: 'a'.repeat(64), width: 600, height: 2400, anonymized: true, sourceRef: `post:${postId}` };
    const manifest = { sourcePostId: postId, sourceImages: [image], durationFrames: 100, visualSegments: [{ sourceRefs: [], startFrame: 0, endFrame: 40 }, { sourceRefs: [`post:${postId}`], startFrame: 43, endFrame: 100 }] } as unknown as RenderManifest;
    expect(sourceImageShots(manifest)).toEqual([{ image, startFrame: 0, endFrame: 100 }]);
    expect(sourceImagePan(600, 2400, 0, 100)).toMatchObject({ width: 900, height: 3600, offsetY: -0 });
    expect(sourceImagePan(600, 2400, 99, 100).offsetY).toBe(-2440);
    expect(sourceImagePan(600, 200, 99, 100).offsetY).toBe(-0);
  });
});
