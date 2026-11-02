import sharp from 'sharp';

/** Preserve screenshot pixels and aspect ratio; never crop a source into a background. */
export async function prepareSourceImage(input: Uint8Array, identity?: string) {
  if (!input.byteLength || input.byteLength > 20 * 1024 * 1024) throw new Error('SOURCE_IMAGE_SIZE_INVALID');
  const image = sharp(input, { failOn: 'error', limitInputPixels: 80_000_000, animated: false });
  const meta = await image.metadata();
  if (meta.format !== 'png' || !meta.width || !meta.height || meta.width < 80 || meta.height < 24 || (meta.pages ?? 1) > 1) throw new Error('SOURCE_IMAGE_FORMAT_INVALID');
  // Equal masked pixels can belong to distinct comments; provenance metadata keeps their assets distinct.
  if (identity) image.withExif({ IFD0: { ImageDescription: identity } });
  const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, mimeType: 'image/png' as const };
}

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
