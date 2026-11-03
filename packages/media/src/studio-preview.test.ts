import { expect, it } from 'vitest';
import { applyRecordedAudio, buildRenderManifest } from './manifest-data.js';
import { createRenderManifest } from './manifest.js';
import { sourceImageShots } from './source-images.js';

const id = '00000000-0000-4000-8000-000000000001';
it('uses the same timeline, settings and original images for preview and MP4', () => {
  const input = {
    storyProjectId: id, storyVersionId: id, storyVersion: 1, sourcePostId: id, platform: 'THREADS' as const,
    script: { version: 1, title: 'Bài thử', language: 'vi', targetDurationSec: 25, segments: [
      { id: 'post', type: 'POST' as const, text: 'Xin chào.', sourceRefs: [`post:${id}`], narrationType: 'VERBATIM' as const },
      { id: 'outro', type: 'OUTRO' as const, text: 'Bạn nghĩ sao?', sourceRefs: [], narrationType: 'ORIGINAL_COMMENTARY' as const },
    ] },
    templateId: 'SocialCommentary' as const, backgroundAssetId: id, attribution: { required: false, text: null },
    audioAssets: [{ assetId: id, segmentId: 'post', durationMs: 1000 }, { assetId: id, segmentId: 'outro', durationMs: 1500 }],
    subtitlePreset: 'KaraokeHighlight' as const,
    sourceImages: [{ assetId: id, sourceRef: `post:${id}`, checksum: 'a'.repeat(64), width: 500, height: 2000, anonymized: true }],
    mediaSettings: { musicAssetId: id, musicVolume: 0.2, ducking: true, backgroundStartSec: 1, captionSize: 52, captionColor: '#ffffff', captionPosition: 'BOTTOM' as const },
    backgroundVideo: { durationFrames: 180, startFrame: 30 },
  };
  const preview = buildRenderManifest(input);
  const rendered = createRenderManifest(input);
  expect(preview.manifest).toEqual(rendered.manifest);
  expect(preview.manifest.audioLevels.background).toBe(0.2);
  expect(sourceImageShots(preview.manifest)[0]?.image.assetId).toBe(id);
  expect(preview.manifest.backgroundVideo).toEqual(input.backgroundVideo);
  const composition = { manifest: preview.manifest, post: { title: null, body: '', authorAlias: null }, comments: [], backgroundSrc: null, audioSources: { [id]: '/private/audio.wav' } };
  const updated = { ...composition, manifest: { ...preview.manifest, durationFrames: 1200, mediaSettings: { ...input.mediaSettings, captionSize: 64 } }, audioSources: {} };
  const recorded = applyRecordedAudio(updated, composition);
  expect(recorded.manifest.durationFrames).toBe(preview.manifest.durationFrames);
  expect(recorded.manifest.subtitleTimeline).toEqual(preview.manifest.subtitleTimeline);
  expect(recorded.manifest.mediaSettings?.captionSize).toBe(64);
  expect(recorded.audioSources).toEqual(composition.audioSources);
  expect(() => applyRecordedAudio({ ...updated, manifest: { ...updated.manifest, storyVersionId: '00000000-0000-4000-8000-000000000002' } }, composition)).toThrow('PREVIEW_RECORDING_MISMATCH');
  expect(() => sourceImageShots({ ...preview.manifest, sourceImages: [] })).toThrow('SOURCE_POST_IMAGE_MISSING');
});
