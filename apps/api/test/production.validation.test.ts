import { describe, expect, it } from 'vitest';
import { productionCreateSchema, regenerateStorySchema, storyRenderRequestSchema, videoReviewSchema } from '../src/production.validation.js';

describe('video review contract', () => {
  it('accepts only an explicit approve or reject decision', () => {
    expect(videoReviewSchema.parse({ decision: 'APPROVED' })).toEqual({ decision: 'APPROVED' });
    expect(videoReviewSchema.parse({ decision: 'REJECTED' })).toEqual({ decision: 'REJECTED' });
    expect(videoReviewSchema.safeParse({ decision: 'PENDING' }).success).toBe(false);
    expect(videoReviewSchema.safeParse({ decision: 'APPROVED', status: 'READY' }).success).toBe(false);
  });
  it('keeps omitted draft mode out of legacy idempotency input and validates render voice settings', () => {
    expect(regenerateStorySchema.parse({})).not.toHaveProperty('draftOnly');
    expect(productionCreateSchema.parse({ channelId: '00000000-0000-4000-8000-000000000001', voiceProfileId: 'mock:default' })).not.toHaveProperty('draftOnly');
    expect(storyRenderRequestSchema.parse({ voiceProfileId: 'local:vietnamese', speakingRate: 1.15 })).toEqual({ voiceProfileId: 'local:vietnamese', speakingRate: 1.15 });
    expect(storyRenderRequestSchema.safeParse({ speakingRate: 10 }).success).toBe(false);
  });
});
