import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { prepareBackgroundImage } from './background.js';
import { productionInputSchema, type ProductionInput } from './contracts.js';
import { createRenderManifest } from './manifest.js';
import { DeterministicMockScriptProvider, assertGroundedScript } from './script.js';
import { generateSubtitleTrack } from './subtitles.js';
import { ProviderMetadataAlignmentProvider } from './alignment.js';
import { MockTtsProvider } from './tts.js';

const source = {
  id: '00000000-0000-4000-8000-000000000101', platform: 'MANUAL' as const,
  title: 'Câu chuyện cộng đồng', body: 'Một người hàng xóm đã giúp sửa chiếc xe đạp trước cơn mưa.',
  comments: [{ id: '00000000-0000-4000-8000-000000000102', body: 'Cả khu phố cùng mang dụng cụ ra giúp.' }],
};

it('validates a strict production request at the boundary', () => {
  const input: ProductionInput = {
    mode: 'CREATE', candidateId: randomUUID(), channelId: randomUUID(), commentIds: [], language: 'vi', targetDurationSec: 40,
    style: 'STORYTELLING', voiceProfileId: 'mock:default', voiceId: 'demo-tone', speakingRate: 1,
    templateId: 'SocialCommentary', backgroundAssetId: null, subtitlePreset: 'ClassicCaption', theme: 'dark',
    anonymizeAuthors: true, showEngagement: false, selectedSegmentIds: [], storyVersionId: null,
  };
  expect(productionInputSchema.parse(input)).toEqual(input);
  expect(productionInputSchema.safeParse({ ...input, workspaceId: randomUUID() }).success).toBe(false);
});

it('keeps generated and edited source segments grounded to supplied post/comment IDs', async () => {
  const result = await new DeterministicMockScriptProvider().generate({ source, language: 'vi', targetDurationSec: 30, style: 'STORYTELLING' });
  expect(result.script.segments.some((segment) => segment.type === 'COMMENT')).toBe(true);
  expect(() => assertGroundedScript(result.script, source)).not.toThrow();
  const fabricated = { ...result.script, segments: result.script.segments.map((segment) => segment.type === 'COMMENT' ? { ...segment, text: 'Invented quote' } : segment) };
  expect(() => assertGroundedScript(fabricated, source)).toThrow('SCRIPT_VERBATIM_COMMENT_MISMATCH');
});

it('allows a shortened verbatim comment only when it is an exact excerpt of the referenced comment', async () => {
  const result = await new DeterministicMockScriptProvider().generate({ source, language: 'en', targetDurationSec: 20, style: 'STORYTELLING' });
  expect(result.script.segments.find((segment) => segment.type === 'COMMENT')?.text.length).toBeLessThan(source.comments[0]!.body.length);
  expect(() => assertGroundedScript(result.script, source)).not.toThrow();
});

it('creates deterministic word-timed Vietnamese captions from actual segment durations', async () => {
  const script = await new DeterministicMockScriptProvider().generate({ source, language: 'vi', targetDurationSec: 30, style: 'SOCIAL_COMMENTARY' });
  const timeline = script.script.segments.map((segment, index) => ({ segment, startMs: index * 1500, endMs: index * 1500 + 1300 }));
  const captions = generateSubtitleTrack(timeline, 'KaraokeHighlight');
  expect(captions.timingPrecision).toBe('APPROXIMATE');
  expect(captions.timeline.some((cue) => cue.text.includes('Câu chuyện'))).toBe(true);
  expect(captions.timeline.every((cue) => cue.words?.every((word) => word.endMs > word.startMs))).toBe(true);
  expect(captions.srt).toContain('-->');
});

it('uses valid provider word timings and falls back with approximate precision when they do not match', () => {
  const alignment = new ProviderMetadataAlignmentProvider();
  const providerTimings = [{ text: 'Xin', startMs: 0, endMs: 120 }, { text: 'chào', startMs: 120, endMs: 320 }];
  expect(alignment.align({ text: 'Xin chào', startMs: 0, endMs: 320, providerTimings })).toMatchObject({ words: providerTimings, timingPrecision: 'PROVIDER' });
  expect(alignment.align({ text: 'Xin chào', startMs: 0, endMs: 320, providerTimings: [{ ...providerTimings[0]!, text: 'Sai' }] })).toMatchObject({ timingPrecision: 'APPROXIMATE' });
});

it('builds a checksum-stable render manifest with audio and subtitle frame bounds', async () => {
  const script = await new DeterministicMockScriptProvider().generate({ source, language: 'vi', targetDurationSec: 30, style: 'STORYTELLING' });
  const provider = new MockTtsProvider();
  const audioAssets = await Promise.all(script.script.segments.map(async (segment, index) => {
    const result = await provider.synthesize({ text: segment.text, language: 'vi', voiceId: 'demo-tone', speakingRate: 1 });
    return { assetId: `00000000-0000-4000-8000-${String(index + 201).padStart(12, '0')}`, segmentId: segment.id, durationMs: result.durationMs };
  }));
  const manifestInput = {
    storyProjectId: '00000000-0000-4000-8000-000000000301', storyVersionId: '00000000-0000-4000-8000-000000000302', storyVersion: 1,
    sourcePostId: source.id, platform: source.platform, script: script.script, templateId: 'RedditStory' as const,
    backgroundAssetId: null, attribution: { required: false, text: null }, audioAssets, subtitlePreset: 'KaraokeHighlight' as const,
  };
  const first = createRenderManifest(manifestInput);
  const second = createRenderManifest(manifestInput);
  expect(first.checksum).toBe(second.checksum);
  expect(first.manifest.width).toBe(1080);
  expect(first.manifest.height).toBe(1920);
  expect(first.manifest.fps).toBe(30);
  expect(first.manifest.visualSegments.every((segment) => segment.endFrame <= first.manifest.durationFrames)).toBe(true);
  expect(first.manifest.audioAssets.every((asset) => asset.startFrame + asset.durationFrames <= first.manifest.durationFrames)).toBe(true);
});

it('normalizes owned backgrounds to portrait WebP and rejects unsupported image formats', async () => {
  const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#28463b' } }).png().toBuffer();
  const prepared = await prepareBackgroundImage(png);
  expect(prepared).toMatchObject({ mimeType: 'image/webp', width: 1080, height: 1920, sourceFormat: 'png' });
  await expect(prepareBackgroundImage(Buffer.from('<svg/>'))).rejects.toThrow();
});
