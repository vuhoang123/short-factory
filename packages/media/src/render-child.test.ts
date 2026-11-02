import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRenderManifest } from './manifest.js';

const mocks = vi.hoisted(() => ({
  bundle: vi.fn(), prepareServer: vi.fn(), closeServer: vi.fn(), closeBrowser: vi.fn(),
  openBrowser: vi.fn(), select: vi.fn(), render: vi.fn(), inspect: vi.fn(), cancel: vi.fn(), send: vi.fn(),
  on: vi.fn(), once: vi.fn(), exit: vi.fn(), kill: vi.fn(), killTree: vi.fn(), connected: true, platform: 'win32',
}));
vi.mock('node:process', () => ({ default: {
  get connected() { return mocks.connected; }, get platform() { return mocks.platform; }, env: {}, pid: 12345, cwd: () => '.',
  on: mocks.on, once: mocks.once, exit: mocks.exit, send: mocks.send, kill: mocks.kill,
} }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.killTree }));
vi.mock('@remotion/bundler', () => ({ bundle: mocks.bundle }));
vi.mock('@remotion/renderer', () => ({
  RenderInternals: { prepareServer: mocks.prepareServer },
  makeCancelSignal: () => ({ cancel: mocks.cancel, cancelSignal: vi.fn() }),
  openBrowser: mocks.openBrowser, selectComposition: mocks.select, renderMedia: mocks.render,
}));
vi.mock('./render.js', () => ({ inspectRenderedVideo: mocks.inspect }));

let onMessage: (raw: unknown) => void;
let onDisconnect: () => void;

function startMessage() {
  const script = { version: 1, language: 'en', title: 'Owned synthetic story', targetDurationSec: 10, segments: [
    { id: 'hook', type: 'HOOK' as const, text: 'Our own original story.', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' as const },
    { id: 'outro', type: 'OUTRO' as const, text: 'The end.', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' as const },
  ] };
  const { manifest } = createRenderManifest({ storyProjectId: randomUUID(), storyVersionId: randomUUID(), storyVersion: 1,
    sourcePostId: randomUUID(), platform: 'MANUAL', script, templateId: 'SocialCommentary', backgroundAssetId: null,
    attribution: { required: false, text: null }, audioAssets: script.segments.map((segment) => ({ assetId: randomUUID(), segmentId: segment.id, durationMs: 1000 })), subtitlePreset: 'ClassicCaption' });
  return { type: 'start', bundleDirectory: 'owned-bundle', outputLocation: 'output.mp4', inputProps: {
    manifest, post: { title: script.title, body: 'Our own original story.', authorAlias: null }, comments: [], backgroundSrc: null, audioSources: {},
  } };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.connected = true;
  mocks.platform = 'win32';
  mocks.bundle.mockResolvedValue('owned-bundle');
  mocks.prepareServer.mockImplementation(async ({ port }: { port: number }) => ({ serveUrl: `http://localhost:${port}`, closeServer: mocks.closeServer }));
  mocks.closeServer.mockResolvedValue(undefined);
  mocks.closeBrowser.mockResolvedValue(undefined);
  mocks.openBrowser.mockResolvedValue({ close: mocks.closeBrowser });
  mocks.select.mockResolvedValue({ durationInFrames: 60 });
  mocks.render.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue({ width: 1080, height: 1920 });
  mocks.send.mockImplementation((_message: unknown, callback?: () => void) => { callback?.(); return true; });
  mocks.on.mockImplementation((event: string, listener: (raw: unknown) => void) => { if (event === 'message') onMessage = listener; });
  mocks.once.mockImplementation((event: string, listener: () => void) => { if (event === 'disconnect') onDisconnect = listener; });
  await import('./render-child.js');
});

afterEach(() => { vi.useRealTimers(); });

it('shares an owned numeric loopback URL on an OS allocated port for selection and render', async () => {
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalled());
  expect(mocks.prepareServer).toHaveBeenCalledOnce();
  const { port } = mocks.prepareServer.mock.calls[0]![0] as { port: number };
  expect(port).toBeGreaterThan(0);
  const serveUrl = `http://127.0.0.1:${port}`;
  expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ serveUrl }));
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ serveUrl }));
  expect(mocks.closeServer).toHaveBeenCalledExactlyOnceWith(true);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'complete' }), expect.any(Function));
});

it('closes the owned server when selecting the composition fails', async () => {
  mocks.select.mockRejectedValueOnce(new Error('COMPOSITION_INVALID'));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalled());
  expect(mocks.closeServer).toHaveBeenCalledExactlyOnceWith(true);
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({ type: 'failed', code: 'COMPOSITION_INVALID' }, expect.any(Function));
});

it('closes only the owned server when a render is cancelled', async () => {
  let finishSelection!: (value: { durationInFrames: number }) => void;
  mocks.select.mockImplementationOnce(() => new Promise((resolve) => { finishSelection = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.select).toHaveBeenCalled());
  onMessage({ type: 'cancel', code: 'USER_CANCELLED' });
  await vi.waitFor(() => expect(mocks.closeServer).toHaveBeenCalledExactlyOnceWith(true));
  finishSelection({ durationInFrames: 60 });
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalled());
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({ type: 'failed', code: 'USER_CANCELLED' }, expect.any(Function));
});

