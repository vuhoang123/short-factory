/** Keep a contiguous prefix of complete sentences; never splice a quote. */
export function sentenceExcerpt(text: string, wordBudget: number): string {
  const sentences = [...new Intl.Segmenter('vi', { granularity: 'sentence' }).segment(text.trim())].map((part) => part.segment.trim()).filter(Boolean);
  let excerpt = '';
  for (const sentence of sentences) {
    const next = excerpt ? `${excerpt} ${sentence}` : sentence;
    if (excerpt && next.split(/\s+/u).length > wordBudget) break;
    // Slice the original so line breaks and spacing in verbatim comments survive.
    excerpt = text.trim().slice(0, text.trim().indexOf(sentence, excerpt.length) + sentence.length);
  }
  if (!excerpt || excerpt.length > 4000) throw new Error('SCRIPT_SENTENCE_TOO_LONG');
  return excerpt;
}

export const voicePreviewText = 'Đây là bản nghe thử giọng đọc tiếng Việt. Bạn có thể đổi giọng và tốc độ trước khi tạo video.';

/** Only modest pitch-preserving tempo changes are acceptable; never cut or pad speech. */
export function narrationDurationPlan(durationsMs: number[], targetDurationSec: number) {
  if (!durationsMs.length || durationsMs.some((duration) => !Number.isFinite(duration) || duration <= 0) || !Number.isFinite(targetDurationSec) || targetDurationSec < 10 || targetDurationSec > 120) throw new Error('NARRATION_DURATION_INVALID');
  const gapMs = (durationsMs.length - 1) * 100;
  const totalMs = durationsMs.reduce((total, duration) => total + duration, 0);
  const targetMs = targetDurationSec * 1000 - gapMs;
  const tempo = totalMs / targetMs;
  if (tempo < 0.8 || tempo > 1.25) throw new Error('DURATION_TARGET_UNREACHABLE');
  return { tempo, targetDurationsMs: durationsMs.map((duration) => Math.round(duration / tempo)), originalDurationMs: totalMs + gapMs };
}
