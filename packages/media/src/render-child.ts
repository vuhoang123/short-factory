import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { bundle } from '@remotion/bundler';
import { RenderInternals, makeCancelSignal, openBrowser, renderMedia, selectComposition, type RemotionServer } from '@remotion/renderer';
import { z } from 'zod';
import { compositionInputSchema } from './contracts.js';
import { inspectRenderedVideo } from './render.js';

const startSchema = z.object({ type: z.literal('start'), inputProps: compositionInputSchema, outputLocation: z.string().min(1), bundleDirectory: z.string().min(1) }).strict();
const cancelSchema = z.object({ type: z.literal('cancel'), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/) }).strict();
const cancellation = makeCancelSignal();
let cancelledCode: string | undefined;
let started = false;
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
let server: RemotionServer | undefined;
let cleanupPending = Promise.resolve();
let acquiring: Promise<unknown> = Promise.resolve();
let disconnected = false;
let exiting = false;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
function cancelled() { if (cancelledCode) throw new Error(cancelledCode); }
function retainResource<T>(promise: Promise<T>, retain: (resource: T) => void): Promise<T> {
  const retained = promise.then((resource) => { retain(resource); return resource; });
  acquiring = retained;
  return retained;
}
function clearShutdownTimer() { if (shutdownTimer) clearTimeout(shutdownTimer); shutdownTimer = undefined; }
function exit(code: number) { if (!exiting) { exiting = true; clearShutdownTimer(); process.exit(code); } }
function scheduleShutdownFallback(timeoutMs: number) { shutdownTimer ??= setTimeout(terminateOwnedTree, timeoutMs); }
function terminateOwnedTree() {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } else {
    // Remotion also detaches Chrome into its own group; include only our descendants.
    const listing = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 });
    const rows = typeof listing.stdout === 'string' ? listing.stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)) : [];
    const owned = new Set([process.pid]);
    let added = true;
    while (added) {
      added = false;
      for (const [pid, parent] of rows) if (pid && parent && owned.has(parent) && !owned.has(pid)) { owned.add(pid); added = true; }
    }
    for (const pid of [...owned].reverse()) {
      if (pid === process.pid) continue;
      try { process.kill(-pid, 'SIGKILL'); } catch { /* Descendant may not lead a group. */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* Descendant may have exited. */ }
    }
    try { process.kill(-process.pid, 'SIGKILL'); } catch { /* Exit still closes this child. */ }
  }
  exit(1);
}
function cleanup() {
  cleanupPending = cleanupPending.catch(() => undefined).then(async () => {
    // openBrowser may spawn Chrome before returning its handle or registering exit hooks.
    await acquiring.catch(() => undefined);
    const ownedBrowser = browser; browser = undefined;
    const ownedServer = server; server = undefined;
    const closed = await Promise.allSettled([ownedBrowser?.close({ silent: true }), ownedServer?.closeServer(true)]);
    const failure = closed.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  });
  return cleanupPending;
}
async function allocateLoopbackPort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === 'string') reject(new Error('MEDIA_RENDER_SERVER_FAILED'));
        else resolve(address.port);
      });
    });
  });
}
async function send(message: Record<string, unknown>) {
  if (process.connected) await new Promise<void>((resolve) => process.send?.(message, () => resolve()));
}