it('waits for an opening browser after disconnect and closes its handle before exiting', async () => {
  let finishOpening!: (value: { close: typeof mocks.closeBrowser }) => void;
  mocks.openBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishOpening = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.openBrowser).toHaveBeenCalled());
  mocks.connected = false; onDisconnect();
  await new Promise((resolve) => setImmediate(resolve));
  expect(mocks.exit).not.toHaveBeenCalled();
  finishOpening({ close: mocks.closeBrowser });
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1));
  expect(mocks.closeBrowser).toHaveBeenCalledOnce();
  expect(mocks.closeServer).toHaveBeenCalledOnce();
  expect(mocks.closeBrowser.mock.invocationCallOrder[0]).toBeLessThan(mocks.exit.mock.invocationCallOrder[0]!);
  expect(mocks.select).not.toHaveBeenCalled();
});

it('waits for server acquisition on disconnect and closes the late server handle', async () => {
  let finishServer!: (value: { serveUrl: string; closeServer: typeof mocks.closeServer }) => void;
  mocks.prepareServer.mockImplementationOnce(() => new Promise((resolve) => { finishServer = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.prepareServer).toHaveBeenCalled());
  mocks.connected = false; onDisconnect();
  await new Promise((resolve) => setImmediate(resolve));
  expect(mocks.exit).not.toHaveBeenCalled();
  finishServer({ serveUrl: 'http://localhost:51234', closeServer: mocks.closeServer });
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1));
  expect(mocks.closeServer).toHaveBeenCalledExactlyOnceWith(true);
  expect(mocks.closeServer.mock.invocationCallOrder[0]).toBeLessThan(mocks.exit.mock.invocationCallOrder[0]!);
  expect(mocks.openBrowser).not.toHaveBeenCalled();
});

it('waits for browser acquisition during cancellation and closes the late handle', async () => {
  let finishOpening!: (value: { close: typeof mocks.closeBrowser }) => void;
  mocks.openBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishOpening = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.openBrowser).toHaveBeenCalled());
  onMessage({ type: 'cancel', code: 'USER_CANCELLED' });
  finishOpening({ close: mocks.closeBrowser });
  await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalled());
  expect(mocks.closeBrowser).toHaveBeenCalledOnce();
  expect(mocks.closeServer).toHaveBeenCalledOnce();
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({ type: 'failed', code: 'USER_CANCELLED' }, expect.any(Function));
});

it('terminates its own process tree if disconnected browser acquisition never finishes', async () => {
  let finishOpening!: (value: { close: typeof mocks.closeBrowser }) => void;
  mocks.openBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishOpening = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.openBrowser).toHaveBeenCalled());
  vi.useFakeTimers();
  mocks.connected = false; onDisconnect();
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.killTree).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/T', '/F'], expect.objectContaining({ windowsHide: true }));
  expect(mocks.exit).toHaveBeenCalledWith(1);
  finishOpening({ close: mocks.closeBrowser });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.closeBrowser).toHaveBeenCalledOnce();
});

it('limits a Unix disconnect fallback to its own descendants and their groups', async () => {
  mocks.platform = 'linux';
  mocks.killTree.mockReturnValue({ status: 0, stdout: '20123 12345\n20124 20123\n8080 1\n99999 8080\n' });
  let finishOpening!: (value: { close: typeof mocks.closeBrowser }) => void;
  mocks.openBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishOpening = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.openBrowser).toHaveBeenCalled());
  vi.useFakeTimers();
  mocks.connected = false; onDisconnect();
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.kill).toHaveBeenCalledWith(-20123, 'SIGKILL');
  expect(mocks.kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
  expect(mocks.kill.mock.calls.map(([pid]) => Math.abs(Number(pid)))).not.toContain(8080);
  expect(mocks.kill.mock.calls.map(([pid]) => Math.abs(Number(pid)))).not.toContain(99999);
  finishOpening({ close: mocks.closeBrowser });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.closeBrowser).toHaveBeenCalledOnce();
});

it('terminates its own tree before the parent grace period if cancelled acquisition stays pending', async () => {
  let finishOpening!: (value: { close: typeof mocks.closeBrowser }) => void;
  mocks.openBrowser.mockImplementationOnce(() => new Promise((resolve) => { finishOpening = resolve; }));
  onMessage(startMessage());
  await vi.waitFor(() => expect(mocks.openBrowser).toHaveBeenCalled());
  vi.useFakeTimers();
  onMessage({ type: 'cancel', code: 'USER_CANCELLED' });
  await vi.advanceTimersByTimeAsync(1500);
  expect(mocks.killTree).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/T', '/F'], expect.objectContaining({ windowsHide: true }));
  expect(mocks.exit).toHaveBeenCalledWith(1);
  finishOpening({ close: mocks.closeBrowser });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.closeBrowser).toHaveBeenCalledOnce();
});
