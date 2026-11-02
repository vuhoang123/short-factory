import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@shorts-factory/database';
import { DeterministicMockScriptProvider, LocalNarrationProcessor, LocalObjectStore, LocalTtsProvider, MockTtsProvider, createRenderManifest, type ProductionInput, type StoryScript } from '@shorts-factory/media';
import { afterEach, expect, it, vi } from 'vitest';
import { readMediaWorkerConfig } from './config.js';
import { MediaProductionPipeline } from './pipeline.js';

interface TestAudio {
  id: string; workspaceId: string; storyVersionId: string; segmentId: string; cacheKey: string; durationMs: number; timingPrecision: string;
  mediaAsset: { id: string; checksum: string; mimeType: string };
}
interface AudioSteps {
  source(run: unknown, input: ProductionInput): { comments: Array<{ id: string }> };
  generateAudio(run: unknown, input: ProductionInput, version: unknown, script: StoryScript): Promise<TestAudio[]>;
  alignAudio(run: unknown, input: ProductionInput, script: StoryScript, audio: TestAudio[]): Promise<{ timingPrecision: string; provider?: string; adjustedWords?: number; segments: Array<{ startMs: number; endMs: number; providerTimings?: Array<{ text: string; startMs: number; endMs: number }> }> }>;
  fitAudioDuration(run: unknown, input: ProductionInput, version: unknown, script: StoryScript, audio: TestAudio[]): Promise<TestAudio[]>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv('TTS_PROVIDER', 'mock');
  const workspaceId = randomUUID();
  const post = { id: randomUUID(), platform: 'MANUAL' as const, title: 'Owned story', body: 'Our community repaired a bicycle together.',
    comments: Array.from({ length: 3 }, (_, index) => ({ id: randomUUID(), body: `Genuine selected comment number ${index + 1}.`, sensitiveFlags: [] })),
    sensitiveFlags: [], rights: [{ reviewStatus: 'APPROVED', attested: true, commercialAllowed: true, allowedPlatforms: ['YOUTUBE'], revokedAt: null, expiresAt: null, attributionRequired: false }],
  };
  const script = (await new DeterministicMockScriptProvider().generate({ source: post, language: 'vi', targetDurationSec: 40, style: 'STORYTELLING' })).script;
  const run = { id: randomUUID(), workspaceId, attempts: 1, story: { id: randomUUID(), post } };
  const version = { id: randomUUID(), version: 1 };
  const input: ProductionInput = { mode: 'CREATE', candidateId: null, channelId: randomUUID(), commentIds: post.comments.map((comment) => comment.id), language: 'vi', targetDurationSec: 40,
    style: 'STORYTELLING', voiceProfileId: 'mock:default', voiceId: 'demo-tone', speakingRate: 1, templateId: 'SocialCommentary', backgroundAssetId: null,
    subtitlePreset: 'ClassicCaption', theme: 'dark', anonymizeAuthors: true, showEngagement: false, selectedSegmentIds: [], storyVersionId: null };
  const audio: TestAudio[] = [];
  const stages = new Map<string, { status: string; output?: unknown }>();
  const media = new Map<string, TestAudio['mediaAsset']>();
  const stageKey = (where: { workspaceId_productionRunId_name: { productionRunId: string; name: string } }) => `${where.workspaceId_productionRunId_name.productionRunId}:${where.workspaceId_productionRunId_name.name}`;
  const database = {
    productionRun: { findFirst: vi.fn(async () => ({ id: run.id })), updateMany: vi.fn(async () => ({ count: 1 })) },
    sourcePost: { findFirst: vi.fn(async () => post) },
    workflowRun: { findFirst: vi.fn(async () => null) },
    storyProject: { updateMany: vi.fn(async () => ({ count: 1 })) },
    productionStage: {
      findUnique: vi.fn(async ({ where }: { where: Parameters<typeof stageKey>[0] }) => stages.get(stageKey(where)) ?? null),
      upsert: vi.fn(async ({ where }: { where: Parameters<typeof stageKey>[0] }) => { const value = { status: 'RUNNING' }; stages.set(stageKey(where), value); return value; }),
      update: vi.fn(async ({ where, data }: { where: Parameters<typeof stageKey>[0]; data: { status?: string; output?: unknown } }) => {
        const value = { status: 'RUNNING', ...stages.get(stageKey(where)), ...data };
        stages.set(stageKey(where), value); return value;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { productionRunId: string; name: string | { in: string[] } }; data: { status: string; output?: unknown } }) => {
        const names = typeof where.name === 'string' ? [where.name] : where.name.in;
        for (const name of names) if (stages.has(`${where.productionRunId}:${name}`)) stages.set(`${where.productionRunId}:${name}`, data);
        return { count: 1 };
      }),
    },
    audioAsset: {
      findFirst: vi.fn(async ({ where }: { where: { workspaceId: string; cacheKey: string } }) => audio.find((row) => row.workspaceId === where.workspaceId && row.cacheKey === where.cacheKey) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<TestAudio, 'id' | 'mediaAsset'> & { mediaAssetId: string } }) => {
        const row = { ...data, id: randomUUID(), mediaAsset: media.get(data.mediaAssetId)! }; audio.push(row); return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string; storyVersionId: string; id?: { in: string[] }; mediaAssetId?: { in: string[] } } }) => audio.filter((row) => row.workspaceId === where.workspaceId && row.storyVersionId === where.storyVersionId && (!where.id || where.id.in.includes(row.id)) && (!where.mediaAssetId || where.mediaAssetId.in.includes(row.mediaAsset.id))).reverse()),
      aggregate: vi.fn(async () => ({ _sum: { durationMs: audio.reduce((sum, row) => sum + row.durationMs, 0) } })),
    },
    mediaAsset: { upsert: vi.fn(async ({ create }: { create: { checksum: string; mimeType: string } }) => { const row = { id: randomUUID(), ...create }; media.set(row.id, row); return row; }) },
    renderManifest: { findFirst: vi.fn(async (): Promise<{ manifest: unknown } | null> => null) },
  };
  const db = { ...database, $transaction: async <T>(work: (tx: typeof database) => Promise<T>) => work(database) } as unknown as PrismaClient;
  vi.spyOn(LocalObjectStore.prototype, 'put').mockImplementation(async (tenantId, bytes) => {
    const checksum = createHash('sha256').update(bytes).digest('hex'); return { checksum, storageKey: `${tenantId}/${checksum}`, size: bytes.byteLength };
  });
  const config = readMediaWorkerConfig({ DATABASE_URL: 'postgresql://localhost/unused_test', REDIS_URL: 'redis://localhost', MEDIA_MAX_RENDER_SECONDS: '60' });
  const steps = new MediaProductionPipeline(db, config) as unknown as AudioSteps;
  return { audio, stages, database, steps, run, input, version, script };
}

