import { describe, expect, it } from 'vitest';
import { assertAllowedTransition, canonicalUrlSchema, evaluateRights, hashPostContent, jobEnvelopeSchema, normalizeText, redactPersonalData, type RightsRecord } from './index';

const reviewed: RightsRecord = { basis: 'OWNED', commercialAllowed: true, allowedPlatforms: ['YOUTUBE'], reviewStatus: 'APPROVED', attested: true, territory: 'WORLDWIDE' };

describe('rights gate', () => {
  it('requires review independently of ownership attestation', () => {
    expect(evaluateRights({ ...reviewed, reviewStatus: 'PENDING' }, 'YOUTUBE').blockers).toContain('REVIEW_REQUIRED');
    expect(evaluateRights(reviewed, 'YOUTUBE').eligible).toBe(true);
  });
  it.each([
    [{ basis: 'UNKNOWN' }, 'UNKNOWN_RIGHTS'],
    [{ basis: 'arbitrary' }, 'UNKNOWN_RIGHTS'],
    [{ commercialAllowed: false }, 'COMMERCIAL_USE_DENIED'],
    [{ attested: false }, 'ATTESTATION_REQUIRED'],
    [{ allowedPlatforms: ['FACEBOOK'] }, 'PLATFORM_NOT_ALLOWED'],
    [{ expiresAt: new Date('2026-01-01') }, 'RIGHTS_EXPIRED'],
    [{ revokedAt: new Date('2026-01-01') }, 'RIGHTS_REVOKED'],
    [{ basis: 'LICENSED', evidence: null }, 'EVIDENCE_REQUIRED'],
    [{ attributionRequired: true, attributionText: '' }, 'ATTRIBUTION_REQUIRED'],
    [{ territory: 'UNSPECIFIED' }, 'TERRITORY_REQUIRED']
  ])('denies missing or revoked entitlement: %s', (overrides, blocker) => {
    const result = evaluateRights({ ...reviewed, ...overrides }, 'YOUTUBE', new Date('2026-10-26T00:00:00Z'));
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain(blocker);
  });
  it('fails closed for absent rights, destination and invalid expiry', () => {
    expect(evaluateRights(null, 'YOUTUBE').eligible).toBe(false);
    expect(evaluateRights(reviewed, 'MANUAL').eligible).toBe(false);
    expect(evaluateRights({ ...reviewed, expiresAt: new Date('invalid') }, 'YOUTUBE').eligible).toBe(false);
  });
});

describe('boundary contracts and content hygiene', () => {
  it.each(['file:///secret', 'https://localhost/x', 'http://127.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'https://user:pass@example.org', 'https://service.internal', 'https://example.org/story#access_token=private'])('rejects unsafe URL %s', value => {
    expect(canonicalUrlSchema.safeParse(value).success).toBe(false);
  });
  it('accepts public references without fetching and normalizes dedupe hashes', () => {
    expect(canonicalUrlSchema.parse('https://example.org/owned-story')).toBe('https://example.org/owned-story');
    expect(normalizeText('  Story\r\n\u0000text  ')).toBe('Story\ntext');
    expect(hashPostContent('Ｔitle', 'body\r\n')).toBe(hashPostContent('Title', 'body'));
    expect(hashPostContent('title', 'other')).not.toBe(hashPostContent('title', 'body'));
    expect(redactPersonalData('alice@example.org +84 912 345 678')).toBe('[email removed] [phone removed]');
  });
  it('job envelope rejects secrets/raw data or invalid scheduling timestamps', () => {
    const fixture = { jobId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), entityId: crypto.randomUUID(), step: 'imported', version: 1, idempotencyKey: 'key', traceId: crypto.randomUUID(), attempt: 0, scheduledAt: '2026-10-26T00:00:00Z' };
    expect(jobEnvelopeSchema.parse(fixture)).toEqual(fixture);
    expect(jobEnvelopeSchema.safeParse({ ...fixture, body: 'private post' }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({ ...fixture, scheduledAt: '2026-10-26T07:00:00' }).success).toBe(false);
  });
});

it('does not skip review states or revive a terminal production', () => {
  expect(() => assertAllowedTransition('RENDERED', 'REVIEW_PENDING')).not.toThrow();
  expect(() => assertAllowedTransition('DISCOVERED', 'READY_TO_PUBLISH')).toThrow();
  expect(() => assertAllowedTransition('REJECTED', 'APPROVED')).toThrow();
});
