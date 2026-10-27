import sharp from 'sharp';

export interface PreparedBackground { bytes: Buffer; mimeType: 'image/webp'; width: 1080; height: 1920; sourceFormat: string | undefined }

export async function prepareBackgroundImage(input: Uint8Array): Promise<PreparedBackground> {
  if (input.byteLength === 0 || input.byteLength > 20 * 1024 * 1024) throw new Error('BACKGROUND_SIZE_INVALID');
  const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 80_000_000, animated: false }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || metadata.width < 160 || metadata.height < 160 || (metadata.pages ?? 1) > 1) throw new Error('BACKGROUND_FORMAT_INVALID');
  const { data } = await sharp(input, { failOn: 'error', limitInputPixels: 80_000_000, animated: false })
    .rotate()
    .resize(1080, 1920, { fit: 'cover', position: 'attention' })
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, mimeType: 'image/webp', width: 1080, height: 1920, sourceFormat: metadata.format };
}
