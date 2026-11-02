import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { narrationDurationPlan, sentenceExcerpt, voicePreviewText } from './narration.js';
import { waveDurationMs, MockTtsProvider } from './tts.js';
import { LocalNarrationProcessor } from './local-narration.js';
import { createRenderManifest } from './manifest.js';
import type { StoryScript } from './contracts.js';

afterEach(() => vi.unstubAllGlobals());

it('measures PCM16 duration from byte rate, including stereo, instead of counting samples twice', async () => {
  const result = await new MockTtsProvider().synthesize({ text: 'one', language: 'en', voiceId: 'demo', speakingRate: 1 });
  expect(result.durationMs).toBe(1000);
  const stereo = Buffer.from(result.audio);
  stereo.writeUInt16LE(2, 22); stereo.writeUInt32LE(64000, 28); stereo.writeUInt16LE(4, 32);
  expect(waveDurationMs(stereo)).toBe(500);
  const corrupt = Buffer.from(result.audio); corrupt.writeUInt32LE(0xffffffff, 40);
  expect(() => waveDurationMs(corrupt)).toThrow('TTS_INVALID_WAV');
});

it('keeps complete contiguous sentences and preserves newlines inside original quotes', () => {
  const text = 'Cả phố góp sách.\n\nCác em đọc sách mỗi chiều. Người lớn cũng tham gia.';
  expect(sentenceExcerpt(text, 4)).toBe('Cả phố góp sách.');
  expect(sentenceExcerpt(text, 10)).toBe('Cả phố góp sách.\n\nCác em đọc sách mỗi chiều.');
  expect(sentenceExcerpt('Một câu dài vẫn cần giữ nguyên ý.', 2)).toBe('Một câu dài vẫn cần giữ nguyên ý.');
  expect(() => sentenceExcerpt('x'.repeat(4001), 10)).toThrow('SCRIPT_SENTENCE_TOO_LONG');
});

it.each([40, 60, 120])('fits actual speech plus inter-segment gaps to %i seconds within modest tempo bounds', (target) => {
  const durations = [target * 400, target * 500];
  const plan = narrationDurationPlan(durations, target);
  expect(plan.tempo).toBeGreaterThanOrEqual(0.8);
  expect(plan.tempo).toBeLessThanOrEqual(1.25);
  expect(Math.abs(plan.targetDurationsMs.reduce((sum, value) => sum + value, 100) - target * 1000)).toBeLessThan(2);
  expect(() => narrationDurationPlan([1000], target)).toThrow('DURATION_TARGET_UNREACHABLE');
});

it('rejects mismatched, overlapping or out of range forced word timings and nonlocal processing', async () => {
  const env = { TTS_LOCAL_TOKEN: 'x'.repeat(32), TTS_LOCAL_URL: 'http://127.0.0.1:3002/speech' };
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ provider: 'fixture-aligner', words: [{ text: 'Xin', startMs: 0, endMs: 300 }, { text: 'chào', startMs: 200, endMs: 500 }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(new LocalNarrationProcessor(env).align(Buffer.alloc(4), 'Xin chào', 'vi', 500)).rejects.toThrow('AUDIO_ALIGNMENT_INVALID');
  await expect(new LocalNarrationProcessor({ ...env, TTS_LOCAL_URL: 'https://example.com/speech' }).retime(Buffer.alloc(4), 100)).rejects.toThrow('TTS_LOCAL_URL_INVALID');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(voicePreviewText.split(/\s+/u).length).toBeLessThan(30);
});

it('preserves forced word offsets all the way into the final karaoke manifest', () => {
  const script: StoryScript = { version: 1, language: 'vi', title: 'Test', targetDurationSec: 40, segments: ['Xin chào', 'Cảm ơn'].map((text, index) => ({ id: `s${index}`, type: 'COMMENTARY', text, sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' })) };
  const created = createRenderManifest({ storyProjectId: randomUUID(), storyVersionId: randomUUID(), storyVersion: 1, sourcePostId: randomUUID(), platform: 'MANUAL', script, templateId: 'SocialCommentary', backgroundAssetId: null, attribution: { required: false, text: null }, subtitlePreset: 'KaraokeHighlight', audioAssets: script.segments.map((segment) => ({ assetId: randomUUID(), segmentId: segment.id, durationMs: 1000, providerTimings: segment.text.split(' ').map((text, index) => ({ text, startMs: 100 + index * 400, endMs: 400 + index * 400 })) })) });
  expect(created.subtitle.timingPrecision).toBe('PROVIDER');
  expect(created.manifest.subtitleTimeline[1]?.words?.[0]?.startMs).toBe(1200);
  expect(created.manifest.subtitleTimeline[1]?.endMs).toBe(1900);
});