it('keeps audio for all three comments and their repeated transitions, then replays without duplicate rows', async () => {
  const f = await fixture();
  await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(f.audio.map((row) => row.segmentId).sort()).toEqual(f.script.segments.map((segment) => segment.id).sort());
  expect(new Set(f.audio.map((row) => row.cacheKey)).size).toBe(f.script.segments.length);
  await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(f.audio).toHaveLength(f.script.segments.length);
});

it('preserves frozen reaction/selection order independently of database comment row order', async () => {
  const f = await fixture();
  const commentIds = [...f.input.commentIds].reverse();
  expect(f.steps.source(f.run, { ...f.input, commentIds }).comments.map((comment) => comment.id)).toEqual(commentIds);
  expect(() => f.steps.source(f.run, { ...f.input, commentIds: [randomUUID()] })).toThrow('COMMENT_NOT_IN_SOURCE');
});

it('preserves a queued local speech job after the launcher changes its default to VieNeu', async () => {
  const f = await fixture();
  vi.stubEnv('TTS_PROVIDER', 'vieneu');
  vi.stubEnv('TTS_WSL_DISTRO', 'Ubuntu');
  const synthesize = vi.spyOn(LocalTtsProvider.prototype, 'synthesize').mockImplementation((input) => new MockTtsProvider().synthesize(input));
  const input = { ...f.input, voiceProfileId: 'local:vietnamese', voiceId: 'vi' };
  const audio = await f.steps.generateAudio(f.run, input, f.version, f.script);
  expect(audio).toHaveLength(f.script.segments.length);
  expect(synthesize).toHaveBeenCalled();
});

