export interface WordTiming { text: string; startMs: number; endMs: number }
export interface AlignmentInput { text: string; startMs: number; endMs: number; providerTimings?: WordTiming[] }
export interface AlignmentResult { words: WordTiming[]; timingPrecision: 'PROVIDER' | 'APPROXIMATE' }

export interface AudioAlignmentProvider {
  readonly id: string;
  align(input: AlignmentInput): AlignmentResult;
}

export class ApproximateAlignmentProvider implements AudioAlignmentProvider {
  readonly id = 'proportional-words-v1';

  align(input: AlignmentInput): AlignmentResult {
    const tokens = input.text.trim().match(/[^\s]+/gu) ?? [];
    if (!tokens.length) return { words: [], timingPrecision: 'APPROXIMATE' };
    const totalWeight = tokens.reduce((total, token) => total + token.length + (/[.!?…,:;]$/u.test(token) ? 2 : 0), 0);
    const duration = Math.max(tokens.length, input.endMs - input.startMs);
    let elapsedWeight = 0;
    return {
      timingPrecision: 'APPROXIMATE',
      words: tokens.map((token, index) => {
        const weight = token.length + (/[.!?…,:;]$/u.test(token) ? 2 : 0);
        const startMs = index === 0 ? input.startMs : input.startMs + Math.floor((elapsedWeight / totalWeight) * duration);
        elapsedWeight += weight;
        const endMs = index === tokens.length - 1 ? input.endMs : input.startMs + Math.max(1, Math.floor((elapsedWeight / totalWeight) * duration));
        return { text: token, startMs, endMs: Math.max(startMs + 1, endMs) };
      }),
    };
  }
}

/** Uses provider word timestamps when they cover the exact narration text and range. */
export class ProviderMetadataAlignmentProvider implements AudioAlignmentProvider {
  readonly id = 'provider-metadata-with-approximate-fallback-v1';
  private readonly fallback = new ApproximateAlignmentProvider();

  align(input: AlignmentInput): AlignmentResult {
    const words = input.providerTimings;
    const expected = input.text.trim().match(/[^\s]+/gu) ?? [];
    if (words?.length === expected.length && words.every((word, index) => word.text === expected[index] && word.startMs >= input.startMs && word.endMs > word.startMs && word.endMs <= input.endMs)) {
      return { words, timingPrecision: 'PROVIDER' };
    }
    return this.fallback.align(input);
  }
}