process.on('message', (raw: unknown) => {
  const cancel = cancelSchema.safeParse(raw);
  if (cancel.success) {
    cancelledCode = cancel.data.code;
    cancellation.cancel();
    // Finish tree cleanup before the parent's two-second hard-stop grace period.
    scheduleShutdownFallback(1500);
    void cleanup().then(clearShutdownTimer, () => undefined);
    return;
  }
  if (started) return;
  started = true;
  void (async () => {
    try {
      const { inputProps, outputLocation, bundleDirectory } = startSchema.parse(raw);
      cancelled();
      const bundlePath = await bundle({
        entryPoint: fileURLToPath(new URL('./entry.tsx', import.meta.url)), outDir: bundleDirectory,
        webpackOverride: (configuration) => ({ ...configuration, resolve: { ...configuration.resolve, extensionAlias: { ...configuration.resolve?.extensionAlias, '.js': ['.ts', '.tsx', '.js'] } } }),
      });
      cancelled();
      const port = await allocateLoopbackPort();
      cancelled();
      const ownedServer = await retainResource(RenderInternals.prepareServer({
        webpackConfigOrServeUrl: bundlePath, port, remotionRoot: process.cwd(),
        offthreadVideoThreads: 2, logLevel: 'error', indent: false, offthreadVideoCacheSizeInBytes: null,
        binariesDirectory: null, forceIPv4: true, sampleRate: 48000,
      }), (resource) => { server = resource; });
      // Remotion binds IPv4 but advertises localhost, which can reach another app on IPv6.
      // Its port=0 reports zero, so hand it a port allocated by the OS instead.
      const serveUrl = new URL(ownedServer.serveUrl); serveUrl.hostname = '127.0.0.1';
      const audioSources = { ...inputProps.audioSources };
      for (const [assetId, source] of Object.entries(audioSources)) {
        if (!source.startsWith('data:audio/wav;base64,')) continue;
        cancelled();
        const bytes = Buffer.from(source.slice('data:audio/wav;base64,'.length), 'base64');
        const filename = `narration-${createHash('sha256').update(bytes).digest('hex')}.wav`;
        await writeFile(path.join(bundleDirectory, filename), bytes, { mode: 0o600 });
        audioSources[assetId] = `${serveUrl.origin}/${filename}`;
      }
      const sourceImageSources = { ...inputProps.sourceImageSources };
      for (const [assetId, source] of Object.entries(sourceImageSources)) {
        if (!source.startsWith('data:image/png;base64,')) throw new Error('SOURCE_IMAGE_FORMAT_INVALID');
        cancelled();
        const bytes = Buffer.from(source.slice('data:image/png;base64,'.length), 'base64');
        const filename = `source-${createHash('sha256').update(bytes).digest('hex')}.png`;
        await writeFile(path.join(bundleDirectory, filename), bytes, { mode: 0o600 });
        sourceImageSources[assetId] = `${serveUrl.origin}/${filename}`;
      }
      // OffthreadVideo puts its source URL in a proxy request; keep media URLs short.
      const localMedia: { backgroundSrc: string | null; musicSrc?: string | null } = { backgroundSrc: inputProps.backgroundSrc, ...(inputProps.musicSrc ? { musicSrc: inputProps.musicSrc } : {}) };
      for (const field of ['backgroundSrc', 'musicSrc'] as const) {
        const source = localMedia[field];
        const match = source?.match(/^data:(video\/mp4|audio\/wav);base64,(.+)$/s);
        if (!match) continue;
        cancelled();
        const bytes = Buffer.from(match[2]!, 'base64');
        const filename = `media-${createHash('sha256').update(bytes).digest('hex')}.${match[1] === 'video/mp4' ? 'mp4' : 'wav'}`;
        await writeFile(path.join(bundleDirectory, filename), bytes, { mode: 0o600 });
        localMedia[field] = `${serveUrl.origin}/${filename}`;
      }
      const renderInput = { ...inputProps, ...localMedia, audioSources, ...(inputProps.sourceImageSources ? { sourceImageSources } : {}) };
      cancelled();
      const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
      const ownedBrowser = await retainResource(openBrowser('chrome', { browserExecutable, logLevel: 'error' }), (resource) => { browser = resource; });
      cancelled();
      const composition = await selectComposition({ serveUrl: serveUrl.origin, id: 'ShortVideo', inputProps: renderInput, puppeteerInstance: ownedBrowser, browserExecutable });
      cancelled();
      await renderMedia({
        composition, serveUrl: serveUrl.origin, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', outputLocation,
        inputProps: renderInput, concurrency: Math.max(1, Number(process.env.MEDIA_RENDER_CONCURRENCY ?? 2)),
        browserExecutable, puppeteerInstance: ownedBrowser, cancelSignal: cancellation.cancelSignal,
        crf: 23, logLevel: 'error',
        onProgress: (value) => { if (process.connected) process.send?.({ type: 'progress', progress: value.progress, renderedFrames: value.renderedFrames, totalFrames: composition.durationInFrames }); },
      });
      cancelled();
      const result = await inspectRenderedVideo(outputLocation);
      await cleanup();
      await send({ type: 'complete', result });
    } catch (error) {
      const code = cancelledCode ?? (error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'MEDIA_RENDER_FAILED');
      await send({ type: 'failed', code });
    } finally {
      await cleanup().catch(() => undefined);
      if (!disconnected) exit(0);
    }
  })();
});
process.once('disconnect', () => {
  disconnected = true;
  cancelledCode ??= 'WORKER_LEASE_LOST';
  cancellation.cancel();
  scheduleShutdownFallback(2000);
  void cleanup().catch(() => undefined).finally(() => { exit(1); });
});
