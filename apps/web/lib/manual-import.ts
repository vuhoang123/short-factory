import { z } from 'zod';

const draftSchema = z.object({
  platform: z.literal('MANUAL'), externalPostId: z.string().trim().min(1).max(200),
  canonicalUrl: z.string().url().max(2000), title: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(50_000),
  sourceConfigId: z.string().uuid().optional(), channelId: z.string().uuid().optional(),
  comments: z.array(z.object({ externalId: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000) }).strict()).max(100),
  rights: z.object({
    basis: z.enum(['OWNED', 'LICENSED', 'CONSENTED', 'EXCEPTION_REVIEWED', 'UNKNOWN']),
    commercialAllowed: z.boolean(), allowedPlatforms: z.array(z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK'])),
    attested: z.boolean().optional(), evidence: z.string().max(4000).optional(),
    territory: z.string().max(100).optional(), attributionRequired: z.boolean().optional(),
    attributionText: z.string().max(2000).optional(), expiresAt: z.string().datetime().optional(),
  }).strict(),
}).strict();

export function prepareManualImport(raw: string, attested: boolean) {
  if (!attested) throw new Error('Confirm that you have authority to import this post and its comments.');
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error('Enter valid JSON. Check commas, quotes and brackets.'); }
  const result = draftSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue ? `${issue.path.join('.') || 'Import'}: ${issue.message}` : 'Check the import fields.');
  }
  if (new Set(result.data.comments.map((comment) => comment.externalId)).size !== result.data.comments.length) throw new Error('Each comment must have a unique externalId.');
  return { ...result.data, rights: { ...result.data.rights, attested } };
}

export const exampleImport = JSON.stringify({
  platform: 'MANUAL', externalPostId: 'my-story-001', canonicalUrl: 'https://example.org/owned-story',
  title: 'Replace with your own story', body: 'Replace with text you have permission to use.',
  comments: [
    { externalId: 'c1', body: 'Replace with an authorized comment.' },
    { externalId: 'c2', body: 'Replace with an authorized comment.' },
    { externalId: 'c3', body: 'Replace with an authorized comment.' },
  ],
  rights: { basis: 'UNKNOWN', commercialAllowed: false, allowedPlatforms: [], territory: 'UNSPECIFIED', attested: false },
}, null, 2);
