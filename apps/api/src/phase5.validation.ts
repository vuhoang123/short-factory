import { z } from 'zod';
import { automationRuleSchema } from '@shorts-factory/automation';

export const ruleWriteSchema = z.object({ expectedVersion: z.number().int().nonnegative(), config: automationRuleSchema }).strict();
export const controlSchema = z.object({ action: z.enum(['ENABLE', 'DISABLE', 'PAUSE', 'RESUME', 'EMERGENCY_STOP']) }).strict();
export const runSchema = z.object({ dryRun: z.boolean().default(false), candidateId: z.string().uuid().optional() }).strict();
export const analyticsFilterSchema = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), channelId: z.string().uuid().optional(), platform: z.enum(['YOUTUBE','FACEBOOK','TIKTOK']).optional() }).strict().refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), 'Start must precede end.');
const metric = z.number().finite().nonnegative().nullable().optional();
export const manualMetricSchema = z.object({ views: metric, likes: metric, comments: metric, shares: metric, watchTimeSeconds: metric, averageViewDurationSeconds: metric, retentionRate: z.number().min(0).max(1).nullable().optional(), observedAt: z.string().datetime({ offset: true }).optional() }).strict().refine((v) => Object.entries(v).some(([k,value]) => k !== 'observedAt' && value !== null && value !== undefined), 'Provide at least one measured metric.').refine((v) => !v.observedAt || Date.parse(v.observedAt) <= Date.now(), 'Observation time cannot be in the future.');
export const budgetSchema = z.object({ dailyLimitUsd: z.number().min(0).max(100000), monthlyLimitUsd: z.number().min(0).max(1000000), warningThreshold: z.number().min(0.1).max(1).default(0.8) }).strict();
export const decisionSchema = z.object({ decision: z.enum(['ACCEPTED','REJECTED']) }).strict();
export const experimentSchema = z.object({ channelId:z.string().uuid(), name:z.string().trim().min(1).max(120), hypothesis:z.string().trim().min(1).max(2000), dimension:z.enum(['hook','template','voice','subtitle','postingWindow']), variants:z.array(z.object({ id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), config:z.record(z.string(),z.unknown()) }).strict()).min(2).max(4), minSamples:z.number().int().min(5).max(10000).default(10) }).strict().refine((v) => new Set(v.variants.map((x) => x.id)).size === v.variants.length, 'Variant IDs must be unique.');
export const assignmentSchema = z.object({ videoId:z.string().uuid() }).strict();
