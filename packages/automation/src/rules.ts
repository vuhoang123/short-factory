import { z } from 'zod';

const uniqueIds = z.array(z.string().uuid()).max(100).refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique.');
const terms = z.array(z.string().trim().min(1).max(100)).max(100);
const zone = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use a valid IANA timezone.');

export const rankingWeightsSchema = z.object({
  viralScore: z.number().nonnegative().max(1).default(0.45),
  engagementVelocity: z.number().nonnegative().max(1).default(0.1),
  topicRelevance: z.number().nonnegative().max(1).default(0.1),
  commentQuality: z.number().nonnegative().max(1).default(0.05),
  storytelling: z.number().nonnegative().max(1).default(0.05),
  recency: z.number().nonnegative().max(1).default(0.1),
  novelty: z.number().nonnegative().max(1).default(0.05),
  cost: z.number().nonnegative().max(1).default(0.05),
  performance: z.number().nonnegative().max(1).default(0.05),
}).strict().refine((weights) => Object.values(weights).some((weight) => weight > 0), 'At least one ranking weight must be positive.');

export const automationRuleSchema = z.object({
  mode: z.enum(['MANUAL', 'SEMI_AUTO', 'FULL_AUTO']).default('MANUAL'),
  sourceIds: uniqueIds.default([]),
  topics: terms.default([]),
  languages: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)).min(1).max(20).default(['vi']),
  minScore: z.number().min(0).max(100).default(55),
  dailyLimit: z.number().int().min(1).max(1000).default(3),
  weeklyLimit: z.number().int().min(1).max(7000).default(15),
  accountDailyLimit: z.number().int().min(1).max(1000).default(2),
  postingTimes: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(24).default(['09:00']),
  timezone: zone.default('Asia/Ho_Chi_Minh'),
  targetPlatforms: z.array(z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK'])).min(1).max(3).refine((items) => new Set(items).size === items.length, 'Platforms must be unique.').default(['YOUTUBE']),
  accountIds: uniqueIds.default([]),
  templateId: z.enum(['RedditStory', 'SocialCommentary']).default('SocialCommentary'),
  voiceProfileId: z.string().trim().min(1).max(100),
  subtitlePreset: z.enum(['ClassicCaption', 'KaraokeHighlight']).default('ClassicCaption'),
  backgroundCategories: terms.default([]),
  durationSec: z.number().int().min(10).max(120).default(40),
  minQualityScore: z.number().min(0).max(100).default(80),
  exclusions: terms.default([]),
  commentCount: z.number().int().min(0).max(8).default(3),
  commentDurationSec: z.number().int().min(0).max(90).default(20),
  requireApproval: z.boolean().default(true),
  autoPublishAuthorized: z.boolean().default(false),
  dailyBudgetUsd: z.number().nonnegative().max(100000).default(5),
  monthlyBudgetUsd: z.number().nonnegative().max(3000000).default(50),
  estimatedRunCostUsd: z.number().nonnegative().max(10000).default(0.1),
  intervalMinutes: z.number().int().min(1).max(10080).default(60),
  cooldownMinutes: z.number().int().min(1).max(10080).default(60),
  weights: rankingWeightsSchema.default(() => rankingWeightsSchema.parse({})),
}).strict().refine((rule) => rule.monthlyBudgetUsd >= rule.dailyBudgetUsd, 'Monthly budget must be at least the daily budget.');
export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const automationControlSchema = z.enum(['ACTIVE', 'PAUSED', 'DISABLED', 'STOPPED']);
export type AutomationControl = z.infer<typeof automationControlSchema>;

export function assertAutomationMayStart(control: AutomationControl, mode: AutomationRule['mode'], scheduled = false): void {
  if (control !== 'ACTIVE') throw new Error(control === 'STOPPED' ? 'EMERGENCY_STOP' : 'AUTOMATION_PAUSED');
  if (scheduled && mode === 'MANUAL') throw new Error('MANUAL_MODE');
}

const transitions: Record<string, readonly string[]> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'BLOCKED'],
  RUNNING: ['WAITING_DISCOVERY', 'WAITING_PRODUCTION', 'WAITING_APPROVAL', 'AWAITING_APPROVAL', 'WAITING_PUBLISHING', 'WAITING_PUBLICATION', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED', 'CANCELLED'],
  WAITING_DISCOVERY: ['RUNNING', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED', 'CANCELLED'],
  WAITING_PRODUCTION: ['RUNNING', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED', 'CANCELLED'],
  WAITING_APPROVAL: ['RUNNING', 'WAITING_PUBLISHING', 'BLOCKED', 'CANCELLED'],
  AWAITING_APPROVAL: ['RUNNING', 'WAITING_PUBLICATION', 'BLOCKED', 'CANCELLED'],
  WAITING_PUBLISHING: ['RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED', 'CANCELLED'],
  WAITING_PUBLICATION: ['RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'BLOCKED', 'CANCELLED'],
  FAILED_RETRYABLE: ['QUEUED', 'RUNNING', 'CANCELLED'],
  FAILED_PERMANENT: ['QUEUED', 'CANCELLED'],
  BLOCKED: ['QUEUED', 'CANCELLED'],
};

export function assertAutomationTransition(from: string, to: string): void {
  if (!transitions[from]?.includes(to)) throw new Error(`AUTOMATION_TRANSITION_INVALID:${from}:${to}`);
}

export interface BudgetCheck {
  dailySpentUsd: number;
  monthlySpentUsd: number;
  reservedUsd: number;
  requestedUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

/** Call inside the transaction that serializes a workspace's reservations. */
export function assertBudget(input: BudgetCheck): void {
  if (Object.values(input).some((amount) => !Number.isFinite(amount) || amount < 0)) throw new Error('BUDGET_VALUE_INVALID');
  const cents = (value: number) => Math.round(value * 1_000_000);
  if (cents(input.dailySpentUsd) + cents(input.reservedUsd) + cents(input.requestedUsd) > cents(input.dailyLimitUsd)) throw new Error('DAILY_BUDGET_EXCEEDED');
  if (cents(input.monthlySpentUsd) + cents(input.reservedUsd) + cents(input.requestedUsd) > cents(input.monthlyLimitUsd)) throw new Error('MONTHLY_BUDGET_EXCEEDED');
}
