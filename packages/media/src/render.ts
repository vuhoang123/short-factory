import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia as remotionRenderMedia, selectComposition } from '@remotion/renderer';
import { compositionInputSchema, type CompositionInput } from './contracts.js';

export interface RenderProgress { progress: number; renderedFrames: number; totalFrames: number }
export interface RenderResult { width: number; height: number; fps: number; durationMs: number; codec: string; audioCodec: string | null; sizeBytes: number }

export async function inspectRenderedVideo(file: string): Promise<RenderResult> {
  const metadata = await getVideoMetadata(file, { logLevel: 'error' });
  const fileStat = await stat(file);
  if (metadata.width !== 1080 || metadata.height !== 1920 || metadata.fps !== 30 || metadata.codec !== 'h264' || metadata.audioCodec !== 'aac' || !metadata.durationInSeconds || fileStat.size < 1024) throw new Error('MEDIA_VALIDATION_FAILED');
  return { width: metadata.width, height: metadata.height, fps: metadata.fps, durationMs: Math.round(metadata.durationInSeconds * 1000), codec: metadata.codec, audioCodec: metadata.audioCodec, sizeBytes: fileStat.size };
}

export async function renderVideo(inputProps: CompositionInput, outputLocation: string, onProgress: (progress: RenderProgress) => void = () => undefined): Promise<RenderResult> {
  const input = compositionInputSchema.parse(inputProps);
  const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'sf-remotion-'));
  try {
    const serveUrl = await bundle({
      entryPoint: fileURLToPath(new URL('./entry.tsx', import.meta.url)),
      outDir: bundleDirectory,
      webpackOverride: (configuration) => ({
        ...configuration,
        resolve: {
          ...configuration.resolve,
          extensionAlias: { ...configuration.resolve?.extensionAlias, '.js': ['.ts', '.tsx', '.js'] },
        },
      }),
    });
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
    const composition = await selectComposition({ serveUrl, id: 'ShortVideo', inputProps: input, browserExecutable });
    await remotionRenderMedia({
      composition, serveUrl, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', outputLocation,
      inputProps: input, concurrency: Math.max(1, Number(process.env.MEDIA_RENDER_CONCURRENCY ?? 2)),
      browserExecutable,
      crf: 23, logLevel: 'error',
      onProgress: (value) => onProgress({ progress: value.progress, renderedFrames: value.renderedFrames, totalFrames: composition.durationInFrames }),
    });
    return await inspectRenderedVideo(outputLocation);
  } finally {
    await rm(bundleDirectory, { recursive: true, force: true });
  }
}