it('generates only a short sample at the selected rate and keeps it separate from full narration', async () => {
  const f = await fixture();
  const preview = await f.steps.generateAudio(f.run, { ...f.input, mode: 'AUDIO_ONLY', preview: true, speakingRate: 1.15 }, f.version, f.script);
  expect(preview).toHaveLength(1);
  expect(preview[0]).toMatchObject({ segmentId: 'voice-preview' });
  expect(preview[0]!.durationMs).toBeLessThan(15000);
  const full = await f.steps.generateAudio({ ...f.run, id: randomUUID() }, f.input, f.version, f.script);
  expect(full.every((row) => row.id !== preview[0]!.id)).toBe(true);
  expect(full).toHaveLength(f.script.segments.length);
});

it('checkpoints fitted audio without overwriting raw narration, and replays the same selection', async () => {
  const f = await fixture();
  const raw = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  const header = (await new MockTtsProvider().synthesize({ text: 'one', language: 'en', voiceId: 'mock', speakingRate: 1 })).audio.subarray(0, 44);
  vi.spyOn(LocalObjectStore.prototype, 'get').mockResolvedValue(Buffer.from(header));
  const retime = vi.spyOn(LocalNarrationProcessor.prototype, 'retime').mockImplementation(async (_bytes, duration) => {
    const size = Math.round(duration * 16) * 2;
    const bytes = Buffer.concat([header, Buffer.alloc(size)]); bytes.writeUInt32LE(size + 36, 4); bytes.writeUInt32LE(size, 40);
    return bytes;
  });
  const targetDurationSec = Math.round((raw.reduce((total, row) => total + row.durationMs, 0) + (raw.length - 1) * 100) / 1000);
  const input = { ...f.input, audioTimed: true as const, targetDurationSec };
  const fitted = await f.steps.fitAudioDuration(f.run, input, f.version, f.script, raw);
  expect(fitted.every((row) => !raw.some((item) => item.id === row.id))).toBe(true);
  expect(Math.abs(fitted.reduce((total, row) => total + row.durationMs, (fitted.length - 1) * 100) - targetDurationSec * 1000)).toBeLessThan(10);
  expect((await f.steps.fitAudioDuration(f.run, input, f.version, f.script, raw)).map((row) => row.id)).toEqual(fitted.map((row) => row.id));
  expect(retime).toHaveBeenCalledTimes(raw.length);
});

it('checkpoints forced word offsets and bounded adjustment counts, releasing local model memory once', async () => {
  const f = await fixture();
  const audio = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  vi.spyOn(LocalObjectStore.prototype, 'get').mockResolvedValue(Buffer.alloc(4));
  const align = vi.spyOn(LocalNarrationProcessor.prototype, 'align').mockImplementation(async (_audio, text) => ({ provider: 'fixture-forced-aligner', adjustedWords: 1, words: text.split(/\s+/u).map((word, index) => ({ text: word, startMs: index * 100, endMs: index * 100 + 80 })) }));
  const release = vi.spyOn(LocalNarrationProcessor.prototype, 'release').mockResolvedValue(undefined);
  const input = { ...f.input, audioTimed: true as const };
  const output = await f.steps.alignAudio(f.run, input, f.script, audio);
  expect(output).toMatchObject({ timingPrecision: 'PROVIDER', provider: 'fixture-forced-aligner', adjustedWords: f.script.segments.length });
  expect(output.segments[1]?.providerTimings?.[0]?.startMs).toBe(audio[0]!.durationMs + 100);
  expect(await f.steps.alignAudio(f.run, input, f.script, audio)).toEqual(output);
  expect(align).toHaveBeenCalledTimes(f.script.segments.length);
  expect(release).toHaveBeenCalledOnce();
});

it('releases model memory after a failed alignment and leaves that stage retryable', async () => {
  const f = await fixture();
  const audio = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  vi.spyOn(LocalObjectStore.prototype, 'get').mockResolvedValue(Buffer.alloc(4));
  vi.spyOn(LocalNarrationProcessor.prototype, 'align').mockRejectedValue(new Error('AUDIO_ALIGNMENT_FAILED'));
  const release = vi.spyOn(LocalNarrationProcessor.prototype, 'release').mockResolvedValue(undefined);
  await expect(f.steps.alignAudio(f.run, { ...f.input, audioTimed: true }, f.script, audio)).rejects.toThrow('AUDIO_ALIGNMENT_FAILED');
  expect(release).toHaveBeenCalledOnce();
  expect(f.stages.get(`${f.run.id}:AUDIO_ALIGNMENT`)?.status).toBe('FAILED');
});

