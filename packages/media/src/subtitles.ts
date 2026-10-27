import { subtitleCueSchema, type StorySegment, type SubtitleCue, type SubtitlePreset } from './contracts';
import { ProviderMetadataAlignmentProvider, type AudioAlignmentProvider, type WordTiming } from './alignment';

export interface TimedSegment { segment: StorySegment; startMs: number; endMs: number; providerTimings?: WordTiming[] }
export interface SubtitleTrackOutput { preset: SubtitlePreset; timeline: SubtitleCue[]; srt: string; timingPrecision: 'PROVIDER' | 'APPROXIMATE' }
export const subtitlePresets = {
  ClassicCaption: { fontSize: 58, color: '#ffffff', highlightColor: '#f7cf67', background: 'rgba(10, 16, 21, 0.82)', position: 'bottom' as const, maxWords: 6 },
  KaraokeHighlight: { fontSize: 64, color: '#ffffff', highlightColor: '#f7cf67', background: 'rgba(10, 16, 21, 0.76)', position: 'bottom' as const, maxWords: 5 },
};

function groupWords(words: WordTiming[], maxWords: number) {
  const groups: typeof words[] = [];
  let current: typeof words = [];
  for (const word of words) {
    current.push(word);
    if (current.length >= maxWords || /[.!?…]$/u.test(word.text)) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  return groups;
}

export function generateSubtitleTrack(segments: TimedSegment[], preset: SubtitlePreset, alignment: AudioAlignmentProvider = new ProviderMetadataAlignmentProvider()): SubtitleTrackOutput {
  const config = subtitlePresets[preset];
  const alignedSegments = segments.map(({ segment, startMs, endMs, providerTimings }) => ({
    segment,
    startMs,
    endMs,
    result: alignment.align({ text: segment.text, startMs, endMs, providerTimings }),
  }));
  const cues = alignedSegments.flatMap(({ segment, startMs, endMs, result }) => groupWords(result.words, config.maxWords).map((words, index) => subtitleCueSchema.parse({
    id: `${segment.id}-caption-${index + 1}`,
    segmentId: segment.id,
    text: words.map((word) => word.text).join(' '),
    startMs: words[0]?.startMs ?? startMs,
    endMs: words.at(-1)?.endMs ?? endMs,
    ...(preset === 'KaraokeHighlight' ? { words } : {}),
  })));
  const srt = cues.map((cue, index) => `${index + 1}\n${toSrtTime(cue.startMs)} --> ${toSrtTime(cue.endMs)}\n${cue.text}`).join('\n\n') + (cues.length ? '\n' : '');
  return { preset, timeline: cues, srt, timingPrecision: alignedSegments.every(({ result }) => result.timingPrecision === 'PROVIDER') ? 'PROVIDER' : 'APPROXIMATE' };
}

function toSrtTime(milliseconds: number): string {
  const ms = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const remainder = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}
