import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { waveDurationMs } from './tts.js';

const probeSchema = z.object({ codec: z.string().nullable(), width: z.number().int(), height: z.number().int(), fps: z.number(), durationInSeconds: z.number().nullable() }).strict();
function probe(file: string): Promise<z.infer<typeof probeSchema>> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./media-probe-child.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timeout = setTimeout(() => { stop(); reject(new Error('MEDIA_PROBE_TIMEOUT')); }, 15_000);
    child.once('message', raw => { clearTimeout(timeout); const result = probeSchema.safeParse(raw); if (result.success) resolve(result.data); else { stop(); reject(new Error('MEDIA_PROBE_FAILED')); } });
    child.once('error', () => { clearTimeout(timeout); stop(); reject(new Error('MEDIA_PROBE_FAILED')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('MEDIA_PROBE_FAILED')); });
    child.send({ file });
  });
}

export async function prepareStudioMedia(bytes: Buffer, kind: 'BACKGROUND' | 'MUSIC', mimeType: string) {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('MEDIA_UPLOAD_SIZE_INVALID');
  if (kind === 'MUSIC') {
    if (!['audio/wav', 'audio/x-wav'].includes(mimeType)) throw new Error('MUSIC_FORMAT_INVALID');
    let pcm16 = false;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4);
      if (size > bytes.length - offset - 8) throw new Error('MUSIC_FORMAT_INVALID');
      if (bytes.toString('ascii', offset, offset + 4) === 'fmt ' && size >= 16) {
        const channels = bytes.readUInt16LE(offset + 10); const rate = bytes.readUInt32LE(offset + 12);
        pcm16 = bytes.readUInt16LE(offset + 8) === 1 && [1, 2].includes(channels) && rate >= 8000 && rate <= 96000 && bytes.readUInt16LE(offset + 22) === 16 && bytes.readUInt16LE(offset + 20) === channels * 2 && bytes.readUInt32LE(offset + 16) === rate * channels * 2;
      }
      offset += 8 + size + size % 2;
    }
    if (!pcm16) throw new Error('MUSIC_FORMAT_INVALID');
    const durationMs = waveDurationMs(bytes);
    if (durationMs < 1000 || durationMs > 600_000) throw new Error('MUSIC_DURATION_INVALID');
    return { bytes, mimeType: 'audio/wav', durationMs };
  }
  if (mimeType !== 'video/mp4' || bytes.subarray(4, 8).toString() !== 'ftyp') throw new Error('BACKGROUND_VIDEO_FORMAT_INVALID');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-upload-'));
  try {
    const file = path.join(directory, 'background.mp4');
    await writeFile(file, bytes, { mode: 0o600 });
    const meta = await probe(file);
    if (!meta.durationInSeconds || meta.codec !== 'h264' || meta.width < 160 || meta.height < 160 || meta.width > 3840 || meta.height > 3840 || meta.width * meta.height > 3840 * 2160 || meta.fps <= 0 || meta.fps > 60 || meta.durationInSeconds < 1 || meta.durationInSeconds > 300) throw new Error('BACKGROUND_VIDEO_FORMAT_INVALID');
    return { bytes, mimeType: 'video/mp4', width: meta.width, height: meta.height, durationMs: Math.round(meta.durationInSeconds * 1000) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
