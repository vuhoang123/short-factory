import { mkdtemp, rm, stat } from 'node:fs/promises';
import { fork, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVideoMetadata } from '@remotion/renderer';
import { z } from 'zod';
import { compositionInputSchema, type CompositionInput } from './contracts.js';

export interface RenderProgress { progress: number; renderedFrames: number; totalFrames: number }
export interface RenderResult { width: number; height: number; fps: number; durationMs: number; codec: string; audioCodec: string | null; sizeBytes: number }
export interface RenderControl { signal?: AbortSignal; timeoutMs?: number }
export interface VideoRenderProvider {
  readonly id: string;
  render(input: CompositionInput, output: string, onProgress?: (progress: RenderProgress) => void, control?: RenderControl): Promise<RenderResult>;
}

export const remotionRenderProvider: VideoRenderProvider = { id: 'remotion-local', render: renderVideo };

export const renderResultSchema = z.object({ width: z.literal(1080), height: z.literal(1920), fps: z.literal(30), durationMs: z.number().int().positive(), codec: z.literal('h264'), audioCodec: z.literal('aac'), sizeBytes: z.number().int().positive() }).strict();
const renderMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), progress: z.number().min(0).max(1), renderedFrames: z.number().nonnegative(), totalFrames: z.number().positive() }).strict(),
  z.object({ type: z.literal('complete'), result: renderResultSchema }).strict(),
  z.object({ type: z.literal('failed'), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/) }).strict(),
]);

export async function inspectRenderedVideo(file: string): Promise<RenderResult> {
  const metadata = await getVideoMetadata(file, { logLevel: 'error' });
  const fileStat = await stat(file);
  if (metadata.width !== 1080 || metadata.height !== 1920 || metadata.fps !== 30 || metadata.codec !== 'h264' || metadata.audioCodec !== 'aac' || !metadata.durationInSeconds || fileStat.size < 1024) throw new Error('MEDIA_VALIDATION_FAILED');
  return { width: metadata.width, height: metadata.height, fps: metadata.fps, durationMs: Math.round(metadata.durationInSeconds * 1000), codec: metadata.codec, audioCodec: metadata.audioCodec, sizeBytes: fileStat.size };
}

export async function renderVideo(inputProps: CompositionInput, outputLocation: string, onProgress: (progress: RenderProgress) => void = () => undefined, control: RenderControl = {}): Promise<RenderResult> {
  const input = compositionInputSchema.parse(inputProps);
  const timeoutMs = z.number().int().min(1).max(3_600_000).parse(control.timeoutMs ?? 600_000);
  if (control.signal?.aborted) throw control.signal.reason instanceof Error ? control.signal.reason : new Error('USER_CANCELLED');
  const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'sf-remotion-'));
  try {
    return await new Promise<RenderResult>((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./render-child.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'], detached: process.platform !== 'win32', windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let result: RenderResult | undefined;
      let failure: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
        else {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') child.kill('SIGKILL'); }
        }
      };
      const cancel = (code: string) => {
        if (failure) return;
        failure = new Error(code);
        if (child.connected) child.send({ type: 'cancel', code }, (error) => { if (error) terminate(); });
        killTimer = setTimeout(terminate, 2000);
      };
      const abort = () => cancel(control.signal?.reason instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(control.signal.reason.message) ? control.signal.reason.message : 'USER_CANCELLED');
      const timer = setTimeout(() => cancel('MEDIA_RENDER_TIMEOUT'), timeoutMs);
      const cleanup = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); control.signal?.removeEventListener('abort', abort); };
      control.signal?.addEventListener('abort', abort, { once: true });
      child.on('message', (raw: unknown) => {
        const message = renderMessageSchema.safeParse(raw);
        if (!message.success) { cancel('MEDIA_RENDER_PROTOCOL_INVALID'); return; }
        if (message.data.type === 'failed') {
          failure ??= new Error(message.data.code);
          killTimer ??= setTimeout(terminate, 2000);
        }
        else if (message.data.type === 'complete') result = message.data.result;
        else if (!failure) {
          try { onProgress(message.data); } catch { cancel('MEDIA_RENDER_PROGRESS_FAILED'); }
        }
      });
      child.once('error', () => { cleanup(); terminate(); reject(failure ?? new Error('MEDIA_RENDER_PROCESS_FAILED')); });
      child.once('exit', (code) => {
        cleanup();
        if (failure) reject(failure);
        else if (code !== 0 || !result) reject(new Error('MEDIA_RENDER_PROCESS_FAILED'));
        else resolve(result);
      });
      if (control.signal?.aborted) abort();
      else child.send({ type: 'start', inputProps: input, outputLocation: path.resolve(outputLocation), bundleDirectory });
    });
  } finally {
    await rm(bundleDirectory, { recursive: true, force: true });
  }
}
