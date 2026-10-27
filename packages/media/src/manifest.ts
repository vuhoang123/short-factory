import { createHash } from 'node:crypto';
import { renderManifestSchema, type RenderManifest, type StoryScript, type SubtitlePreset } from './contracts.js';
import { generateSubtitleTrack, type TimedSegment } from './subtitles.js';

export interface ManifestAudioAsset { assetId: string; segmentId: string; durationMs: number }
export interface CreateManifestInput {
  storyProjectId: string;
  storyVersionId: string;
  storyVersion: number;
  sourcePostId: string;
  platform: RenderManifest['platform'];
  script: StoryScript;
  templateId: RenderManifest['templateId'];
  backgroundAssetId: string | null;
  attribution: { required: boolean; text: string | null };
  visualSettings?: { theme: 'dark' | 'light'; anonymizeAuthors: boolean; showEngagement: boolean };
  audioAssets: ManifestAudioAsset[];
  subtitlePreset: SubtitlePreset;
}
export interface CreatedManifest { manifest: RenderManifest; checksum: string; subtitle: ReturnType<typeof generateSubtitleTrack> }

export function createRenderManifest(input: CreateManifestInput): CreatedManifest {
  const audioBySegment = new Map(input.audioAssets.map((audio) => [audio.segmentId, audio]));
  const timedSegments: TimedSegment[] = [];
  const audioTimeline: RenderManifest['audioAssets'] = [];
  const visualSegments: RenderManifest['visualSegments'] = [];
  let cursorMs = 0;
  for (const segment of input.script.segments) {
    const audio = audioBySegment.get(segment.id);
    if (!audio) throw new Error('RENDER_AUDIO_ASSET_MISSING');
    const startMs = cursorMs;
    const endMs = startMs + audio.durationMs;
    const startFrame = Math.floor((startMs / 1000) * 30);
    const durationFrames = Math.max(1, Math.ceil((audio.durationMs / 1000) * 30));
    const endFrame = startFrame + durationFrames;
    timedSegments.push({ segment, startMs, endMs });
    visualSegments.push({ id: segment.id, type: segment.type, text: segment.text, sourceRefs: segment.sourceRefs, narrationType: segment.narrationType, startFrame, endFrame });
    audioTimeline.push({ assetId: audio.assetId, segmentId: segment.id, startFrame, durationFrames });
    cursorMs = endMs + 100;
  }
  const subtitle = generateSubtitleTrack(timedSegments, input.subtitlePreset);
  const durationFrames = Math.max(1, Math.ceil((Math.max(1, cursorMs - 100) / 1000) * 30));
  const manifest = renderManifestSchema.parse({
    version: 1,
    templateId: input.templateId,
    templateVersion: 1,
    width: 1080,
    height: 1920,
    fps: 30,
    durationFrames,
    storyProjectId: input.storyProjectId,
    storyVersionId: input.storyVersionId,
    storyVersion: input.storyVersion,
    platform: input.platform,
    sourcePostId: input.sourcePostId,
    title: input.script.title,
    backgroundAssetId: input.backgroundAssetId,
    attribution: input.attribution,
    visualSettings: input.visualSettings ?? { theme: 'dark', anonymizeAuthors: true, showEngagement: true },
    audioAssets: audioTimeline,
    subtitlePreset: input.subtitlePreset,
    subtitleTimeline: subtitle.timeline,
    visualSegments,
    animations: ['FADE', 'SLIDE', 'SCALE', 'SEQUENTIAL_COMMENTS'],
    audioLevels: { narration: 1, background: 0 },
    rendering: { videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' },
  });
  const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, checksum, subtitle };
}