it('freezes each run audio selection and excludes earlier rates from duration and alignment', async () => {
  const f = await fixture();
  const first = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  const laterRun = { ...f.run, id: randomUUID() };
  const laterInput = { ...f.input, speakingRate: 2 };
  const selected = await f.steps.generateAudio(laterRun, laterInput, f.version, f.script);
  expect(selected).toHaveLength(f.script.segments.length);
  expect(selected.every((row) => !first.some((old) => old.id === row.id))).toBe(true);
  const alignment = await f.steps.alignAudio(laterRun, laterInput, f.script, selected);
  expect(alignment.segments.map((segment) => segment.endMs - segment.startMs)).toEqual(selected.map((row) => row.durationMs));
  const replay = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(replay.map((row) => row.id)).toEqual(first.map((row) => row.id));
  expect(f.database.audioAsset.aggregate).not.toHaveBeenCalled();
});

it('repairs a legacy successful TTS checkpoint that did not record its selected audio', async () => {
  const f = await fixture();
  f.stages.set(`${f.run.id}:TTS_GENERATION`, { status: 'SUCCEEDED', output: { ok: true } });
  f.stages.set(`${f.run.id}:AUDIO_ALIGNMENT`, { status: 'SUCCEEDED', output: { timingPrecision: 'APPROXIMATE', segments: [] } });
  const selected = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(selected).toHaveLength(f.script.segments.length);
  expect(f.stages.get(`${f.run.id}:AUDIO_ALIGNMENT`)?.status).toBe('PENDING');
  expect(f.stages.get(`${f.run.id}:TTS_GENERATION`)?.output).toEqual({ ok: true, audioAssetIds: selected.map((row) => row.id) });
});

it('restores legacy audio selection from the saved manifest without resynthesizing another voice rendition', async () => {
  const f = await fixture();
  await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  const historical = await f.steps.generateAudio({ ...f.run, id: randomUUID() }, { ...f.input, speakingRate: 2 }, f.version, f.script);
  const { manifest } = createRenderManifest({ storyProjectId: f.run.story.id, storyVersionId: f.version.id, storyVersion: 1,
    sourcePostId: f.run.story.post.id, platform: 'MANUAL', script: f.script, templateId: f.input.templateId,
    backgroundAssetId: null, attribution: { required: false, text: null }, subtitlePreset: f.input.subtitlePreset,
    audioAssets: historical.map((row) => ({ assetId: row.mediaAsset.id, segmentId: row.segmentId, durationMs: row.durationMs })) });
  f.database.renderManifest.findFirst.mockResolvedValue({ manifest });
  f.stages.set(`${f.run.id}:TTS_GENERATION`, { status: 'SUCCEEDED', output: { ok: true } });
  const before = f.audio.length;
  const restored = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(restored.map((row) => row.id)).toEqual(historical.map((row) => row.id));
  expect(f.audio).toHaveLength(before);
});

it('rejects a selected audio row outside the run workspace even when its ID is in the checkpoint', async () => {
  const f = await fixture();
  const selected = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  selected[0]!.workspaceId = randomUUID();
  await expect(f.steps.generateAudio(f.run, f.input, f.version, f.script)).rejects.toThrow('AUDIO_ASSET_MISSING');
  expect(f.database.audioAsset.findMany).toHaveBeenLastCalledWith({ where: { workspaceId: f.run.workspaceId, storyVersionId: f.version.id, id: { in: selected.map((row) => row.id) } }, include: { mediaAsset: true } });
});

it('resumes persisted audio without requiring the previous provider to remain configured', async () => {
  const f = await fixture();
  const selected = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  vi.stubEnv('TTS_PROVIDER', 'openai');
  vi.stubEnv('OPENAI_API_KEY', '');
  const replay = await f.steps.generateAudio(f.run, f.input, f.version, f.script);
  expect(replay.map((row) => row.id)).toEqual(selected.map((row) => row.id));
});
