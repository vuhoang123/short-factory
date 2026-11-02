import { describe, expect, it } from 'vitest';
import { contentLifecycle } from '../src/studio.lifecycle.js';
import { studioQuerySchema } from '../src/studio.service.js';

describe('editorial lifecycle projection', () => {
  const approved = { rightsStatus: 'APPROVED', candidateStatus: 'APPROVED', score: 80, minimumScore: 55 };
  it('keeps safety and rights ahead of otherwise successful production', () => {
    expect(contentLifecycle({ ...approved, unsafe: true }).blockedReason).toContain('an toàn');
    expect(contentLifecycle({ ...approved, rightsStatus: undefined, video: { reviewStatus: 'APPROVED' } }).state).toBe('DISCOVERED');
  });
  it('distinguishes a draft from rendered output and human approval', () => {
    expect(contentLifecycle(approved).state).toBe('SELECTED');
    expect(contentLifecycle({ ...approved, run: { status: 'SUCCEEDED', currentStage: 'SCRIPT_READY', errorCode: null } }).state).toBe('SCRIPTING');
    expect(contentLifecycle({ ...approved, run: { status: 'RUNNING', currentStage: 'VIDEO_RENDER', errorCode: null } }).state).toBe('RENDERING');
    expect(contentLifecycle({ ...approved, video: { reviewStatus: 'PENDING' } }).state).toBe('REVIEW');
    expect(contentLifecycle({ ...approved, video: { reviewStatus: 'APPROVED' } }).state).toBe('APPROVED');
  });
  it('keeps cancellation, threshold failures and simulated publishing visible', () => {
    expect(contentLifecycle({ ...approved, run: { status: 'CANCELLED', currentStage: null, errorCode: null } }).state).toBe('CANCELLED');
    expect(contentLifecycle({ ...approved, run: { status: 'FAILED_RETRYABLE', currentStage: null, errorCode: 'MEDIA_RENDER_TIMEOUT' } }).blockedReason).toBe('MEDIA_RENDER_TIMEOUT');
    expect(contentLifecycle({ ...approved, candidateStatus: 'BELOW_THRESHOLD', score: 30 }).blockedReason).toContain('ngưỡng');
    expect(contentLifecycle({ ...approved, video: { reviewStatus: 'APPROVED', publication: { status: 'PUBLISHED', remotePostId: 'mock:fixture' } } }).simulated).toBe(true);
    expect(contentLifecycle({ ...approved, video: { reviewStatus: 'APPROVED', publication: { status: 'PUBLISHED', remotePostId: null } } }).state).toBe('FAILED');
    expect(contentLifecycle({ ...approved, video: { reviewStatus: 'BLOCKED' } }).state).toBe('FAILED');
  });
  it('bounds query size, rejects client tenant selectors and invalid date ranges', () => {
    expect(studioQuerySchema.parse({ minLikes: '10', limit: '12' }).minLikes).toBe(10);
    for (const query of [{ limit: 500 }, { workspaceId: 'untrusted' }, { minScore: -1 }, { from: '2026-11-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }]) expect(studioQuerySchema.safeParse(query).success).toBe(false);
  });
});
