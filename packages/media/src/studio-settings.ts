import { z } from 'zod';

export const studioMediaSchema = z.object({
  backgroundStartSec: z.number().min(0).max(300).default(0),
  musicAssetId: z.string().uuid().nullable().default(null),
  musicVolume: z.number().min(0).max(0.5).default(0.15),
  ducking: z.boolean().default(true),
  captionSize: z.number().int().min(36).max(72).default(58),
  captionColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#ffffff'),
  captionPosition: z.enum(['BOTTOM', 'CENTER']).default('BOTTOM'),
}).strict();
export type StudioMediaSettings = z.infer<typeof studioMediaSchema>;

export const studioPresetSettingsSchema = z.object({
  voiceProfileId: z.string().min(1).max(100),
  speakingRate: z.number().min(0.5).max(2).default(1),
  templateId: z.enum(['RedditStory', 'SocialCommentary']).default('SocialCommentary'),
  subtitlePreset: z.enum(['ClassicCaption', 'KaraokeHighlight']).default('ClassicCaption'),
  theme: z.enum(['dark', 'light']).default('dark'),
  backgroundAssetId: z.string().uuid().nullable().default(null),
  anonymizeAuthors: z.boolean().default(true),
  showEngagement: z.boolean().default(true),
  mediaSettings: studioMediaSchema.default(() => studioMediaSchema.parse({})),
}).strict();
export const studioPresetSchema = z.object({ name: z.string().trim().min(1).max(80), settings: studioPresetSettingsSchema }).strict();

export function musicVolumeAtFrame(frame: number, duration: number, fps: number, settings: StudioMediaSettings, narration: Array<{ startFrame: number; durationFrames: number }>): number {
  const fade = Math.max(0, Math.min(1, frame / (fps * 0.5), (duration - 1 - frame) / fps));
  let voiceGain = 1;
  if (settings.ducking) for (const audio of narration) {
    const end = audio.startFrame + audio.durationFrames;
    const before = (audio.startFrame - frame) / (fps * 0.2);
    const after = (frame - end) / (fps * 0.3);
    const proximity = Math.min(1, Math.max(0, before, after));
    voiceGain = Math.min(voiceGain, 0.25 + 0.75 * proximity);
  }
  return settings.musicVolume * fade * voiceGain;
}
