import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { hashContent, minimizeText } from '../src/content.service.js';
import { isSafeMetadataUrl, manualImportSchema, reviewSchema, sourceSchema } from '../src/validation.js';
import fixture from '../../../examples/manual-import.json';

describe('Phase 1 security boundaries', () => {
  it('stores salted scrypt hashes and rejects wrong passwords and malformed hashes', async () => {
    const one = await hashPassword('correct horse battery staple');
    const two = await hashPassword('correct horse battery staple');
    expect(one).not.toBe(two);
    expect(one).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', one)).toBe(true);
    expect(await verifyPassword('incorrect horse battery staple', one)).toBe(false);
    expect(await verifyPassword('correct horse battery staple', 'invalid')).toBe(false);
  });

  it('validates the checked-in import fixture and API nested-source format', () => {
    expect(manualImportSchema.parse(fixture).comments).toHaveLength(3);
    const nested = { source: { platform: 'MANUAL', canonicalUrl: 'https://example.org/my-story' }, body: 'A permitted story.', rights: { basis: 'OWNED', attestation: true, commercialAllowed: true, allowedPlatforms: ['YOUTUBE'] } };
    expect(manualImportSchema.parse(nested).rights.attested).toBe(true);
    expect(manualImportSchema.parse(nested).platform).toBe('MANUAL');
  });

  it('does not accept known rights without attestation, unknown fields, duplicate comment IDs or network sources', () => {
    expect(manualImportSchema.safeParse({ ...fixture, rights: { ...fixture.rights, attested: false } }).success).toBe(false);
    expect(manualImportSchema.safeParse({ ...fixture, secretToken: 'must not store' }).success).toBe(false);
    expect(manualImportSchema.safeParse({ ...fixture, comments: [fixture.comments[0], fixture.comments[0]] }).success).toBe(false);
    expect(manualImportSchema.safeParse({ ...fixture, platform: 'FACEBOOK' }).success).toBe(false);
    expect(sourceSchema.safeParse({ platform: 'MANUAL', sourceKey: 'test', config: { token: 'private' } }).success).toBe(false);
  });

  it.each(['file:///etc/passwd', 'ftp://example.org/story', 'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'https://user:pass@example.org/', 'http://metadata.google.internal/x', 'http://private.local/a', 'http://2130706433/a'])('rejects unsafe URL metadata %s', (url) => {
    expect(isSafeMetadataUrl(url)).toBe(false);
  });

  it('minimizes text and uses stable hashes of normalized source content', () => {
    const minimized = minimizeText(' \r\nContact private@example.org or +84 912 345 678.\u0000 ');
    expect(minimized).not.toContain('private@example.org');
    expect(minimized).not.toContain('+84 912');
    expect(minimized).not.toContain('\u0000');
    expect(hashContent('Title', 'Body\r\ntext')).toBe(hashContent('Title', 'Body\ntext'));
    expect(hashContent('Title', 'Body')).not.toBe(hashContent('Title', 'Changed body'));
  });

  it('permits an explicit rejection without claiming evidence or territory', () => {
    expect(reviewSchema.parse({ decision: 'REJECTED', evidence: '', territory: '' }).decision).toBe('REJECTED');
  });
});
