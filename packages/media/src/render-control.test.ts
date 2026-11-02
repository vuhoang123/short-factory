import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompositionInput } from './contracts.js';
import { createRenderManifest } from './manifest.js';
import { renderVideo } from './render.js';

const mocks = vi.hoisted(() => ({ fork: vi.fn(), killTree: vi.fn(), rm: vi.fn(), mkdtemp: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: mocks.fork, spawnSync: mocks.killTree }));
vi.mock('node:fs/promises', () => ({ mkdtemp: mocks.mkdtemp, rm: mocks.rm, stat: vi.fn(async () => ({ size: 2000 })) }));
vi.mock('@remotion/bundler', () => ({ bundle: vi.fn(async () => 'bundle') }));
vi.mock('@remotion/renderer', () => ({
  getVideoMetadata: vi.fn(async () => ({ width: 1080, height: 1920, fps: 30, codec: 'h264', audioCodec: 'aac', durationInSeconds: 1 })),
  selectComposition: vi.fn(async () => ({ durationInFrames: 30 })),
  renderMedia: vi.fn(async () => undefined),
  openBrowser: vi.fn(), makeCancelSignal: vi.fn(),
}));

class RenderChild extends EventEmitter {
  pid = 12345;
  connected = true;
  send = vi.fn();
  kill = vi.fn();
}
let child: RenderChild;
beforeEach(() => {
  child = new RenderChild();
  mocks.fork.mockReturnValue(child);
  mocks.mkdtemp.mockResolvedValue('temporary-render-bundle');
  mocks.rm.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function input(): CompositionInput {
  const script = { version: 1, language: 'en', title: 'Synthetic story', targetDurationSec: 10, segments: [
    { id: 'hook', type: 'HOOK' as const, text: 'Our original story.', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' as const },
    { id: 'outro', type: 'OUTRO' as const, text: 'The end.', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' as const },
  ] };
  const { manifest } = createRenderManifest({ storyProjectId: randomUUID(), storyVersionId: randomUUID(), storyVersion: 1,
    sourcePostId: randomUUID(), platform: 'MANUAL', script, templateId: 'SocialCommentary', backgroundAssetId: null,
    attribution: { required: false, text: null }, audioAssets: script.segments.map((segment) => ({ assetId: randomUUID(), segmentId: segment.id, durationMs: 1000 })), subtitlePreset: 'ClassicCaption' });
  return { manifest, post: { title: 'Synthetic story', body: 'Our original story.', authorAlias: null }, comments: [], backgroundSrc: null, audioSources: {} };
}

it('runs rendering in an owned child and does not complete before its exit/cleanup', async () => {
  const rendering = renderVideo(input(), 'output.mp4');
  await vi.waitFor(() => expect(mocks.fork).toHaveBeenCalledOnce());
  expect(child.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }));
  child.emit('message', { type: 'complete', result: { width: 1080, height: 1920, fps: 30, durationMs: 2000, codec: 'h264', audioCodec: 'aac', sizeBytes: 2000 } });
  child.emit('exit', 0, null);
  await expect(rendering).resolves.toMatchObject({ width: 1080, height: 1920 });
  expect(mocks.rm).toHaveBeenCalledWith('temporary-render-bundle', { recursive: true, force: true });
});

it('cancels and terminates a stuck child process tree after the grace period', async () => {
  vi.useFakeTimers();
  const control = new AbortController();
  const rendering = renderVideo(input(), 'output.mp4', undefined, { signal: control.signal, timeoutMs: 10_000 });
  const rejection = expect(rendering).rejects.toThrow('USER_CANCELLED');
  await vi.advanceTimersByTimeAsync(0);
  control.abort(new Error('USER_CANCELLED'));
  await vi.advanceTimersByTimeAsync(2500);
  expect(child.send).toHaveBeenCalledWith({ type: 'cancel', code: 'USER_CANCELLED' }, expect.any(Function));
  if (process.platform === 'win32') expect(mocks.killTree).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/T', '/F'], expect.objectContaining({ windowsHide: true }));
  child.emit('exit', null, 'SIGTERM');
  await rejection;
});

it('enforces a wall-clock timeout even while bundling has not reported progress', async () => {
  vi.useFakeTimers();
  const rendering = renderVideo(input(), 'output.mp4', undefined, { timeoutMs: 1000 });
  const rejection = expect(rendering).rejects.toThrow('MEDIA_RENDER_TIMEOUT');
  await vi.advanceTimersByTimeAsync(3500);
  expect(child.send).toHaveBeenCalledWith({ type: 'cancel', code: 'MEDIA_RENDER_TIMEOUT' }, expect.any(Function));
  child.emit('exit', null, 'SIGTERM');
  await rejection;
});

it('does not start work for an already aborted request', async () => {
  const controller = new AbortController(); controller.abort(new Error('USER_CANCELLED'));
  await expect(renderVideo(input(), 'output.mp4', undefined, { signal: controller.signal })).rejects.toThrow('USER_CANCELLED');
  expect(mocks.fork).not.toHaveBeenCalled();
});
