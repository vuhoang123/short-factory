import { createHash } from 'node:crypto';

export function assignExperimentVariant(experimentId: string, contentId: string, variantIds: readonly string[]): string {
  if (!experimentId || !contentId || variantIds.length < 2 || variantIds.length > 10 || new Set(variantIds).size !== variantIds.length || variantIds.some((id) => !id)) throw new Error('EXPERIMENT_ASSIGNMENT_INVALID');
  const variants = [...variantIds].sort();
  const index = createHash('sha256').update(`${experimentId}:${contentId}`).digest().readUInt32BE(0) % variants.length;
  return variants[index]!;
}

export interface ExperimentOutcome { variantId: string; contentId: string; value: number | null }
export interface ExperimentResult {
  status: 'INSUFFICIENT_DATA' | 'INCONCLUSIVE' | 'OBSERVED_DIFFERENCE';
  samples: Array<{ variantId: string; count: number; mean: number | null; standardError: number | null; interval95: [number, number] | null }>;
  leadingVariantId: string | null;
  note: string;
}

export function evaluateExperiment(outcomes: readonly ExperimentOutcome[], variantIds: readonly string[], minSamples = 10): ExperimentResult {
  if (!Number.isInteger(minSamples) || minSamples < 2 || variantIds.length < 2 || new Set(variantIds).size !== variantIds.length) throw new Error('EXPERIMENT_SAMPLE_LIMIT_INVALID');
  const contentIds = new Set<string>();
  const groups = new Map(variantIds.map((variantId) => [variantId, [] as number[]]));
  for (const outcome of outcomes) {
    if (!groups.has(outcome.variantId) || contentIds.has(outcome.contentId)) throw new Error('EXPERIMENT_CONTENT_REUSED');
    contentIds.add(outcome.contentId);
    if (outcome.value !== null && Number.isFinite(outcome.value) && outcome.value >= 0) groups.get(outcome.variantId)?.push(outcome.value);
  }
  const samples = [...groups].map(([variantId, values]) => {
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const variance = mean !== null && values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : null;
    const standardError = variance !== null ? Math.sqrt(variance / values.length) : null;
    const interval95: [number, number] | null = mean !== null && standardError !== null ? [Math.max(0, mean - 1.96 * standardError), mean + 1.96 * standardError] : null;
    return { variantId, count: values.length, mean, standardError, interval95 };
  });
  const enough = samples.every((sample) => sample.count >= minSamples);
  const ordered = [...samples].sort((left, right) => (right.mean ?? -1) - (left.mean ?? -1));
  const leader = ordered[0];
  const observedDifference = enough && Boolean(leader?.interval95 && ordered.slice(1).every((sample) => sample.interval95 && leader.interval95 && leader.interval95[0] > sample.interval95[1]));
  return { status: !enough ? 'INSUFFICIENT_DATA' : observedDifference ? 'OBSERVED_DIFFERENCE' : 'INCONCLUSIVE', samples, leadingVariantId: observedDifference ? leader?.variantId ?? null : null, note: 'Descriptive normal-approximation intervals, not causal proof or an automatic winner. Content, exposure and observation windows can differ.' };
}
