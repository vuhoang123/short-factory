import { describe, expect, it } from 'vitest';
import { studioMediaSchema, studioPresetSettingsSchema, musicVolumeAtFrame } from './studio-settings.js';
import { storyRenderRequestSchema } from '../../../apps/api/src/production.validation.js';

describe('local Studio presentation settings', () => {
  it('keeps old render requests unchanged and validates media boundaries', () => {
    expect(storyRenderRequestSchema.parse({})).toEqual({});
    expect(storyRenderRequestSchema.parse({ mediaSettings: {} })).toHaveProperty('mediaSettings.musicVolume', 0.15);
    for (const mediaSettings of [{ musicVolume: 2 }, { backgroundStartSec: -1 }, { captionColor: 'url(https://example.org)' }, { captionSize: 500 }, { musicAssetId: 'foreign' }]) {
      expect(storyRenderRequestSchema.safeParse({ mediaSettings }).success).toBe(false);
    }
    expect(studioPresetSettingsSchema.safeParse({ voiceProfileId: 'local-vi', sourcePostId: 'private-source' }).success).toBe(false);
  });

  it('fades and ducks music over narration without resetting the envelope at a loop boundary', () => {
    const settings = studioMediaSchema.parse({ musicVolume: 0.4, ducking: true });
    const narration = [{ startFrame: 30, durationFrames: 60 }];
    expect(musicVolumeAtFrame(0, 180, 30, settings, narration)).toBe(0);
    expect(musicVolumeAtFrame(45, 180, 30, settings, narration)).toBeCloseTo(0.1);
    expect(musicVolumeAtFrame(120, 180, 30, settings, narration)).toBeCloseTo(0.4);
    expect(musicVolumeAtFrame(179, 180, 30, settings, narration)).toBeLessThan(0.02);
    expect(musicVolumeAtFrame(45, 180, 30, { ...settings, ducking: false }, narration)).toBeCloseTo(0.4);
  });
});
