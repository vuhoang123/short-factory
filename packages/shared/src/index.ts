import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

export type { SourceAdapter, SourcePlatform, SourceCapability, SourceAccessStatus, DiscoveryQuery, NormalizedPost, NormalizedComment } from '../../../contracts/source-adapter';
export type { PublisherAdapter, PublishStatus, PublishInput, PublishResult } from '../../../contracts/publisher-adapter';

export const platformSchema = z.enum(['MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK', 'YOUTUBE', 'TIKTOK']);
export const publishPlatformSchema = z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK']);
export const roleSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER']);
export type Role = z.infer<typeof roleSchema>;
export type PublishPlatform = z.infer<typeof publishPlatformSchema>;

// References are metadata only; fetching URLs needs DNS/redirect checks in its adapter.
export const canonicalUrlSchema = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash &&
    !isIP(host) && host.includes('.') && !host.endsWith('.') &&
    !['localhost', 'metadata.google.internal'].includes(host) &&
    !/\.(localhost|local|internal|test|invalid)$/.test(host);
}, 'Use a public HTTP(S) reference URL without credentials or IP literals');

export interface RightsRecord {
  basis: string;
  commercialAllowed: boolean;
  allowedPlatforms: readonly string[];
  reviewStatus: string;
  attested: boolean;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
  attributionRequired?: boolean;
  attributionText?: string | null;
  evidence?: string | null;
  territory?: string | null;
}

export function evaluateRights(rights: RightsRecord | null | undefined, platform: string, now = new Date()): { eligible: boolean; blockers: string[] } {
  if (!rights) return { eligible: false, blockers: ['UNKNOWN_RIGHTS'] };
  const blockers: string[] = [];
  if (!['OWNED', 'LICENSED', 'CONSENTED', 'EXCEPTION_REVIEWED'].includes(rights.basis)) blockers.push('UNKNOWN_RIGHTS');
  if (rights.revokedAt) blockers.push('RIGHTS_REVOKED');
  if (rights.expiresAt && (!Number.isFinite(rights.expiresAt.getTime()) || rights.expiresAt <= now)) blockers.push('RIGHTS_EXPIRED');
  if (rights.reviewStatus !== 'APPROVED') blockers.push('REVIEW_REQUIRED');
  if (!rights.commercialAllowed) blockers.push('COMMERCIAL_USE_DENIED');
  if (!publishPlatformSchema.safeParse(platform).success || !rights.allowedPlatforms.includes(platform)) blockers.push('PLATFORM_NOT_ALLOWED');
  if (!rights.attested) blockers.push('ATTESTATION_REQUIRED');
  if (!rights.territory?.trim() || rights.territory === 'UNSPECIFIED') blockers.push('TERRITORY_REQUIRED');
  if (rights.attributionRequired && !rights.attributionText?.trim()) blockers.push('ATTRIBUTION_REQUIRED');
  if (rights.basis !== 'OWNED' && rights.basis !== 'UNKNOWN' && !rights.evidence?.trim()) blockers.push('EVIDENCE_REQUIRED');
  return { eligible: blockers.length === 0, blockers };
}

export function normalizeText(text: string): string {
  // Remove control codes from imported text before persisting normalized content.
  // eslint-disable-next-line no-control-regex
  return text.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

export function redactPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/\+\d[\d ()-]{7,}\d/g, '[phone removed]')
    .replace(/\b\d{3}[ .-]\d{3}[ .-]\d{4}\b/g, '[phone removed]')
    .replace(/\b\d{1,5}\s+(?:[\p{L}\w.-]+\s+){0,4}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/giu, '[address removed]');
}

export function hashPostContent(title: string | undefined, body: string): string {
  return createHash('sha256').update(JSON.stringify([normalizeText(title ?? ''), normalizeText(body)])).digest('hex');
}

const productionTransitions: Record<string, readonly string[]> = {
  DISCOVERED: ['SCORED', 'BLOCKED_RIGHTS', 'REJECTED', 'CANCELLED'],
  SCORED: ['SCRIPT_READY', 'BLOCKED_RIGHTS', 'BLOCKED_POLICY', 'CANCELLED'],
  SCRIPT_READY: ['AUDIO_READY', 'BLOCKED_RIGHTS', 'CANCELLED'],
  AUDIO_READY: ['RENDERED', 'BLOCKED_RIGHTS', 'CANCELLED'],
  RENDERED: ['REVIEW_PENDING', 'BLOCKED_RIGHTS', 'CANCELLED'],
  REVIEW_PENDING: ['APPROVED', 'REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_POLICY', 'CANCELLED'],
  APPROVED: ['READY_TO_PUBLISH', 'BLOCKED_RIGHTS', 'CANCELLED']
};

export function assertAllowedTransition(from: string, to: string): void {
  if (!productionTransitions[from]?.includes(to)) throw new Error(`Invalid production transition: ${from} -> ${to}`);
}

export const jobEnvelopeSchema = z.object({
  jobId: z.string().uuid(), workspaceId: z.string().uuid(), entityId: z.string().uuid(),
  step: z.string().min(1).max(80), version: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200), traceId: z.string().uuid(),
  attempt: z.number().int().nonnegative(), scheduledAt: z.string().datetime()
}).strict();

export function workflowIdempotencyKey(workspaceId: string, entityId: string, step: string, version: number): string {
  return `${workspaceId}:${entityId}:${step}:${version}`;
}
