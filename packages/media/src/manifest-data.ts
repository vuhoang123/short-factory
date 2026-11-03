import { renderManifestSchema, type CompositionInput, type RenderManifest, type StoryScript, type SubtitlePreset } from './contracts';
import { generateSubtitleTrack, type TimedSegment } from './subtitles';
import type { WordTiming } from './alignment';

export interface ManifestAudioAsset { assetId: string; segmentId: string; durationMs: number; providerTimings?: WordTiming[] }
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
  sourceImages?: RenderManifest['sourceImages'];
  mediaSettings?: RenderManifest['mediaSettings'];
  backgroundVideo?: RenderManifest['backgroundVideo'];
}
export interface CreatedManifest { manifest: RenderManifest; checksum: string; subtitle: ReturnType<typeof generateSubtitleTrack> }

/** Reuse a matching saved narration without changing the current visual choices. */
export function applyRecordedAudio(preview: CompositionInput, recorded: CompositionInput): CompositionInput {
  const saved = recorded.manifest;
  if (preview.manifest.storyVersionId !== saved.storyVersionId || preview.manifest.visualSegments.length !== saved.visualSegments.length || preview.manifest.visualSegments.some((segment, index) => segment.id !== saved.visualSegments[index]?.id || segment.text !== saved.visualSegments[index]?.text)) throw new Error('PREVIEW_RECORDING_MISMATCH');
  const subtitleTimeline = saved.subtitlePreset === preview.manifest.subtitlePreset ? saved.subtitleTimeline : generateSubtitleTrack(preview.manifest.visualSegments.map(segment => {
    const timing = saved.visualSegments.find(item => item.id === segment.id)!;
    const words = saved.subtitleTimeline.filter(cue => cue.segmentId === segment.id).flatMap(cue => cue.words ?? []);
    return { segment, startMs: timing.startFrame / saved.fps * 1000, endMs: timing.endFrame / saved.fps * 1000, ...(words.length ? { providerTimings: words } : {}) };
  }), preview.manifest.subtitlePreset).timeline;
  return { ...preview, audioSources: recorded.audioSources, manifest: { ...preview.manifest, durationFrames: saved.durationFrames, visualSegments: saved.visualSegments, audioAssets: saved.audioAssets, subtitleTimeline } };
}

export function buildRenderManifest(input: CreateManifestInput): Omit<CreatedManifest, 'checksum'> {
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
    timedSegments.push({ segment, startMs, endMs, ...(audio.providerTimings ? { providerTimings: audio.providerTimings.map((word) => ({ ...word, startMs: word.startMs + startMs, endMs: word.endMs + startMs })) } : {}) });
    visualSegments.push({ id: segment.id, type: segment.type, text: segment.text, sourceRefs: segment.sourceRefs, narrationType: segment.narrationType, startFrame, endFrame });
    audioTimeline.push({ assetId: audio.assetId, segmentId: segment.id, startFrame, durationFrames });
    cursorMs = endMs + 100;
  }
  const subtitle = generateSubtitleTrack(timedSegments, input.subtitlePreset);
  const durationFrames = Math.max(1, Math.ceil((Math.max(1, cursorMs - 100) / 1000) * 30));
  const manifest = renderManifestSchema.parse({
    ...(input.sourceImages ? { sourceImages: input.sourceImages } : {}),
    ...(input.mediaSettings ? { mediaSettings: input.mediaSettings } : {}),
    ...(input.backgroundVideo ? { backgroundVideo: input.backgroundVideo } : {}),
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
    audioLevels: { narration: 1, background: input.mediaSettings?.musicAssetId ? input.mediaSettings.musicVolume : 0 },
    rendering: { videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' },
  });
  return { manifest, subtitle };
}
