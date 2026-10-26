import { describe, expect, it } from 'vitest';
import { exampleImport, prepareManualImport } from './manual-import';
import { mayAdmin, mayEdit, mayReview } from './contracts';

describe('manual import boundary', () => {
  it('requires a fresh attestation even if JSON claims attested rights', () => {
    const draft = JSON.parse(exampleImport) as { rights: { attested: boolean } };
    draft.rights.attested = true;
    expect(() => prepareManualImport(JSON.stringify(draft), false)).toThrow('Confirm');
  });
  it('preserves unknown rights and requires server review rather than upgrading them', () => {
    const result = prepareManualImport(exampleImport, true);
    expect(result.rights).toMatchObject({ basis: 'UNKNOWN', commercialAllowed: false, attested: true, allowedPlatforms: [] });
  });
  it('rejects duplicate comment identity', () => {
    const draft = JSON.parse(exampleImport) as { comments: { externalId: string; body: string }[] };
    draft.comments.push({ externalId: 'c1', body: 'Duplicate' });
    expect(() => prepareManualImport(JSON.stringify(draft), true)).toThrow('unique externalId');
  });
  it('rejects client workspace overrides and invalid payloads', () => {
    expect(() => prepareManualImport(JSON.stringify({ ...JSON.parse(exampleImport), workspaceId: 'foreign' }), true)).toThrow();
    expect(() => prepareManualImport('{', true)).toThrow('valid JSON');
  });
});

describe('role visibility', () => {
  it('keeps review and editorial privileges separate', () => {
    expect(mayReview('EDITOR')).toBe(false);
    expect(mayEdit('REVIEWER')).toBe(false);
    expect(mayAdmin('EDITOR')).toBe(false);
    expect(mayEdit('VIEWER')).toBe(false);
    expect(mayReview('OWNER')).toBe(true);
  });
});
