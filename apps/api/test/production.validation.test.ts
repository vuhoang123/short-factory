import { describe, expect, it } from 'vitest';
import { videoReviewSchema } from '../src/production.validation.js';

describe('video review contract', () => {
  it('accepts only an explicit approve or reject decision', () => {
    expect(videoReviewSchema.parse({ decision: 'APPROVED' })).toEqual({ decision: 'APPROVED' });
    expect(videoReviewSchema.parse({ decision: 'REJECTED' })).toEqual({ decision: 'REJECTED' });
    expect(videoReviewSchema.safeParse({ decision: 'PENDING' }).success).toBe(false);
    expect(videoReviewSchema.safeParse({ decision: 'APPROVED', status: 'READY' }).success).toBe(false);
  });
});
